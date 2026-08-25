"""Rename tests: Sproutly API + friend QR payload + backwards-compat with sproutgoals:friend:."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
TOKEN_A = "uitest_token_123"      # ui-test-user, friend_code JPXDY8
TOKEN_B = "friendtest_token_123"  # friend-test-user, friend_code 7MHNM8


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


class TestRootRename:
    """Backend root/api message rebrand."""

    def test_root_returns_sproutly_api(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200, r.text
        assert r.json().get("message") == "Sproutly API"


class TestFriendQRPayload:
    """/api/friends/me returns 'sproutly:friend:<CODE>'."""

    def test_qr_payload_uses_sproutly_prefix(self):
        r = requests.get(f"{BASE_URL}/api/friends/me", headers=_auth(TOKEN_A))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "friend_code" in data
        assert data["qr_payload"] == f"sproutly:friend:{data['friend_code']}"
        assert not data["qr_payload"].startswith("sproutgoals:")


class TestFriendRequestPayloadCompat:
    """POST /api/friends/requests must accept new + legacy prefixes + bare 6-char code."""

    def _target_code(self):
        r = requests.get(f"{BASE_URL}/api/friends/me", headers=_auth(TOKEN_B))
        assert r.status_code == 200
        return r.json()["friend_code"]

    # Users A and B are already friends per seed → each call should hit
    # "You're already friends" (400). That still exercises the payload parser
    # (a parser failure would give 400 "Invalid friend code" or 404).

    def test_accepts_new_sproutly_prefix(self):
        code = self._target_code()
        r = requests.post(
            f"{BASE_URL}/api/friends/requests",
            headers={**_auth(TOKEN_A), "Content-Type": "application/json"},
            json={"code": f"sproutly:friend:{code}"},
        )
        assert r.status_code in (200, 400), r.text
        if r.status_code == 400:
            assert "already friends" in r.json().get("detail", "").lower()

    def test_accepts_legacy_sproutgoals_prefix(self):
        code = self._target_code()
        r = requests.post(
            f"{BASE_URL}/api/friends/requests",
            headers={**_auth(TOKEN_A), "Content-Type": "application/json"},
            json={"code": f"sproutgoals:friend:{code}"},
        )
        assert r.status_code in (200, 400), r.text
        if r.status_code == 400:
            assert "already friends" in r.json().get("detail", "").lower()

    def test_accepts_bare_code(self):
        code = self._target_code()
        r = requests.post(
            f"{BASE_URL}/api/friends/requests",
            headers={**_auth(TOKEN_A), "Content-Type": "application/json"},
            json={"code": code},
        )
        assert r.status_code in (200, 400), r.text
        if r.status_code == 400:
            assert "already friends" in r.json().get("detail", "").lower()

    def test_rejects_invalid_code(self):
        r = requests.post(
            f"{BASE_URL}/api/friends/requests",
            headers={**_auth(TOKEN_A), "Content-Type": "application/json"},
            json={"code": "sproutly:friend:BADXX"},  # 5 chars → invalid
        )
        assert r.status_code == 400
        assert "invalid" in r.json().get("detail", "").lower()


class TestLeaderboardStillWorks:
    def test_leaderboard(self):
        r = requests.get(f"{BASE_URL}/api/friends/leaderboard", headers=_auth(TOKEN_A))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "leaderboard" in data
        assert isinstance(data["leaderboard"], list)
        assert data["friend_count"] >= 1


class TestGardenReadable:
    """Sanity: current plant loads (dead-tree state will be exercised via UI)."""

    def test_current_plant(self):
        r = requests.get(f"{BASE_URL}/api/plants/current", headers=_auth(TOKEN_A))
        assert r.status_code == 200, r.text
        assert "plant_id" in r.json()
