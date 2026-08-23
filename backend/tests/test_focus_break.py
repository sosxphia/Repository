"""Focus Lock: POST /api/plants/focus-break kills the current alive tree."""
import os
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME", "test_database")

TOKEN = "uitest_token_123"
PLANT_ID = "plant_f950c13f4790"
USER_ID = "ui-test-user"


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    # Final cleanup — always restore plant to alive
    c[DB_NAME].plants.update_one(
        {"plant_id": PLANT_ID},
        {"$set": {"is_dead": False, "died_at": None, "is_current": True}},
    )
    c.close()


@pytest.fixture(autouse=True)
def _ensure_alive(db):
    # Before each test, make sure plant is alive & current
    db.plants.update_one(
        {"plant_id": PLANT_ID},
        {"$set": {"is_dead": False, "died_at": None, "is_current": True}},
    )
    # Also make sure any other plants of this user are not "is_current" (single-current invariant)
    db.plants.update_many(
        {"user_id": USER_ID, "plant_id": {"$ne": PLANT_ID}, "is_current": True},
        {"$set": {"is_current": False}},
    )
    yield


def _headers():
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


class TestFocusBreak:
    def test_focus_break_requires_auth(self):
        r = requests.post(f"{API}/plants/focus-break")
        assert r.status_code == 401, f"expected 401, got {r.status_code} body={r.text}"

    def test_focus_break_kills_alive_tree(self, db):
        r = requests.post(f"{API}/plants/focus-break", headers=_headers())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["killed"] is True, body
        assert body["name"] == "Oakley II", body
        # DB reflects the kill
        p = db.plants.find_one({"plant_id": PLANT_ID}, {"_id": 0})
        assert p["is_dead"] is True
        assert p["died_at"] is not None
        # streak reset
        u = db.users.find_one({"user_id": USER_ID}, {"_id": 0})
        assert u.get("streak_days", 0) == 0

    def test_focus_break_when_already_dead_returns_killed_false(self, db):
        # First kill
        r1 = requests.post(f"{API}/plants/focus-break", headers=_headers())
        assert r1.status_code == 200
        assert r1.json()["killed"] is True
        # Second call — nothing alive to kill
        r2 = requests.post(f"{API}/plants/focus-break", headers=_headers())
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["killed"] is False, body
        # Spec: name is None when nothing was killed (no current alive plant)
        assert body["name"] is None, body

    def test_focus_break_bad_token_returns_401(self):
        r = requests.post(
            f"{API}/plants/focus-break",
            headers={"Authorization": "Bearer nope_not_a_token", "Content-Type": "application/json"},
        )
        assert r.status_code == 401
