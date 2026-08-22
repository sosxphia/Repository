"""SproutGoals backend regression tests."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def seeded_user(db):
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    session_token = f"TEST_tok_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id}@example.com",
        "name": "Test User",
        "picture": "https://x/y.png",
        "created_at": datetime.now(timezone.utc),
        "streak_days": 0,
        "last_activity_date": None,
        "total_focus_minutes": 0,
        "total_tasks_completed": 0,
    })
    db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    yield {"user_id": user_id, "token": session_token}
    # Teardown
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.plants.delete_many({"user_id": user_id})
    db.goals.delete_many({"user_id": user_id})
    db.focus_sessions.delete_many({"user_id": user_id})


def auth_headers(seeded_user):
    return {"Authorization": f"Bearer {seeded_user['token']}", "Content-Type": "application/json"}


# ---------- Health & Auth negative ----------
class TestHealthAndAuth:
    def test_root(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("message") == "SproutGoals API"

    def test_session_invalid(self):
        r = requests.post(f"{API}/auth/session", json={"session_id": "bogus_id_xyz"})
        assert r.status_code == 401

    def test_me_missing_auth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_valid(self, seeded_user):
        r = requests.get(f"{API}/auth/me", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        data = r.json()
        assert data["user_id"] == seeded_user["user_id"]
        assert "_id" not in data


# ---------- Plants ----------
class TestPlants:
    def test_current_auto_creates(self, seeded_user):
        r = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        p = r.json()
        assert p["is_current"] is True
        assert p["stage"] == "seed"
        assert "_id" not in p

    def test_list_plants(self, seeded_user):
        r = requests.get(f"{API}/plants", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert len(arr) >= 1

    def test_create_new_plant_marks_previous_not_current(self, seeded_user, db):
        r = requests.post(f"{API}/plants", json={"name": "TEST_Plant2", "species": "cactus"},
                          headers=auth_headers(seeded_user))
        assert r.status_code == 200
        new_p = r.json()
        assert new_p["is_current"] is True
        assert new_p["name"] == "TEST_Plant2"
        currents = list(db.plants.find({"user_id": seeded_user["user_id"], "is_current": True}))
        assert len(currents) == 1

    def test_reset_plant(self, seeded_user):
        cur = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user)).json()
        r = requests.post(f"{API}/plants/{cur['plant_id']}/reset", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        fresh = r.json()
        assert fresh["is_current"] is True
        assert fresh["xp"] == 0
        assert fresh["plant_id"] != cur["plant_id"]

    @pytest.mark.parametrize("xp,expected", [(0, "seed"), (75, "sprout"), (200, "sapling"), (400, "bloom")])
    def test_xp_stage_mapping(self, seeded_user, db, xp, expected):
        # Directly write xp on the current plant
        db.plants.update_one(
            {"user_id": seeded_user["user_id"], "is_current": True},
            {"$set": {"xp": xp}},
        )
        r = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        assert r.json()["stage"] == expected


# ---------- Goals ----------
class TestGoals:
    def test_goals_full_flow(self, seeded_user, db):
        # Reset current plant xp to 0 for a clean measurement
        db.plants.update_one(
            {"user_id": seeded_user["user_id"], "is_current": True},
            {"$set": {"xp": 0}},
        )
        # Create
        r = requests.post(f"{API}/goals", json={"title": "TEST_Read book"},
                          headers=auth_headers(seeded_user))
        assert r.status_code == 200
        goal = r.json()
        assert goal["title"] == "TEST_Read book"
        assert goal["completed"] is False
        gid = goal["goal_id"]

        # List
        r = requests.get(f"{API}/goals", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        assert any(g["goal_id"] == gid for g in r.json())

        # Complete -> +10 xp
        r = requests.patch(f"{API}/goals/{gid}", json={"completed": True},
                           headers=auth_headers(seeded_user))
        assert r.status_code == 200
        assert r.json()["xp_delta"] == 10
        cur = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user)).json()
        assert cur["xp"] == 10

        # Uncomplete -> -10 xp
        r = requests.patch(f"{API}/goals/{gid}", json={"completed": False},
                           headers=auth_headers(seeded_user))
        assert r.status_code == 200
        assert r.json()["xp_delta"] == -10
        cur = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user)).json()
        assert cur["xp"] == 0

        # Delete
        r = requests.delete(f"{API}/goals/{gid}", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        r = requests.get(f"{API}/goals", headers=auth_headers(seeded_user))
        assert not any(g["goal_id"] == gid for g in r.json())


# ---------- Focus & Stats ----------
class TestFocusAndStats:
    def test_focus_session_grants_xp(self, seeded_user, db):
        db.plants.update_one(
            {"user_id": seeded_user["user_id"], "is_current": True},
            {"$set": {"xp": 0}},
        )
        before_min = db.users.find_one({"user_id": seeded_user["user_id"]}).get("total_focus_minutes", 0)
        r = requests.post(f"{API}/focus-sessions", json={"duration_minutes": 25},
                          headers=auth_headers(seeded_user))
        assert r.status_code == 200
        body = r.json()
        assert body["xp_earned"] == 50
        cur = requests.get(f"{API}/plants/current", headers=auth_headers(seeded_user)).json()
        assert cur["xp"] == 50
        u = db.users.find_one({"user_id": seeded_user["user_id"]})
        assert u["total_focus_minutes"] == before_min + 25
        assert u["streak_days"] >= 1

    def test_stats(self, seeded_user):
        r = requests.get(f"{API}/stats", headers=auth_headers(seeded_user))
        assert r.status_code == 200
        s = r.json()
        for k in ["streak_days", "total_focus_minutes", "total_tasks_completed",
                  "total_plants", "bloomed_plants", "total_focus_sessions"]:
            assert k in s
        assert s["total_focus_sessions"] >= 1
