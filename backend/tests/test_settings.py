"""Tests for GET/PATCH /api/settings and send_push notifications_enabled filter."""
import os
import uuid
import asyncio
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
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
    """A short-lived user isolated from the seeded ui-test-user."""
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    token = f"TEST_tok_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_{user_id}@example.com",
        "name": "Settings Tester",
        "created_at": datetime.now(timezone.utc),
        "streak_days": 0,
        "last_activity_date": None,
        "total_focus_minutes": 0,
        "total_tasks_completed": 0,
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


# ---------- GET /api/settings ----------
class TestSettingsGet:
    def test_requires_auth(self):
        r = requests.get(f"{API}/settings")
        assert r.status_code == 401

    def test_default_values_true(self, temp_user):
        r = requests.get(f"{API}/settings", headers=h(temp_user["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"notifications_enabled": True, "focus_lock_enabled": True}


# ---------- PATCH /api/settings ----------
class TestSettingsPatch:
    def test_requires_auth(self):
        r = requests.patch(f"{API}/settings", json={"notifications_enabled": False})
        assert r.status_code == 401

    def test_invalid_body_type_returns_422(self, temp_user):
        # Pydantic v2 coerces "yes"/"true" strings to bool, but non-boolable
        # values like arrays / unrecognisable strings must be rejected.
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"notifications_enabled": [1, 2, 3]},
        )
        assert r.status_code == 422
        r2 = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"focus_lock_enabled": "notabool"},
        )
        assert r2.status_code == 422

    def test_update_single_field_persists(self, temp_user, db):
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"notifications_enabled": False},
        )
        assert r.status_code == 200
        assert r.json() == {"notifications_enabled": False, "focus_lock_enabled": True}
        # Verify DB persistence
        u = db.users.find_one({"user_id": temp_user["user_id"]})
        assert u["notifications_enabled"] is False
        # Verify a GET reflects it
        r2 = requests.get(f"{API}/settings", headers=h(temp_user["token"]))
        assert r2.json()["notifications_enabled"] is False
        assert r2.json()["focus_lock_enabled"] is True

    def test_update_both_fields(self, temp_user, db):
        r = requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"notifications_enabled": True, "focus_lock_enabled": False},
        )
        assert r.status_code == 200
        assert r.json() == {"notifications_enabled": True, "focus_lock_enabled": False}
        u = db.users.find_one({"user_id": temp_user["user_id"]})
        assert u["notifications_enabled"] is True
        assert u["focus_lock_enabled"] is False

    def test_empty_body_no_change(self, temp_user):
        # Set known state
        requests.patch(
            f"{API}/settings",
            headers=h(temp_user["token"]),
            json={"notifications_enabled": True, "focus_lock_enabled": True},
        )
        r = requests.patch(f"{API}/settings", headers=h(temp_user["token"]), json={})
        assert r.status_code == 200
        assert r.json() == {"notifications_enabled": True, "focus_lock_enabled": True}


# ---------- send_push respects notifications_enabled ----------
class TestSendPushOptOut:
    """Verify the filter logic in server.send_push filters out users with
    notifications_enabled=False WITHOUT hitting the real push provider."""

    def test_send_push_filters_opted_out(self, db, monkeypatch=None):
        import sys, importlib
        sys.path.insert(0, "/app/backend")
        import server  # noqa

        # Seed two users: A opted-in, B opted-out
        uid_a = f"user_TEST_push_a_{uuid.uuid4().hex[:6]}"
        uid_b = f"user_TEST_push_b_{uuid.uuid4().hex[:6]}"
        db.users.insert_one({"user_id": uid_a, "notifications_enabled": True})
        db.users.insert_one({"user_id": uid_b, "notifications_enabled": False})

        captured = {}

        class FakeResp:
            status_code = 200
            def raise_for_status(self): pass

        async def fake_post(path, json=None):
            captured["path"] = path
            captured["json"] = json
            return FakeResp()

        server.push_http.post = fake_post  # type: ignore

        try:
            asyncio.get_event_loop().run_until_complete(
                server.send_push(
                    recipients=[uid_a, uid_b],
                    data={"title": "x", "message": "y"},
                )
            )
            assert "json" in captured, "send_push did not call push_http.post"
            assert captured["json"]["recipients"] == [uid_a], \
                f"opted-out user was not filtered: {captured['json']['recipients']}"

            # Case: ALL opted out → post should NOT be called
            captured.clear()
            asyncio.get_event_loop().run_until_complete(
                server.send_push(
                    recipients=[uid_b],
                    data={"title": "x", "message": "y"},
                )
            )
            assert captured == {}, "post should be skipped when all recipients opted out"
        finally:
            db.users.delete_many({"user_id": {"$in": [uid_a, uid_b]}})


# ---------- Leave ui-test-user in the required final state ----------
class TestUiTestUserFinalState:
    def test_reset_ui_test_user_settings(self, db):
        # Restore ui-test-user to notifications_enabled=true, focus_lock_enabled=true
        r = requests.patch(
            f"{API}/settings",
            headers=h(UI_TEST_TOKEN),
            json={"notifications_enabled": True, "focus_lock_enabled": True},
        )
        assert r.status_code == 200
        assert r.json() == {"notifications_enabled": True, "focus_lock_enabled": True}
        u = db.users.find_one({"user_id": UI_TEST_USER_ID})
        assert u is not None
        assert u.get("notifications_enabled", True) is True
        assert u.get("focus_lock_enabled", True) is True
