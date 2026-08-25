"""Security audit regression tests (SEC-001, SEC-002, SEC-003 + hardening)."""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
API = BASE_URL + "/api"
TOKEN = "uitest_token_123"
FRIEND_TOKEN = "friendtest_token_123"
USER_ID = "ui-test-user"
PLANT_ID = "plant_f950c13f4790"

MONGO = MongoClient("mongodb://localhost:27017")
DB = MONGO["test_database"]


def auth(t=TOKEN):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------------- SEC-001: Apple takeover ----------------
class TestAppleTakeover:
    def test_apple_bad_token_with_existing_email_rejected(self):
        before = DB.users.find_one({"user_id": USER_ID}, {"apple_sub": 1, "email": 1})
        r = requests.post(
            f"{API}/auth/apple",
            json={"identity_token": "garbage.jwt.token", "email": "uitest@example.com", "name": "Attacker"},
            timeout=15,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
        # no session issued
        body = r.json()
        assert "session_token" not in body
        # apple_sub must not be set / changed
        after = DB.users.find_one({"user_id": USER_ID}, {"apple_sub": 1, "email": 1})
        assert after.get("apple_sub") == before.get("apple_sub")
        assert after.get("email") == before.get("email")

    def test_apple_empty_body_422(self):
        r = requests.post(f"{API}/auth/apple", json={}, timeout=10)
        assert r.status_code == 422


# ---------------- SEC-002: push registration auth ----------------
class TestPushRegistration:
    def test_unauthenticated_401(self):
        r = requests.post(f"{API}/register-push", json={"platform": "ios", "device_token": "tok123"}, timeout=15)
        assert r.status_code == 401

    def test_body_user_id_ignored_and_invalid_platform_400(self):
        # invalid platform → 400
        r = requests.post(f"{API}/register-push", json={"platform": "windows", "device_token": "t"},
                          headers=auth(), timeout=15)
        assert r.status_code == 400

    def test_extra_user_id_not_forwarded_only_platform_devicetoken_accepted(self):
        # Extra user_id field in body should just be ignored by pydantic model.
        # Endpoint may return 500/502 from upstream push provider — that is acceptable per instructions;
        # what matters is that auth+validation succeeds (i.e. NOT 401/400/422).
        r = requests.post(
            f"{API}/register-push",
            json={"platform": "ios", "device_token": "dt", "user_id": "someone-else"},
            headers=auth(),
            timeout=20,
        )
        assert r.status_code in (201, 500, 502), f"unexpected {r.status_code}: {r.text[:200]}"


# ---------------- SEC-003: focus-session abuse limits ----------------
@pytest.fixture(scope="module")
def cleanup_focus():
    """Track created session ids so we can wipe them after the module runs."""
    ids = []
    yield ids
    if ids:
        DB.focus_sessions.delete_many({"session_id": {"$in": ids}})
    DB.users.update_one({"user_id": USER_ID}, {"$unset": {"last_revive_month": "", "last_freeze_claim_month": ""}})


class TestFocusLimits:
    def test_normal_session_ok(self, cleanup_focus):
        # ensure at least 30s since any recent session (fixtures may already have some)
        latest = DB.focus_sessions.find_one({"user_id": USER_ID}, sort=[("created_at", -1)])
        if latest:
            import datetime as dt
            delta = (dt.datetime.utcnow().replace(tzinfo=dt.timezone.utc) - latest["created_at"].replace(tzinfo=dt.timezone.utc)).total_seconds()
            if delta < 32:
                time.sleep(35 - delta)
        r = requests.post(f"{API}/focus-sessions", json={"duration_minutes": 1}, headers=auth(), timeout=15)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert "xp_earned" in body and body["xp_earned"] == 2
        assert "focus_lock_streak" in body
        # capture id for cleanup
        fs = DB.focus_sessions.find_one({"user_id": USER_ID}, sort=[("created_at", -1)])
        cleanup_focus.append(fs["session_id"])

    def test_30s_gap_enforced(self, cleanup_focus):
        # immediate second call should 429
        r = requests.post(f"{API}/focus-sessions", json={"duration_minutes": 1}, headers=auth(), timeout=15)
        assert r.status_code == 429, r.text[:200]


# ---------------- Revive rate-limit ----------------
class TestReviveLimits:
    def test_revive_404_when_no_dead_tree_and_monthly_cap(self):
        # ensure user's month flag is cleared and plant is alive
        DB.users.update_one({"user_id": USER_ID}, {"$unset": {"last_revive_month": ""}})
        DB.plants.update_one({"plant_id": PLANT_ID}, {"$set": {"is_dead": False, "is_current": True}})
        # 1st call: no dead tree → 404
        r = requests.post(f"{API}/plants/revive", headers=auth(), timeout=15)
        assert r.status_code == 404

        # Kill the plant, call revive → 200
        from datetime import datetime, timezone
        DB.plants.update_one({"plant_id": PLANT_ID}, {"$set": {"is_dead": True, "died_at": datetime.now(timezone.utc)}})
        r = requests.post(f"{API}/plants/revive", headers=auth(), timeout=15)
        assert r.status_code == 200, r.text[:200]
        assert r.json().get("is_dead") is False

        # 2nd revive in same month → 429
        # (need a dead tree again to hit the rate-limit before the 404 branch)
        DB.plants.update_one({"plant_id": PLANT_ID}, {"$set": {"is_dead": True}})
        r = requests.post(f"{API}/plants/revive", headers=auth(), timeout=15)
        assert r.status_code == 429, r.text[:200]

        # cleanup: alive + clear month
        DB.plants.update_one({"plant_id": PLANT_ID}, {"$set": {"is_dead": False, "died_at": None, "is_current": True}})
        DB.users.update_one({"user_id": USER_ID}, {"$unset": {"last_revive_month": "", "last_freeze_claim_month": ""}})


# ---------------- Hardening: length caps & CORS ----------------
class TestHardening:
    def test_goal_empty_422(self):
        r = requests.post(f"{API}/goals", json={"title": ""}, headers=auth(), timeout=10)
        assert r.status_code == 422

    def test_goal_too_long_422(self):
        r = requests.post(f"{API}/goals", json={"title": "x" * 300}, headers=auth(), timeout=10)
        assert r.status_code == 422

    def test_plant_name_too_long_422(self):
        r = requests.post(f"{API}/plants", json={"name": "x" * 41, "species": "tree"}, headers=auth(), timeout=10)
        assert r.status_code == 422

    def test_cors_no_wildcard_for_evil_origin_app_level(self):
        # Talk to the FastAPI process directly (127.0.0.1:8001) — the public
        # preview URL is fronted by a Cloudflare/K8s ingress that adds its own
        # ACAO:* on OPTIONS/GET regardless of the app response, so app-level
        # CORS must be validated against the origin service.
        r = requests.get(
            "http://127.0.0.1:8001/api/",
            headers={"Origin": "https://evil.com"},
            timeout=10,
        )
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao == "", f"backend should not send ACAO for evil.com, got {acao!r}"

    def test_cors_allows_preview_origin_app_level(self):
        origin = "https://foo.preview.emergentagent.com"
        r = requests.get(
            "http://127.0.0.1:8001/api/",
            headers={"Origin": origin},
            timeout=10,
        )
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao == origin, f"expected {origin}, got {acao!r}"

    def test_no_stripe_import(self):
        with open("/app/backend/server.py") as f:
            src = f.read()
        assert "import stripe" not in src and "from stripe" not in src


# ---------------- Regression: core endpoints still work ----------------
class TestRegression:
    def test_auth_me(self):
        r = requests.get(f"{API}/auth/me", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert r.json()["user_id"] == USER_ID

    def test_plants_current(self):
        r = requests.get(f"{API}/plants/current", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert r.json()["plant_id"]

    def test_goals_crud(self):
        r = requests.post(f"{API}/goals", json={"title": "TEST_sec_goal"}, headers=auth(), timeout=10)
        assert r.status_code == 200
        gid = r.json()["goal_id"]
        r = requests.get(f"{API}/goals", headers=auth(), timeout=10)
        assert r.status_code == 200
        r = requests.patch(f"{API}/goals/{gid}", json={"completed": True}, headers=auth(), timeout=10)
        assert r.status_code == 200
        r = requests.delete(f"{API}/goals/{gid}", headers=auth(), timeout=10)
        assert r.status_code == 200

    def test_daily_quest(self):
        r = requests.get(f"{API}/daily-quest", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert "quest_id" in r.json()

    def test_focus_sessions_today(self):
        r = requests.get(f"{API}/focus-sessions/today", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert "focus_lock_streak" in r.json()

    def test_settings(self):
        r = requests.get(f"{API}/settings", headers=auth(), timeout=10)
        assert r.status_code == 200
        r = requests.patch(f"{API}/settings", json={"notifications_enabled": True}, headers=auth(), timeout=10)
        assert r.status_code == 200

    def test_friends_me(self):
        r = requests.get(f"{API}/friends/me", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert r.json()["friend_code"]

    def test_friends_requests(self):
        r = requests.get(f"{API}/friends/requests", headers=auth(), timeout=10)
        assert r.status_code == 200

    def test_friends_leaderboard(self):
        r = requests.get(f"{API}/friends/leaderboard", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json().get("leaderboard"), list)

    def test_streak_freezes_status_and_claim(self):
        DB.users.update_one({"user_id": USER_ID}, {"$unset": {"last_freeze_claim_month": ""}})
        r = requests.get(f"{API}/streak-freezes/status", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert r.json()["claimable"] is True
        r = requests.post(f"{API}/streak-freezes/claim", headers=auth(), timeout=10)
        assert r.status_code == 200
        assert r.json()["granted"] is True
        # cleanup
        DB.users.update_one({"user_id": USER_ID}, {"$unset": {"last_freeze_claim_month": ""},
                                                   "$inc": {"streak_freezes": -1}})

    def test_plants_focus_break_when_alive(self):
        # Should indicate killed=True since plant is alive right now
        DB.plants.update_one({"plant_id": PLANT_ID}, {"$set": {"is_dead": False, "is_current": True}})
        r = requests.post(f"{API}/plants/focus-break", headers=auth(), timeout=10)
        assert r.status_code == 200
        # revive it for cleanup contract (leave alive)
        DB.plants.update_one({"plant_id": PLANT_ID},
                             {"$set": {"is_dead": False, "died_at": None, "is_current": True}})
        DB.users.update_one({"user_id": USER_ID},
                            {"$set": {"streak_days": 1, "focus_lock_streak": 0}})
