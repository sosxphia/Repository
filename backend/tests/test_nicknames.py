"""
Backend tests for the Friend Nicknames feature (iteration 23).

Covers:
- PATCH /api/friends/{friend_id}/nickname: set, clear (empty string → null), >24 → 422,
  non-friend id → 404, 401 unauth. Verify other user's leaderboard is NOT affected.
- POST /api/friends/requests: optional nickname on send; stored as from_nickname on
  pending doc; applied to requester's friends doc on accept. >24 → 422. Response
  includes friend_id. When reverse pending request causes instant accept, BOTH
  sides' nicknames are applied.
- POST /api/friends/requests/{id}/accept: optional body {nickname} → becomes
  accepter's nickname for requester. Accept with NO body still works. Response
  includes friend_id.
- GET /api/friends/leaderboard: rows include name (nickname if set, else real_name),
  real_name, nickname. Sorting by xp unchanged. Own row unaffected by nicknames.

Setup: users A/B pre-seeded and pre-linked. Suite unlinks them at module setup and
re-links (without nicknames, no pending requests) at teardown to restore state.
"""
import os
import requests
import pytest
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

TOKEN_A = "uitest_token_123"
TOKEN_B = "friendtest_token_123"
USER_A = "ui-test-user"
USER_B = "friend-test-user"


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


def _wipe(mongo):
    mongo.friends.delete_many(
        {"user_id": {"$in": [USER_A, USER_B]}, "friend_id": {"$in": [USER_A, USER_B]}}
    )
    mongo.friend_requests.delete_many(
        {"from_user_id": {"$in": [USER_A, USER_B]}, "to_user_id": {"$in": [USER_A, USER_B]}}
    )


def _link(mongo):
    ts = datetime.now(timezone.utc)
    for a, b in ((USER_A, USER_B), (USER_B, USER_A)):
        mongo.friends.update_one(
            {"user_id": a, "friend_id": b},
            {"$setOnInsert": {"created_at": ts}, "$unset": {"nickname": ""}},
            upsert=True,
        )


@pytest.fixture(scope="module", autouse=True)
def unlink_and_restore(mongo):
    _wipe(mongo)
    yield
    _wipe(mongo)
    _link(mongo)


def _get_b_code():
    return requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_B)).json()["friend_code"]


def _get_a_code():
    return requests.get(f"{BASE_URL}/friends/me", headers=_auth(TOKEN_A)).json()["friend_code"]


# ---------- PATCH /friends/{friend_id}/nickname ----------
class TestPatchNickname:
    def setup_method(self):
        c = MongoClient(MONGO_URL)
        _wipe(c[DB_NAME])
        _link(c[DB_NAME])
        c.close()

    def test_401_unauth(self):
        r = requests.patch(f"{BASE_URL}/friends/{USER_B}/nickname", json={"nickname": "Buddy"})
        assert r.status_code == 401

    def test_set_nickname(self, mongo):
        r = requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "Study Buddy"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["friend_id"] == USER_B
        assert body["nickname"] == "Study Buddy"
        # DB check: only A->B has nickname, B->A does NOT
        ab = mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B})
        ba = mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A})
        assert ab.get("nickname") == "Study Buddy"
        assert not ba.get("nickname")

    def test_clear_nickname_empty_string(self, mongo):
        requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "Temp"},
        )
        r = requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": ""},
        )
        assert r.status_code == 200, r.text
        assert r.json()["nickname"] is None
        ab = mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B})
        assert ab.get("nickname") in (None,)

    def test_clear_nickname_null(self, mongo):
        requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "Temp2"},
        )
        r = requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": None},
        )
        assert r.status_code == 200, r.text
        assert r.json()["nickname"] is None

    def test_too_long_422(self):
        r = requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "x" * 25},
        )
        assert r.status_code == 422, r.text

    def test_exactly_24_ok(self):
        r = requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "x" * 24},
        )
        assert r.status_code == 200, r.text
        assert r.json()["nickname"] == "x" * 24

    def test_non_friend_404(self):
        r = requests.patch(
            f"{BASE_URL}/friends/nonexistent-user-xyz/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "hi"},
        )
        assert r.status_code == 404

    def test_other_users_leaderboard_unaffected(self):
        # A renames B → B's own leaderboard should still show A by A's REAL name
        requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "PrivateNick"},
        )
        lb_b = requests.get(f"{BASE_URL}/friends/leaderboard", headers=_auth(TOKEN_B)).json()
        rows = lb_b["leaderboard"]
        a_rows = [r for r in rows if r["user_id"] == USER_A]
        assert len(a_rows) == 1
        # B never nicknamed A → B sees A's real name
        assert a_rows[0]["nickname"] in (None, "")
        assert a_rows[0]["name"] == "UI Tester"
        assert a_rows[0]["real_name"] == "UI Tester"

    def test_a_leaderboard_shows_nickname(self):
        requests.patch(
            f"{BASE_URL}/friends/{USER_B}/nickname",
            headers=_auth(TOKEN_A),
            json={"nickname": "FernFriend"},
        )
        lb = requests.get(f"{BASE_URL}/friends/leaderboard", headers=_auth(TOKEN_A)).json()
        rows = lb["leaderboard"]
        b_row = next(r for r in rows if r["user_id"] == USER_B)
        assert b_row["name"] == "FernFriend"
        assert b_row["real_name"] == "Ferny"
        assert b_row["nickname"] == "FernFriend"
        # My own row: name should stay as real name
        me = next(r for r in rows if r["is_me"])
        assert me["name"] == "UI Tester"
        assert me["real_name"] == "UI Tester"
        assert me["nickname"] in (None, "")

    def test_leaderboard_sort_unchanged(self):
        lb = requests.get(f"{BASE_URL}/friends/leaderboard", headers=_auth(TOKEN_A)).json()
        rows = lb["leaderboard"]
        xps = [r["xp"] for r in rows]
        assert xps == sorted(xps, reverse=True)
        assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))


# ---------- POST /friends/requests with nickname ----------
class TestSendWithNickname:
    def setup_method(self):
        c = MongoClient(MONGO_URL)
        _wipe(c[DB_NAME])
        c.close()

    def test_response_includes_friend_id_pending(self):
        r = requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_A),
            json={"code": _get_b_code(), "nickname": "MyFern"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "pending"
        assert body["friend_id"] == USER_B
        assert body["friend_name"] == "Ferny"

    def test_pending_stores_from_nickname(self, mongo):
        requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_A),
            json={"code": _get_b_code(), "nickname": "StoredNick"},
        )
        req = mongo.friend_requests.find_one(
            {"from_user_id": USER_A, "to_user_id": USER_B, "status": "pending"}
        )
        assert req is not None
        assert req.get("from_nickname") == "StoredNick"

    def test_pending_no_nickname_stores_none(self, mongo):
        requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_A),
            json={"code": _get_b_code()},
        )
        req = mongo.friend_requests.find_one(
            {"from_user_id": USER_A, "to_user_id": USER_B, "status": "pending"}
        )
        assert req is not None
        assert req.get("from_nickname") in (None,)

    def test_nickname_too_long_422(self):
        r = requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_A),
            json={"code": _get_b_code(), "nickname": "x" * 25},
        )
        assert r.status_code == 422

    def test_reverse_request_instant_accept_applies_both_nicknames(self, mongo):
        # A sends to B with nickname 'A-calls-B'
        r1 = requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_A),
            json={"code": _get_b_code(), "nickname": "A-calls-B"},
        )
        assert r1.status_code == 200 and r1.json()["status"] == "pending"
        # B now sends A's code with nickname 'B-calls-A' → should instant-accept
        r2 = requests.post(
            f"{BASE_URL}/friends/requests",
            headers=_auth(TOKEN_B),
            json={"code": _get_a_code(), "nickname": "B-calls-A"},
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["status"] == "accepted"
        assert body["friend_id"] == USER_A
        # Both sides' nicknames should be present
        a_of_b = mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B})
        b_of_a = mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A})
        assert a_of_b.get("nickname") == "A-calls-B"
        assert b_of_a.get("nickname") == "B-calls-A"


# ---------- POST /friends/requests/{id}/accept with nickname ----------
class TestAcceptWithNickname:
    def setup_method(self):
        c = MongoClient(MONGO_URL)
        _wipe(c[DB_NAME])
        c.close()

    def _fresh_a_to_b_request(self, from_nickname=None):
        payload = {"code": _get_b_code()}
        if from_nickname is not None:
            payload["nickname"] = from_nickname
        requests.post(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_A), json=payload)
        reqs = requests.get(f"{BASE_URL}/friends/requests", headers=_auth(TOKEN_B)).json()
        return reqs["incoming"][0]["request_id"]

    def test_accept_with_nickname_body(self, mongo):
        rid = self._fresh_a_to_b_request(from_nickname="AsideNick")
        r = requests.post(
            f"{BASE_URL}/friends/requests/{rid}/accept",
            headers=_auth(TOKEN_B),
            json={"nickname": "AcceptedNick"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "accept"
        assert body["friend_id"] == USER_A
        # A->B has the from_nickname A supplied; B->A has the accept-time nickname
        a_of_b = mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B})
        b_of_a = mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A})
        assert a_of_b.get("nickname") == "AsideNick"
        assert b_of_a.get("nickname") == "AcceptedNick"

    def test_accept_with_no_body_still_works(self, mongo):
        rid = self._fresh_a_to_b_request()
        # send NO body at all — content-type still JSON, but no body
        r = requests.post(
            f"{BASE_URL}/friends/requests/{rid}/accept",
            headers={"Authorization": f"Bearer {TOKEN_B}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accept"
        assert r.json()["friend_id"] == USER_A
        b_of_a = mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A})
        assert not b_of_a.get("nickname")

    def test_accept_with_empty_json_body(self, mongo):
        rid = self._fresh_a_to_b_request()
        r = requests.post(
            f"{BASE_URL}/friends/requests/{rid}/accept",
            headers=_auth(TOKEN_B),
            json={},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "accept"

    def test_accept_null_nickname_leaves_null(self, mongo):
        rid = self._fresh_a_to_b_request()
        r = requests.post(
            f"{BASE_URL}/friends/requests/{rid}/accept",
            headers=_auth(TOKEN_B),
            json={"nickname": None},
        )
        assert r.status_code == 200, r.text
        b_of_a = mongo.friends.find_one({"user_id": USER_B, "friend_id": USER_A})
        assert not b_of_a.get("nickname")

    def test_decline_still_works_no_body(self, mongo):
        rid = self._fresh_a_to_b_request()
        r = requests.post(
            f"{BASE_URL}/friends/requests/{rid}/decline",
            headers={"Authorization": f"Bearer {TOKEN_B}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "decline"
        assert mongo.friends.find_one({"user_id": USER_A, "friend_id": USER_B}) is None


# ---------- Leaderboard response shape ----------
class TestLeaderboardShape:
    def setup_method(self):
        c = MongoClient(MONGO_URL)
        _wipe(c[DB_NAME])
        _link(c[DB_NAME])
        c.close()

    def test_rows_have_name_real_name_nickname(self):
        r = requests.get(f"{BASE_URL}/friends/leaderboard", headers=_auth(TOKEN_A))
        assert r.status_code == 200
        rows = r.json()["leaderboard"]
        for row in rows:
            assert "name" in row
            assert "real_name" in row
            assert "nickname" in row
