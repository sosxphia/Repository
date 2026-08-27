"""Iteration 30 — verify hashed_password is NEVER exposed on any user-returning endpoint.

Also confirms password verification still works, token invalidation on DELETE,
and existing uitest_token_123 regression endpoints still work.
"""
import os
import uuid
import json
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com"
).rstrip("/")

UITEST_TOKEN = "uitest_token_123"


def _unique_email(prefix="leak"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@example.com"


def _assert_no_leak(obj, path="root"):
    """Recursively assert 'hashed_password' key is never present in a JSON blob."""
    if isinstance(obj, dict):
        assert "hashed_password" not in obj, f"hashed_password LEAK at {path}: {list(obj.keys())}"
        for k, v in obj.items():
            _assert_no_leak(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _assert_no_leak(item, f"{path}[{i}]")


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ------- Leak checks on every user-returning endpoint -------
class TestHashedPasswordLeak:
    def test_signup_response_no_leak(self, api):
        email = _unique_email("s")
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": "sprout-pass-123", "name": "Leak Check"})
        assert r.status_code == 201, r.text
        body = r.json()
        _assert_no_leak(body, "signup")
        token = body["session_token"]
        # cleanup
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_login_response_no_leak(self, api):
        email = _unique_email("l")
        pw = "sprout-pass-123"
        r1 = api.post(f"{BASE_URL}/api/auth/signup",
                      json={"email": email, "password": pw, "name": "Login Leak"})
        assert r1.status_code == 201
        r2 = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": pw})
        assert r2.status_code == 200
        body = r2.json()
        _assert_no_leak(body, "login")
        token = body["session_token"]
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_me_response_no_leak(self, api):
        email = _unique_email("m")
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": "sprout-pass-123", "name": "Me Leak"})
        assert r.status_code == 201
        token = r.json()["session_token"]
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        _assert_no_leak(me.json(), "auth/me")
        api.delete(f"{BASE_URL}/api/account",
                   headers={"Authorization": f"Bearer {token}"})

    def test_me_uitest_token_no_leak(self, api):
        """Regression: the Google-seeded ui-test-user also must not leak."""
        me = api.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {UITEST_TOKEN}"})
        assert me.status_code == 200
        _assert_no_leak(me.json(), "auth/me (uitest)")

    def test_session_google_bad_id_no_leak(self, api):
        """POST /api/auth/session with garbage — even error response should not leak."""
        r = api.post(f"{BASE_URL}/api/auth/session", json={"session_id": "garbage-invalid"})
        # Should be 401/400/500 — but body must never contain hashed_password
        _assert_no_leak(r.json() if r.headers.get("content-type", "").startswith("application/json") else {}, "auth/session")

    def test_apple_error_path_no_leak(self, api):
        r = api.post(f"{BASE_URL}/api/auth/apple",
                     json={"identity_token": "garbage.jwt.token"})
        assert r.status_code == 401
        _assert_no_leak(r.json(), "auth/apple")

    def test_stats_no_leak(self, api):
        r = api.get(f"{BASE_URL}/api/stats",
                    headers={"Authorization": f"Bearer {UITEST_TOKEN}"})
        # stats might not exist; only leak-check if 200
        if r.status_code == 200:
            _assert_no_leak(r.json(), "stats")

    def test_friends_me_no_leak(self, api):
        r = api.get(f"{BASE_URL}/api/friends/me",
                    headers={"Authorization": f"Bearer {UITEST_TOKEN}"})
        assert r.status_code == 200
        _assert_no_leak(r.json(), "friends/me")

    def test_friends_leaderboard_no_leak(self, api):
        r = api.get(f"{BASE_URL}/api/friends/leaderboard",
                    headers={"Authorization": f"Bearer {UITEST_TOKEN}"})
        if r.status_code == 200:
            _assert_no_leak(r.json(), "friends/leaderboard")


# ------- Password verification still works + DELETE invalidates -------
class TestPasswordFlowIntegrity:
    def test_full_flow_signup_login_wrong_login_delete_token_dies(self, api):
        email = _unique_email("full")
        pw = "sprout-pass-123"
        r = api.post(f"{BASE_URL}/api/auth/signup",
                     json={"email": email, "password": pw, "name": "Full Flow"})
        assert r.status_code == 201, r.text
        token = r.json()["session_token"]

        # correct password → 200
        good = api.post(f"{BASE_URL}/api/auth/login",
                        json={"email": email, "password": pw})
        assert good.status_code == 200, good.text
        good_token = good.json()["session_token"]
        _assert_no_leak(good.json(), "login-good")

        # wrong password → 401
        bad = api.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": "totally-wrong-pw"})
        assert bad.status_code == 401
        assert "Invalid email or password" in bad.json().get("detail", "")

        # DELETE with the fresh token
        d = api.delete(f"{BASE_URL}/api/account",
                       headers={"Authorization": f"Bearer {good_token}"})
        assert d.status_code == 200, d.text

        # both tokens should now be invalid
        for t in (token, good_token):
            after = api.get(f"{BASE_URL}/api/auth/me",
                            headers={"Authorization": f"Bearer {t}"})
            assert after.status_code == 401, f"token {t[:8]} still valid after DELETE"


# ------- Regression: existing seeded flows still work -------
class TestRegressionAuthGatedEndpoints:
    HDR = {"Authorization": f"Bearer {UITEST_TOKEN}"}

    def test_plants_current(self, api):
        r = api.get(f"{BASE_URL}/api/plants/current", headers=self.HDR)
        assert r.status_code == 200
        body = r.json()
        assert body.get("plant_id") == "plant_f950c13f4790"
        assert body.get("is_dead") in (False, None)
        _assert_no_leak(body, "plants/current")

    def test_settings(self, api):
        r = api.get(f"{BASE_URL}/api/settings", headers=self.HDR)
        assert r.status_code == 200
        s = r.json()
        assert s.get("notifications_enabled") is True
        assert s.get("focus_lock_enabled") is True
        assert s.get("strict_lock_enabled") is True
        _assert_no_leak(s, "settings")

    def test_friends_me(self, api):
        r = api.get(f"{BASE_URL}/api/friends/me", headers=self.HDR)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("friend_code"), str) and len(body["friend_code"]) == 6

    def test_goals_crud(self, api):
        # create
        c = api.post(f"{BASE_URL}/api/goals",
                     json={"title": "TEST_leak_goal"}, headers=self.HDR)
        assert c.status_code == 200, c.text
        gid = c.json()["goal_id"]
        # list
        lg = api.get(f"{BASE_URL}/api/goals", headers=self.HDR)
        assert lg.status_code == 200
        assert any(g["goal_id"] == gid for g in lg.json())
        # delete
        d = api.delete(f"{BASE_URL}/api/goals/{gid}", headers=self.HDR)
        assert d.status_code == 200
