"""Tests for the welcome-naming flow (new user → needs_naming=True → PATCH name clears it)."""
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


@pytest.fixture
def fresh_user(db):
    """A brand-new user + session with NO plant row — mirrors the review request exactly."""
    user_id = f"user_TEST_welcome_{uuid.uuid4().hex[:8]}"
    session_token = f"TEST_welcome_tok_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id}@example.com",
        "name": "Fresh User",
        "picture": "https://x/y.png",
        "created_at": now,  # BSON datetime, not ISO string
        "streak_days": 0,
        "last_activity_date": None,
        "total_focus_minutes": 0,
        "total_tasks_completed": 0,
    })
    db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=7),
        "last_active": now,
    })
    # IMPORTANT: no plants row exists for this user — /plants/current must auto-create one.
    yield {"user_id": user_id, "token": session_token}
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.plants.delete_many({"user_id": user_id})
    db.goals.delete_many({"user_id": user_id})
    db.focus_sessions.delete_many({"user_id": user_id})


def _h(t): return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


class TestWelcomeNaming:
    def test_current_plant_auto_creates_with_needs_naming_true(self, fresh_user, db):
        r = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"]))
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["is_current"] is True
        assert p["needs_naming"] is True, f"expected needs_naming=True, got: {p}"
        assert p["stage"] == "seed"
        assert p["xp"] == 0
        assert p["name"] == "My Tree"
        assert "_id" not in p
        # Verify DB matches
        dbp = db.plants.find_one({"user_id": fresh_user["user_id"], "is_current": True})
        assert dbp["needs_naming"] is True

    def test_patch_name_clears_needs_naming_and_persists(self, fresh_user, db):
        # Auto-create the plant
        cur = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        assert cur["needs_naming"] is True
        pid = cur["plant_id"]

        # PATCH name -> should clear needs_naming
        r = requests.patch(f"{API}/plants/{pid}", json={"name": "Wilbur"}, headers=_h(fresh_user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["name"] == "Wilbur"
        assert body.get("needs_naming") is False, f"needs_naming not cleared: {body}"

        # GET verifies persistence
        cur2 = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        assert cur2["name"] == "Wilbur"
        assert cur2["needs_naming"] is False

        # DB truth
        dbp = db.plants.find_one({"plant_id": pid})
        assert dbp["name"] == "Wilbur"
        assert dbp["needs_naming"] is False

    def test_patch_skip_path_with_my_tree_also_clears_flag(self, fresh_user, db):
        """welcome-skip-button posts name='My Tree' — must still clear needs_naming."""
        cur = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        pid = cur["plant_id"]
        r = requests.patch(f"{API}/plants/{pid}", json={"name": "My Tree"}, headers=_h(fresh_user["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "My Tree"
        assert body["needs_naming"] is False

        # Reload — flag stays cleared, modal must not reappear on reload
        cur2 = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        assert cur2["needs_naming"] is False

    def test_patch_empty_name_does_not_clear_flag(self, fresh_user, db):
        """Empty/whitespace name is ignored — modal should still be triggered on next load."""
        cur = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        pid = cur["plant_id"]
        # server treats "" as falsy (payload.name.strip() is empty) — no name update
        r = requests.patch(f"{API}/plants/{pid}", json={"name": "   "}, headers=_h(fresh_user["token"]))
        # server rejects empty updates with 400 ("Nothing to update") when no name/note applied
        assert r.status_code in (400, 200)
        # In any case needs_naming stays True
        cur2 = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        assert cur2["needs_naming"] is True

    def test_patch_note_only_does_not_clear_needs_naming(self, fresh_user, db):
        cur = requests.get(f"{API}/plants/current", headers=_h(fresh_user["token"])).json()
        pid = cur["plant_id"]
        r = requests.patch(f"{API}/plants/{pid}", json={"note": "TEST_note_only"}, headers=_h(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json()["needs_naming"] is True  # untouched
