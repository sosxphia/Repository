"""Password reset flow tests (forgot-password + reset-password).

Covers happy path, enumeration protection, throttle, wrong/short/expired codes,
attempt lockout, session invalidation, and validation errors.
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pwdlib import PasswordHash
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

password_hash = PasswordHash.recommended()


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _mkemail() -> str:
    return f"TEST_reset_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture
def user(api, db):
    """Create a throwaway user and clean up all traces after the test."""
    email = _mkemail()
    r = api.post(f"{BASE_URL}/api/auth/signup", json={
        "email": email, "password": "OriginalPass1", "name": "Reset Tester"
    })
    assert r.status_code == 201, r.text
    payload = r.json()
    yield {"email": email.lower(), "password": "OriginalPass1", "token": payload["session_token"],
           "user_id": payload["user"]["user_id"]}
    # Cleanup
    db.users.delete_one({"email": email.lower()})
    db.user_sessions.delete_many({"user_id": payload["user"]["user_id"]})
    db.password_resets.delete_many({"email": email.lower()})
    db.auth_attempts.delete_one({"_id": f"login:{email.lower()}"})
    db.plants.delete_many({"user_id": payload["user"]["user_id"]})
    db.goals.delete_many({"user_id": payload["user"]["user_id"]})


# ----- /auth/forgot-password -----
class TestForgotPassword:
    def test_existing_email_creates_one_reset_row(self, api, db, user):
        db.password_resets.delete_many({"email": user["email"]})
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": user["email"]})
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert "message" in body

        rows = list(db.password_resets.find({"email": user["email"]}))
        assert len(rows) == 1, f"Expected exactly 1 reset row, got {len(rows)}"
        row = rows[0]
        assert "code_hash" in row
        assert row.get("attempts") == 0
        assert row.get("expires_at") is not None
        exp = row["expires_at"]
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = (exp - datetime.now(timezone.utc)).total_seconds()
        assert 13 * 60 < delta < 16 * 60, f"expires_at ~15 min expected, got {delta}s"

    def test_unknown_email_returns_200_and_no_row(self, api, db):
        email = _mkemail().lower()
        db.password_resets.delete_many({"email": email})
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        rows = list(db.password_resets.find({"email": email}))
        assert len(rows) == 0

    def test_response_message_identical_for_known_and_unknown(self, api, user):
        r1 = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": user["email"]})
        r2 = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": _mkemail()})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json() == r2.json(), "Enumeration: known vs unknown returned different bodies"

    def test_throttle_within_60s_does_not_create_new(self, api, db, user):
        db.password_resets.delete_many({"email": user["email"]})
        r1 = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": user["email"]})
        assert r1.status_code == 200
        row1 = db.password_resets.find_one({"email": user["email"]})
        assert row1 is not None
        created_at_1 = row1["created_at"]
        code_hash_1 = row1["code_hash"]

        # Second request immediately
        r2 = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": user["email"]})
        assert r2.status_code == 200

        rows = list(db.password_resets.find({"email": user["email"]}))
        assert len(rows) == 1, "Throttle failed — a second row was created"
        assert rows[0]["created_at"] == created_at_1
        assert rows[0]["code_hash"] == code_hash_1

    def test_delivered_at_resend_no_logged_error(self, api, db):
        """Send to delivered@resend.dev; make sure no 'reset email failed' shows in backend logs."""
        # Seed a temp user with the test address
        email = f"TEST_delivered_{uuid.uuid4().hex[:6]}@resend.dev"
        # Actually the deliverability test uses the well-known Resend sandbox address:
        email = "delivered@resend.dev"
        # Ensure we don't collide with an existing account
        existing = db.users.find_one({"email": email.lower()})
        cleanup_user_id = None
        if not existing:
            r = api.post(f"{BASE_URL}/api/auth/signup", json={
                "email": email, "password": "OriginalPass1", "name": "Delivered"
            })
            if r.status_code == 201:
                cleanup_user_id = r.json()["user"]["user_id"]
        try:
            db.password_resets.delete_many({"email": email.lower()})
            # Read backend log size before
            log_path = "/var/log/supervisor/backend.err.log"
            before = 0
            if os.path.exists(log_path):
                before = os.path.getsize(log_path)
            r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
            assert r.status_code == 200
            time.sleep(2)
            tail = ""
            if os.path.exists(log_path):
                with open(log_path, "rb") as f:
                    f.seek(before)
                    tail = f.read().decode("utf-8", errors="ignore")
            assert "reset email failed" not in tail, f"Backend logged a reset failure: {tail[-500:]}"
        finally:
            if cleanup_user_id:
                db.users.delete_one({"user_id": cleanup_user_id})
                db.user_sessions.delete_many({"user_id": cleanup_user_id})
                db.plants.delete_many({"user_id": cleanup_user_id})
            db.password_resets.delete_many({"email": email.lower()})


def _seed_reset_with_known_code(db, email: str, code: str = "123456", minutes_ahead: int = 15, attempts: int = 0):
    db.password_resets.delete_many({"email": email})
    db.password_resets.insert_one({
        "email": email,
        "code_hash": password_hash.hash(code),
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=minutes_ahead),
        "attempts": attempts,
    })


# ----- /auth/reset-password -----
class TestResetPassword:
    def test_correct_code_returns_new_session_and_no_hashed_password(self, api, db, user):
        _seed_reset_with_known_code(db, user["email"])
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "session_token" in body
        assert "user" in body
        assert body["session_token"] != user["token"]

        # No hashed_password leak
        def _scan(o):
            if isinstance(o, dict):
                assert "hashed_password" not in o, "hashed_password leaked!"
                for v in o.values():
                    _scan(v)
            elif isinstance(o, list):
                for v in o:
                    _scan(v)
        _scan(body)

    def test_old_password_no_longer_works_new_does(self, api, db, user):
        _seed_reset_with_known_code(db, user["email"])
        rr = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert rr.status_code == 200

        old_login = api.post(f"{BASE_URL}/api/auth/login", json={
            "email": user["email"], "password": user["password"]
        })
        assert old_login.status_code == 401

        new_login = api.post(f"{BASE_URL}/api/auth/login", json={
            "email": user["email"], "password": "BrandNewPass2"
        })
        assert new_login.status_code == 200

    def test_code_cannot_be_reused(self, api, db, user):
        _seed_reset_with_known_code(db, user["email"])
        r1 = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r1.status_code == 200
        r2 = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "AnotherPass3"
        })
        assert r2.status_code == 400

    def test_previous_sessions_are_invalidated(self, api, db, user):
        # user["token"] was issued by signup; confirm it is valid first
        me = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {user['token']}"})
        assert me.status_code == 200
        _seed_reset_with_known_code(db, user["email"])
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r.status_code == 200
        me2 = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {user['token']}"})
        assert me2.status_code == 401
        # The new token works
        new_token = r.json()["session_token"]
        me3 = api.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
        assert me3.status_code == 200

    def test_wrong_code_increments_attempts_and_lockout_after_5(self, api, db, user):
        _seed_reset_with_known_code(db, user["email"])
        for i in range(5):
            r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
                "email": user["email"], "code": "000000", "new_password": "BrandNewPass2"
            })
            assert r.status_code == 400
            row = db.password_resets.find_one({"email": user["email"]})
            if row:
                assert row.get("attempts") == i + 1
        # 6th attempt now — even with the correct code should 400 and destroy the row
        r6 = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r6.status_code == 400
        row = db.password_resets.find_one({"email": user["email"]})
        assert row is None, "Row should be destroyed after 5 wrong attempts"

    def test_expired_code_rejected(self, api, db, user):
        db.password_resets.delete_many({"email": user["email"]})
        db.password_resets.insert_one({
            "email": user["email"],
            "code_hash": password_hash.hash("123456"),
            "created_at": datetime.now(timezone.utc) - timedelta(hours=1),
            "expires_at": datetime.now(timezone.utc) - timedelta(minutes=1),
            "attempts": 0,
        })
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r.status_code == 400
        row = db.password_resets.find_one({"email": user["email"]})
        assert row is None, "Expired row should be purged"

    def test_new_password_too_short_422(self, api, user):
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "short"
        })
        assert r.status_code == 422

    def test_code_wrong_length_422(self, api, user):
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "12345", "new_password": "BrandNewPass2"
        })
        assert r.status_code == 422
        r2 = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "1234567", "new_password": "BrandNewPass2"
        })
        assert r2.status_code == 422

    def test_no_reset_row_for_email_returns_400(self, api, db, user):
        db.password_resets.delete_many({"email": user["email"]})
        r = api.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": user["email"], "code": "123456", "new_password": "BrandNewPass2"
        })
        assert r.status_code == 400
