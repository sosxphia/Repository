"""
Backend tests for the Friends feature (iteration 8).
Covers: /friends/me, /friends/requests (POST/GET), accept/decline, DELETE /friends/{id},
/friends/leaderboard, and auth requirements.

Note: Users `ui-test-user` (token `uitest_token_123`) and `friend-test-user`
(token `friendtest_token_123`) are pre-seeded and were already linked as friends.
This test suite unlinks them at setup, exercises the request flow fresh, and
re-links them at teardown to restore the original state.
"""
import os
import time
import requests
import pytest
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TOKEN_A = "uitest_token_123"          # ui-test-user (UI Tester)
TOKEN_B = "friendtest_token_123"       # friend-test-user (Ferny)
USER_A = "ui-test-user"
USER_B = "friend-test-user"


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module", autouse=True)
def unlink_and_restore(mongo):
    """Start with A/B unlinked & no pending requests, restore friend link on teardown."""
    mongo.friends.delete_many({"user_id": {"$in": [USER_A, USER_B]}, "friend_id": {"$in": [USER_A, USER_B]}})
    mongo.friend_requests.delete_many({"from_user_id": {"$in": [USER_A, USER_B]}, "to_user_id": {"$in": [USER_A, USER_B]}})
    yield
    # restore original friendship
    mongo.friend_requests.delete_many({"from_user_id": {"$in": [USER_A, USER_B]}, "to_user_id": {"$in": [USER_A, USER_B]}})
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc)
    for a, b in ((USER_A, USER_B), (USER_B, USER_A)):
        mongo.friends.update_one(
            {"user_id": a, "friend_id": b},
            {"$setOnInsert": {"created_at": ts}},
            upsert=True,
        )


# ---------- Auth gating ----------
class TestAuthGating:
    @pytest.mark.parametrize("method,path", [
        ("get", "/friends/me"),
        ("get", "/friends/requests"),
        ("post", "/friends/requests"),
        ("get", "/friends/leaderboard"),
        ("delete", "/friends/ui-test-user"),
        ("post", "/friends/requests/xxx/accept"),
    ])
    def test_401_without_auth(self, method, path):
        r = getattr(requests, method)(f"{BASE_URL}{path}", json={"code": "ABCDEF"})
        assert r.status_code == 401, f"{method.upper()} {path} => {r.status_code} {r.text}"


# ---------- /friends/me ----------
class TestFriendsMe:
    def test_returns_stable_code_and_qr(self):
        r1 = requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_A))
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["user_id"] == USER_A
        assert d1["name"] == "UI Tester"
        assert isinstance(d1["friend_code"], str) and len(d1["friend_code"]) == 6
        assert d1["qr_payload"] == f"sproutly:friend:{d1['friend_code']}"
        # Stability
        r2 = requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_A))
        assert r2.json()["friend_code"] == d1["friend_code"]


# ---------- Friend request flow ----------
class TestFriendRequests:
    def _b_code(self):
        return requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_B)).json()["friend_code"]

    def _a_code(self):
        return requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_A)).json()["friend_code"]

    def test_send_with_raw_code_pending(self, mongo):
        # Ensure no pre-existing request
        mongo.friend_requests.delete_many({"from_user_id": USER_A, "to_user_id": USER_B})
        code_b = self._b_code()
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": code_b})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"
        assert r.json()["friend_name"] == "Ferny"

    def test_list_requests_shows_incoming_outgoing(self):
        # A -> B request exists; B sees incoming, A sees outgoing
        rb = requests.get(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_B)).json()
        assert any(x["user_id"] == USER_A and x["name"] == "UI Tester" for x in rb["incoming"])
        ra = requests.get(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A)).json()
        assert any(x["user_id"] == USER_B and x["name"] == "Ferny" for x in ra["outgoing"])

    def test_reverse_request_auto_accepts(self, mongo):
        # A -> B already pending; when B sends A's code, it should auto-accept.
        code_a = self._a_code()
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_B), json={"code": code_a})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accepted"
        assert body["friend_name"] == "UI Tester"
        # Verify link exists both ways
        assert mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B}) is not None
        assert mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A}) is not None

    def test_send_with_qr_payload_prefix(self, mongo):
        # Unlink first so we can send a fresh request
        mongo.friends.delete_many({"user_id": {"$in": [USER_A, USER_B]}, "friend_id": {"$in": [USER_A, USER_B]}})
        mongo.friend_requests.delete_many({"from_user_id": {"$in": [USER_A, USER_B]}, "to_user_id": {"$in": [USER_A, USER_B]}})
        payload = f"sproutly:friend:{self._b_code()}"
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": payload})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"

    def test_unknown_code_404(self):
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": "ZZZZZZ"})
        assert r.status_code == 404

    def test_own_code_400(self):
        code_a = self._a_code()
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": code_a})
        assert r.status_code == 400
        assert "own" in r.json()["detail"].lower()

    def test_already_friends_400(self, mongo):
        # Force-link then attempt to send
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc)
        for a, b in ((USER_A, USER_B), (USER_B, USER_A)):
            mongo.friends.update_one({"user_id": a, "friend_id": b}, {"$setOnInsert": {"created_at": ts}}, upsert=True)
        code_b = self._b_code()
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": code_b})
        assert r.status_code == 400
        assert "already friends" in r.json()["detail"].lower()

    def test_invalid_code_length_400(self):
        r = requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": "ABC"})
        assert r.status_code == 400


# ---------- Accept / Decline ----------
class TestRespondRequest:
    def _fresh_request(self, mongo, direction="a_to_b"):
        mongo.friends.delete_many({"user_id": {"$in": [USER_A, USER_B]}, "friend_id": {"$in": [USER_A, USER_B]}})
        mongo.friend_requests.delete_many({"from_user_id": {"$in": [USER_A, USER_B]}, "to_user_id": {"$in": [USER_A, USER_B]}})
        # A sends -> B
        code_b = requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_B)).json()["friend_code"]
        requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json={"code": code_b})
        reqs = requests.get(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_B)).json()
        return reqs["incoming"][0]["request_id"]

    def test_accept_creates_link(self, mongo):
        rid = self._fresh_request(mongo)
        r = requests.post(f"{BASE_URL}/friends/requests/{rid}/accept", headers=_auth(TOKEN_B))
        assert r.status_code == 200
        assert r.json()["status"] == "accept"
        assert mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B}) is not None
        assert mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A}) is not None

    def test_decline_no_link(self, mongo):
        rid = self._fresh_request(mongo)
        r = requests.post(f"{BASE_URL}/friends/requests/{rid}/decline", headers=_auth(TOKEN_B))
        assert r.status_code == 200
        assert r.json()["status"] == "decline"
        assert mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B}) is None

    def test_accept_wrong_user_404(self, mongo):
        rid = self._fresh_request(mongo)
        # A tries to accept its own outgoing request → 404 (not the recipient)
        r = requests.post(f"{BASE_URL}/friends/requests/{rid}/accept", headers=_auth(TOKEN_A))
        assert r.status_code == 404

    def test_invalid_action_400(self, mongo):
        rid = self._fresh_request(mongo)
        r = requests.post(f"{BASE_URL}/friends/requests/{rid}/bogus", headers=_auth(TOKEN_B))
        assert r.status_code == 400


# ---------- DELETE /friends/{id} ----------
class TestUnfriend:
    def test_delete_unlinks_both_directions(self, mongo):
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc)
        for a, b in ((USER_A, USER_B), (USER_B, USER_A)):
            mongo.friends.update_one({"user_id": a, "friend_id": b}, {"$setOnInsert": {"created_at": ts}}, upsert=True)
        r = requests.delete(f"{BASE_URL}/friends/{USER_B}", headers=_auth(TOKEN_A))
        assert r.status_code == 200
        assert mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B}) is None
        assert mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A}) is None


# ---------- Leaderboard ----------
class TestLeaderboard:
    def test_leaderboard_sorted_and_includes_me(self, mongo):
        # Ensure linked so B shows up
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc)
        for a, b in ((USER_A, USER_B), (USER_B, USER_A)):
            mongo.friends.update_one({"user_id": a, "friend_id": b}, {"$setOnInsert": {"created_at": ts}}, upsert=True)
        r = requests.get(f"{BASE_URL}/friends/leaderboard", headers=_auth(TOKEN_A))
        assert r.status_code == 200
        data = r.json()
        assert "leaderboard" in data
        assert data["friend_count"] >= 1
        rows = data["leaderboard"]
        # sorted desc by xp
        xps = [r["xp"] for r in rows]
        assert xps == sorted(xps, reverse=True)
        # ranks are 1..N
        assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
        # is_me present exactly once for the caller
        me_rows = [r for r in rows if r["is_me"]]
        assert len(me_rows) == 1 and me_rows[0]["user_id"] == USER_A
        # required columns
        for r0 in rows:
            for k in ("streak_days", "focus_minutes_week", "xp", "name"):
                assert k in r0
