"""Tests for strict_lock_enabled in GET/PATCH /api/settings (iteration 13)."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME", "test_database")

UI_TEST_TOKEN = "uitest_token_123"
UI_TEST_USER_ID = "ui-test-user"


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def temp_user(db):
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    token = f"TEST_tok_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id}@example.com",
        "name": "Strict Lock Tester",
        "created_at": datetime.now(timezone.utc),
    })
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
    })
    yield {"user_id": user_id, "token": token}
    db.users.delete_one({"user_id": user_id})
    db.user_sessions.delete_one({"session_token": token})


def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class TestStrictLockField:
    def test_get_requires_auth(self):
        r = requests.get(f"{API}/settings")
        assert r.status_code == 401

    def test_default_includes_strict_lock_true(self, temp_user):
        r = requests.get(f"{API}/settings", headers=h(temp_user["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("strict_lock_enabled") is True
        assert data.get("focus_lock_enabled") is True
        assert data.get("notifications_enabled") is True

    def test_patch_strict_lock_false_persists(self, temp_user, db):
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"strict_lock_enabled": False},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["strict_lock_enabled"] is False
        # sibling flags untouched
        assert body["focus_lock_enabled"] is True
        assert body["notifications_enabled"] is True
        # DB persistence
        u = db.users.find_one({"user_id": temp_user["user_id"]})
        assert u["strict_lock_enabled"] is False
        # GET reflects it
        r2 = requests.get(f"{API}/settings", headers=h(temp_user["token"]))
        assert r2.json()["strict_lock_enabled"] is False

    def test_patch_all_three_fields(self, temp_user, db):
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={
                "notifications_enabled": False,
                "focus_lock_enabled": False,
                "strict_lock_enabled": True,
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "notifications_enabled": False,
            "focus_lock_enabled": False,
            "strict_lock_enabled": True,
        }

    def test_patch_invalid_strict_lock_type_422(self, temp_user):
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"strict_lock_enabled": [1, 2, 3]},
        )
        assert r.status_code == 422
        r2 = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"strict_lock_enabled": "notabool"},
        )
        assert r2.status_code == 422


class TestUiTestUserFinalState:
    """Restore the seeded ui-test-user to all-true before finishing."""
    def test_restore_ui_test_user(self, db):
        r = requests.patch(
            f"{API}/settings",
            headers=h(UI_TEST_TOKEN),
            json={
                "notifications_enabled": True,
                "focus_lock_enabled": True,
                "strict_lock_enabled": True,
            },
        )
        assert r.status_code == 200
        assert r.json() == {
            "notifications_enabled": True,
            "focus_lock_enabled": True,
            "strict_lock_enabled": True,
        }
