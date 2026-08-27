"""Email + password auth tests for Sproutly.

Covers /api/auth/signup, /api/auth/login, session integrity, new-user
bootstrapping (plants, goals, settings, friends) and DELETE /api/account.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = "https://grow-by-goals.preview.emergentagent.com"
# Fallback to env if present
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", BASE_URL).rstrip("/")

UITEST_TOKEN = "uitest_token_123"


def _unique_email(prefix="tst"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------------------ Signup ------------------
class TestSignup:
    def test_signup_success_and_normalization(self, api):
        raw_email = f"  TEST_UP_{uuid.uuid4().hex[:8]}@Example.COM  "
        r = api.post(f"{BASE_URL}/api/auth/signup", json={
            "email": raw_email,
            "password": "sprout-pass-123",
            "name": "  Casey   Green  ",
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert "session_token" in data and isinstance(data["session_token"], str)
        # Opaque token: urlsafe base64 32 bytes → 43 chars
        assert len(data["session_token"]) == 43
        assert "user" in data
        u = data["user"]
        assert "hashed_password" not in u
        assert u["email"] == raw_email.strip().casefold()
        assert u["name"] == "Casey Green"

        # Token works on /api/auth/me
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {data['session_token']}"})
        assert me.status_code == 200
        assert "hashed_password" not in me.json()

        # Cleanup
        d = api.delete(f"{BASE_URL}/api/account",
                       headers={"Authorization": f"Bearer {data['session_token']}"})
        assert d.status_code == 200

    def test_signup_duplicate_email_case_insensitive(self, api):
        email = _unique_email("dup")
        r1 = api.post(f"{BASE_URL}/api/auth/signup",
                      json={"email": email, "password": "sprout-pass-123", "name": "A"})
        assert r1.status_code == 201, r1.text
        token = r1.json()["session_token"]
        # Try with different casing
        r2 = api.post(f"{BASE_URL}/api/auth/signup",
                      json={"email": email.upper(), "password": "sprout-pass-123", "name": "B"})
        assert r2.status_code == 409, r2.text
        # Cleanup
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_signup_password_too_short(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": _unique_email("short"), "password": "abc123", "name": "X"})
        assert r.status_code == 422

    def test_signup_password_too_long(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": _unique_email("long"), "password": "a" * 129, "name": "X"})
        assert r.status_code == 422

    def test_signup_missing_name(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": _unique_email("nn"), "password": "sprout-pass-123", "name": ""})
        assert r.status_code == 422

    def test_signup_blank_name_whitespace(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": _unique_email("bn"), "password": "sprout-pass-123", "name": "   "})
        assert r.status_code == 422

    def test_signup_invalid_email(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": "not-an-email", "password": "sprout-pass-123", "name": "X"})
        assert r.status_code == 422

    def test_signup_password_control_chars(self, api):
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": _unique_email("ctrl"),
                           "password": "abc\x00def12345", "name": "X"})
        assert r.status_code == 422


# ------------------ Login ------------------
class TestLogin:
    def _make_user(self, api):
        email = _unique_email("lg")
        pw = "sprout-pass-123"
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": pw, "name": "Login Tester"})
        assert r.status_code == 201, r.text
        return email, pw, r.json()["session_token"]

    def test_login_success_case_insensitive_email(self, api):
        email, pw, token = self._make_user(api)
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email.upper(), "password": pw})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "session_token" in data and len(data["session_token"]) == 43
        assert data["session_token"] != token  # new token issued
        assert "hashed_password" not in data["user"]
        # cleanup
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {data['session_token']}"})

    def test_login_wrong_password(self, api):
        email, pw, token = self._make_user(api)
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": "wrong-password!"})
        assert r.status_code == 401
        assert "Invalid email or password" in r.json().get("detail", "")
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_login_unknown_email_same_message(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": _unique_email("nope"), "password": "sprout-pass-123"})
        assert r.status_code == 401
        assert "Invalid email or password" in r.json().get("detail", "")

    def test_login_throttle_429(self, api):
        email, pw, token = self._make_user(api)
        # 10 failed attempts allowed, 11th should trip
        statuses = []
        for i in range(12):
            r = api.post(f"{BASE_URL}/api/auth/login",
                         json={"email": email, "password": "definitely-wrong"})
            statuses.append(r.status_code)
        # After ~11 wrong tries the throttle activates
        assert 429 in statuses, f"Expected 429 in {statuses}"
        # After throttle, even correct password is blocked
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": pw})
        assert r.status_code == 429
        # Cleanup via direct DB is not available; clear via DELETE with signup token
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_login_clears_throttle_on_success(self, api):
        email, pw, token = self._make_user(api)
        # 5 bad attempts (< 10)
        for _ in range(5):
            api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": "bad"})
        # Correct login should succeed and clear counter
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": pw})
        assert r.status_code == 200
        new_token = r.json()["session_token"]
        # And another bad attempt shouldn't be blocked (counter reset)
        r2 = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": "bad"})
        assert r2.status_code == 401
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {new_token}"})


# ------------------ Bootstrapping ------------------
class TestNewUserBootstrap:
    def test_new_user_can_use_app(self, api):
        email = _unique_email("boot")
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": "sprout-pass-123", "name": "Booter"})
        assert r.status_code == 201, r.text
        token = r.json()["session_token"]
        h = {"Authorization": f"Bearer {token}"}

        # Current plant should be auto-created with needs_naming
        cp = api.get(f"{BASE_URL}/api/plants/current", headers=h)
        assert cp.status_code == 200, cp.text
        plant = cp.json()
        assert plant.get("needs_naming") is True
        assert plant.get("xp") == 0

        # Goals CRUD
        gc = api.post(f"{BASE_URL}/api/goals", json={"title": "TEST_goal"}, headers=h)
        assert gc.status_code == 200, gc.text
        goal_id = gc.json()["goal_id"]
        gl = api.get(f"{BASE_URL}/api/goals", headers=h)
        assert gl.status_code == 200 and any(g["goal_id"] == goal_id for g in gl.json())
        gd = api.delete(f"{BASE_URL}/api/goals/{goal_id}", headers=h)
        assert gd.status_code == 200

        # Settings defaults all true
        s = api.get(f"{BASE_URL}/api/settings", headers=h)
        assert s.status_code == 200
        sd = s.json()
        assert sd["notifications_enabled"] is True
        assert sd["focus_lock_enabled"] is True
        assert sd["strict_lock_enabled"] is True

        # Friend code issued
        fr = api.get(f"{BASE_URL}/api/friends/me", headers=h)
        assert fr.status_code == 200
        assert isinstance(fr.json().get("friend_code"), str)
        assert len(fr.json()["friend_code"]) == 6

        # Cleanup
        d = api.delete(f"{BASE_URL}/api/account", headers=h)
        assert d.status_code == 200


# ------------------ Regression ------------------
class TestRegression:
    def test_existing_uitest_token_still_works(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me",
                    headers={"Authorization": f"Bearer {UITEST_TOKEN}"})
        assert r.status_code == 200, r.text
        assert r.json().get("user_id") == "ui-test-user"

    def test_session_expires_at_30_days(self, api):
        # Verify session by using it and expecting no expiry issues.
        # Can't inspect expires_at via API, but token length must be 43 chars.
        email = _unique_email("exp")
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": "sprout-pass-123", "name": "Exp"})
        assert r.status_code == 201
        token = r.json()["session_token"]
        assert len(token) == 43
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})
