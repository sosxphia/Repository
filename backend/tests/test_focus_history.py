"""Tests for Session History + Focus Lock Streak features.

Covers:
- GET /api/focus-sessions/today (auth + shape)
- POST /api/focus-sessions returns & increments focus_lock_streak and updates focus_lock_best
- POST /api/plants/focus-break resets focus_lock_streak to 0 (alive tree and already-dead tree)
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://grow-by-goals.preview.emergentagent.com",
).rstrip("/")
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
    """Fresh isolated user so we can precisely assert on streak/history counts."""
    user_id = f"user_TESTFH_{uuid.uuid4().hex[:8]}"
    session_token = f"TEST_fh_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id}@example.com",
        "name": "TEST FocusHist",
        "created_at": datetime.now(timezone.utc),
        "streak_days": 0,
        "last_activity_date": None,
        "total_focus_minutes": 0,
        "total_tasks_completed": 0,
        "focus_lock_streak": 0,
        "focus_lock_best": 0,
    })
    db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    # seed a current alive plant for XP writes
    db.plants.insert_one({
        "plant_id": f"plant_TESTFH_{uuid.uuid4().hex[:8]}",
        "user_id": user_id,
        "name": "TEST Plant",
        "species": "tree",
        "xp": 0,
        "is_current": True,
        "created_at": datetime.now(timezone.utc),
        "bloomed_at": None,
    })
    yield {"user_id": user_id, "token": session_token}
    # Cleanup
    db.users.delete_many({"user_id": user_id})
    db.user_sessions.delete_many({"user_id": user_id})
    db.plants.delete_many({"user_id": user_id})
    db.focus_sessions.delete_many({"user_id": user_id})


def _h(seeded_user):
    return {"Authorization": f"Bearer {seeded_user['token']}", "Content-Type": "application/json"}


# ---------- GET /api/focus-sessions/today ----------
class TestFocusSessionsToday:
    def test_requires_auth(self):
        r = requests.get(f"{API}/focus-sessions/today")
        assert r.status_code == 401

    def test_bad_token_401(self):
        r = requests.get(f"{API}/focus-sessions/today",
                         headers={"Authorization": "Bearer nope_nope"})
        assert r.status_code == 401

    def test_empty_shape(self, seeded_user, db):
        # Ensure nothing today
        db.focus_sessions.delete_many({"user_id": seeded_user["user_id"]})
        db.users.update_one({"user_id": seeded_user["user_id"]},
                            {"$set": {"focus_lock_streak": 0, "focus_lock_best": 0}})
        r = requests.get(f"{API}/focus-sessions/today", headers=_h(seeded_user))
        assert r.status_code == 200
        body = r.json()
        for k in ("sessions", "total_minutes", "total_xp", "focus_lock_streak", "focus_lock_best"):
            assert k in body, f"missing key {k} in {body}"
        assert body["sessions"] == []
        assert body["total_minutes"] == 0
        assert body["total_xp"] == 0
        assert body["focus_lock_streak"] == 0
        assert body["focus_lock_best"] == 0


# ---------- POST /api/focus-sessions increments streak ----------
class TestFocusLockStreak:
    def test_first_session_streak_1(self, seeded_user, db):
        db.focus_sessions.delete_many({"user_id": seeded_user["user_id"]})
        db.users.update_one({"user_id": seeded_user["user_id"]},
                            {"$set": {"focus_lock_streak": 0, "focus_lock_best": 0}})
        r = requests.post(f"{API}/focus-sessions",
                          json={"duration_minutes": 1}, headers=_h(seeded_user))
        assert r.status_code == 200
        body = r.json()
        assert body["duration_minutes"] == 1
        assert body["xp_earned"] == 2  # 1 * 2
        assert body["focus_lock_streak"] == 1

    def test_second_session_increments_and_best_updates(self, seeded_user, db):
        r = requests.post(f"{API}/focus-sessions",
                          json={"duration_minutes": 2}, headers=_h(seeded_user))
        assert r.status_code == 200
        assert r.json()["focus_lock_streak"] == 2
        # verify via today endpoint
        t = requests.get(f"{API}/focus-sessions/today", headers=_h(seeded_user)).json()
        assert t["focus_lock_streak"] == 2
        assert t["focus_lock_best"] >= 2
        assert len(t["sessions"]) >= 2
        # newest-first ordering
        first = t["sessions"][0]
        for k in ("session_id", "duration_minutes", "xp_earned", "created_at"):
            assert k in first
        # totals match
        assert t["total_minutes"] == sum(s["duration_minutes"] for s in t["sessions"])
        assert t["total_xp"] == sum(s["xp_earned"] for s in t["sessions"])

    def test_best_is_max_over_time(self, seeded_user, db):
        # push best up to 5 then break it, then earn 2 again -> best stays 5
        db.users.update_one({"user_id": seeded_user["user_id"]},
                            {"$set": {"focus_lock_streak": 4, "focus_lock_best": 4}})
        r = requests.post(f"{API}/focus-sessions",
                          json={"duration_minutes": 1}, headers=_h(seeded_user))
        assert r.status_code == 200
        assert r.json()["focus_lock_streak"] == 5
        t = requests.get(f"{API}/focus-sessions/today", headers=_h(seeded_user)).json()
        assert t["focus_lock_best"] == 5


# ---------- POST /api/plants/focus-break resets streak ----------
class TestFocusBreakResetsStreak:
    def test_reset_when_alive_tree_killed(self, seeded_user, db):
        # Ensure alive current plant + streak of 5
        db.plants.update_many({"user_id": seeded_user["user_id"]},
                              {"$set": {"is_dead": False, "died_at": None}})
        db.users.update_one({"user_id": seeded_user["user_id"]},
                            {"$set": {"focus_lock_streak": 5, "focus_lock_best": 5}})
        r = requests.post(f"{API}/plants/focus-break", headers=_h(seeded_user))
        assert r.status_code == 200
        body = r.json()
        assert body["killed"] is True
        u = db.users.find_one({"user_id": seeded_user["user_id"]})
        assert u.get("focus_lock_streak", -1) == 0
        assert u.get("focus_lock_best", 0) == 5, "best must NOT be reset"

    def test_reset_when_tree_already_dead(self, seeded_user, db):
        # Tree already dead → killed:false but streak must still reset
        db.users.update_one({"user_id": seeded_user["user_id"]},
                            {"$set": {"focus_lock_streak": 7}})
        # plant already dead from previous test
        r = requests.post(f"{API}/plants/focus-break", headers=_h(seeded_user))
        assert r.status_code == 200
        body = r.json()
        assert body["killed"] is False
        u = db.users.find_one({"user_id": seeded_user["user_id"]})
        assert u.get("focus_lock_streak", -1) == 0, (
            f"streak must reset to 0 even when tree already dead, got {u.get('focus_lock_streak')}"
        )

    def test_focus_break_requires_auth(self):
        r = requests.post(f"{API}/plants/focus-break")
        assert r.status_code == 401
