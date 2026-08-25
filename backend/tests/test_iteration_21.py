"""Iteration 21: Verify bundle-id rename didn't break auth, NEW DELETE /api/account,
friend-request name batching, and regression on core endpoints."""
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MONGO = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
DB = MONGO[os.environ.get("DB_NAME", "test_database")]

UI_TOKEN = "uitest_token_123"
FRIEND_TOKEN = "friendtest_token_123"


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------- Bundle-id / Auth surface ----------
class TestBundleIdRenameAuth:
    def test_root_alive(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200, r.text
        assert "Sproutly" in r.text

    def test_me_with_seeded_session(self):
        r = requests.get(f"{API}/auth/me", headers=_h(UI_TOKEN))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("user_id") == "ui-test-user"

    def test_apple_invalid_token_rejected(self):
        r = requests.post(f"{API}/auth/apple", json={"identity_token": "garbage.jwt.token"})
        assert r.status_code == 401, r.text
        assert "Apple" in r.json().get("detail", "")

    def test_apple_missing_body_422(self):
        r = requests.post(f"{API}/auth/apple", json={})
        assert r.status_code == 422


# ---------- DELETE /api/account ----------
class TestDeleteAccount:
    throwaway_uid = f"throwaway-{uuid.uuid4().hex[:8]}"
    throwaway_token = f"throwtok-{uuid.uuid4().hex[:12]}"
    friend_uid = None  # random friend to link both directions

    @classmethod
    def setup_class(cls):
        now = datetime.now(timezone.utc)
        DB.users.insert_one({
            "user_id": cls.throwaway_uid,
            "email": f"{cls.throwaway_uid}@x.test",
            "name": "Throwaway",
            "created_at": now,
            "friend_code": f"TW{uuid.uuid4().hex[:4].upper()}",
        })
        DB.user_sessions.insert_many([
            {"session_token": cls.throwaway_token, "user_id": cls.throwaway_uid,
             "created_at": now, "expires_at": now + timedelta(days=7)},
            {"session_token": cls.throwaway_token + "_b", "user_id": cls.throwaway_uid,
             "created_at": now, "expires_at": now + timedelta(days=7)},
        ])
        # Seed data across every collection the endpoint should clear
        DB.plants.insert_one({"plant_id": f"pl-{cls.throwaway_uid}", "user_id": cls.throwaway_uid,
                               "name": "TW", "created_at": now, "xp": 0, "is_dead": False})
        DB.goals.insert_one({"goal_id": f"go-{cls.throwaway_uid}", "user_id": cls.throwaway_uid,
                              "title": "TEST_goal", "completed": False, "created_at": now})
        DB.focus_sessions.insert_one({"session_id": f"fs-{cls.throwaway_uid}", "user_id": cls.throwaway_uid,
                                       "start_time": now, "duration_seconds": 60, "completed": True})
        DB.daily_quests.insert_one({"user_id": cls.throwaway_uid, "date": now.strftime("%Y-%m-%d"),
                                     "goals_completed": 0})
        # Link a friend in BOTH directions
        cls.friend_uid = f"friend-of-{cls.throwaway_uid}"
        DB.users.insert_one({"user_id": cls.friend_uid, "email": f"{cls.friend_uid}@x.test",
                              "name": "TW-Friend", "created_at": now,
                              "friend_code": f"FR{uuid.uuid4().hex[:4].upper()}"})
        DB.friends.insert_many([
            {"user_id": cls.throwaway_uid, "friend_id": cls.friend_uid, "created_at": now},
            {"user_id": cls.friend_uid, "friend_id": cls.throwaway_uid, "created_at": now},
        ])
        DB.friend_requests.insert_many([
            {"request_id": f"frq-out-{uuid.uuid4().hex[:6]}", "from_user_id": cls.throwaway_uid,
             "to_user_id": cls.friend_uid, "status": "pending", "created_at": now},
            {"request_id": f"frq-in-{uuid.uuid4().hex[:6]}", "from_user_id": cls.friend_uid,
             "to_user_id": cls.throwaway_uid, "status": "pending", "created_at": now},
        ])

    @classmethod
    def teardown_class(cls):
        # In case a test aborted before delete
        for col in ("users", "plants", "goals", "focus_sessions", "daily_quests",
                    "friends", "friend_requests", "user_sessions"):
            DB[col].delete_many({"user_id": cls.throwaway_uid})
            DB[col].delete_many({"friend_id": cls.throwaway_uid})
        DB.friend_requests.delete_many({"$or": [{"from_user_id": cls.throwaway_uid},
                                                  {"to_user_id": cls.throwaway_uid}]})
        # Remove the random friend user we created
        if cls.friend_uid:
            DB.users.delete_one({"user_id": cls.friend_uid})
            DB.friends.delete_many({"user_id": cls.friend_uid})
            DB.friends.delete_many({"friend_id": cls.friend_uid})

    def test_delete_requires_auth(self):
        r = requests.delete(f"{API}/account")
        assert r.status_code == 401

    def test_delete_wipes_everything(self):
        # Sanity: seeded rows exist
        assert DB.users.find_one({"user_id": self.throwaway_uid}) is not None
        assert DB.plants.count_documents({"user_id": self.throwaway_uid}) == 1
        assert DB.user_sessions.count_documents({"user_id": self.throwaway_uid}) == 2

        r = requests.delete(f"{API}/account", headers=_h(self.throwaway_token))
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") is True

        # All user-owned data gone
        assert DB.users.find_one({"user_id": self.throwaway_uid}) is None
        assert DB.plants.count_documents({"user_id": self.throwaway_uid}) == 0
        assert DB.goals.count_documents({"user_id": self.throwaway_uid}) == 0
        assert DB.focus_sessions.count_documents({"user_id": self.throwaway_uid}) == 0
        assert DB.daily_quests.count_documents({"user_id": self.throwaway_uid}) == 0
        assert DB.user_sessions.count_documents({"user_id": self.throwaway_uid}) == 0
        # BOTH friend link directions removed
        assert DB.friends.count_documents({"user_id": self.throwaway_uid}) == 0
        assert DB.friends.count_documents({"friend_id": self.throwaway_uid}) == 0
        # friend_requests (sent+received) removed
        assert DB.friend_requests.count_documents({"from_user_id": self.throwaway_uid}) == 0
        assert DB.friend_requests.count_documents({"to_user_id": self.throwaway_uid}) == 0

    def test_session_token_no_longer_works(self):
        r = requests.get(f"{API}/auth/me", headers=_h(self.throwaway_token))
        assert r.status_code == 401


# ---------- Friend-request batching regression ----------
class TestFriendRequestsBatching:
    created_req_id = None

    @classmethod
    def teardown_class(cls):
        # Remove any request we sent between the two seeded users
        DB.friend_requests.delete_many({
            "from_user_id": {"$in": ["ui-test-user", "friend-test-user"]},
            "to_user_id": {"$in": ["ui-test-user", "friend-test-user"]},
            "status": "pending",
        })

    def test_send_request_between_seeded_users(self):
        # Make sure they are NOT already friends? They are (per credentials).
        # POST needs a friend code — send from UI Tester to Ferny using Ferny's code.
        ferny = DB.users.find_one({"user_id": "friend-test-user"}, {"_id": 0, "friend_code": 1})
        assert ferny and ferny.get("friend_code")
        # Ensure not already friends: temporarily unlink so request is allowed
        DB.friends.delete_many({"user_id": "ui-test-user", "friend_id": "friend-test-user"})
        DB.friends.delete_many({"user_id": "friend-test-user", "friend_id": "ui-test-user"})
        # Clear stale requests
        DB.friend_requests.delete_many({
            "from_user_id": {"$in": ["ui-test-user", "friend-test-user"]},
            "to_user_id": {"$in": ["ui-test-user", "friend-test-user"]},
        })
        r = requests.post(f"{API}/friends/requests", headers=_h(UI_TOKEN),
                          json={"code": ferny["friend_code"]})
        assert r.status_code in (200, 201), r.text

    def test_incoming_and_outgoing_have_correct_names(self):
        # UI Tester (sender) should have outgoing entry pointing at Ferny
        r1 = requests.get(f"{API}/friends/requests", headers=_h(UI_TOKEN))
        assert r1.status_code == 200
        d1 = r1.json()
        assert "incoming" in d1 and "outgoing" in d1
        out = [o for o in d1["outgoing"] if o["user_id"] == "friend-test-user"]
        assert out, f"Missing outgoing to friend-test-user: {d1}"
        assert out[0]["name"] == "Ferny", out

        # Ferny (receiver) should see incoming from UI Tester
        r2 = requests.get(f"{API}/friends/requests", headers=_h(FRIEND_TOKEN))
        assert r2.status_code == 200
        d2 = r2.json()
        inc = [i for i in d2["incoming"] if i["user_id"] == "ui-test-user"]
        assert inc, f"Missing incoming from ui-test-user: {d2}"
        assert inc[0]["name"] == "UI Tester", inc

    def test_restore_friend_link(self):
        # Re-link the two seeded users so subsequent runs are back to the seeded state
        now = datetime.now(timezone.utc)
        for a, b in (("ui-test-user", "friend-test-user"), ("friend-test-user", "ui-test-user")):
            DB.friends.update_one({"user_id": a, "friend_id": b},
                                    {"$setOnInsert": {"created_at": now}}, upsert=True)
        assert DB.friends.count_documents({"user_id": "ui-test-user", "friend_id": "friend-test-user"}) == 1


# ---------- Regression on core endpoints ----------
class TestRegression:
    def test_settings_get(self):
        r = requests.get(f"{API}/settings", headers=_h(UI_TOKEN))
        assert r.status_code == 200
        d = r.json()
        for k in ("notifications_enabled", "focus_lock_enabled", "strict_lock_enabled"):
            assert k in d

    def test_settings_patch_idempotent(self):
        r = requests.patch(f"{API}/settings", headers=_h(UI_TOKEN),
                            json={"notifications_enabled": True,
                                  "focus_lock_enabled": True,
                                  "strict_lock_enabled": True})
        assert r.status_code == 200
        d = r.json()
        assert d.get("notifications_enabled") is True
        assert d.get("focus_lock_enabled") is True
        assert d.get("strict_lock_enabled") is True

    def test_focus_sessions_today(self):
        r = requests.get(f"{API}/focus-sessions/today", headers=_h(UI_TOKEN))
        assert r.status_code == 200

    def test_plants_current(self):
        r = requests.get(f"{API}/plants/current", headers=_h(UI_TOKEN))
        assert r.status_code == 200
        d = r.json()
        assert "plant_id" in d or "name" in d

    def test_streak_freezes_status(self):
        r = requests.get(f"{API}/streak-freezes/status", headers=_h(UI_TOKEN))
        assert r.status_code == 200

    def test_goals_crud(self):
        title = f"TEST_regression_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/goals", headers=_h(UI_TOKEN), json={"title": title})
        assert r.status_code in (200, 201), r.text
        gid = r.json().get("goal_id") or r.json().get("id")
        assert gid
        # list
        rlist = requests.get(f"{API}/goals", headers=_h(UI_TOKEN))
        assert rlist.status_code == 200
        assert any((g.get("goal_id") or g.get("id")) == gid for g in rlist.json())
        # delete
        rdel = requests.delete(f"{API}/goals/{gid}", headers=_h(UI_TOKEN))
        assert rdel.status_code in (200, 204)

    def test_focus_break_endpoint(self):
        r = requests.post(f"{API}/plants/focus-break", headers=_h(UI_TOKEN),
                           json={"duration_seconds": 5})
        # Endpoint should exist (200/400 both acceptable; not 404/500)
        assert r.status_code in (200, 400), f"{r.status_code} {r.text}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
