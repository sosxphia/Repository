"""
Iteration 14 tests — PayPal removal + monthly streak-freeze claim + revive.
"""
import os
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://grow-by-goals.preview.emergentagent.com").rstrip("/")
TOKEN = "uitest_token_123"
UID = "ui-test-user"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def db():
    c = MongoClient("mongodb://localhost:27017")
    yield c["test_database"]
    c.close()


@pytest.fixture
def _reset_freeze_state(db):
    # Reset ui-test-user freeze state before the freeze tests
    db.users.update_one(
        {"user_id": UID},
        {"$set": {"streak_freezes": 0}, "$unset": {"last_freeze_claim_month": ""}},
    )
    yield
    db.users.update_one(
        {"user_id": UID},
        {"$set": {"streak_freezes": 0}, "$unset": {"last_freeze_claim_month": ""}},
    )


# ---------- PayPal removal ----------
class TestPaypalRemoved:
    @pytest.mark.parametrize("method,path", [
        ("POST", "/api/paypal/orders"),
        ("GET", "/api/paypal/orders/anything/status"),
        ("GET", "/api/paypal/return"),
        ("GET", "/api/paypal/cancel"),
    ])
    def test_paypal_routes_404(self, method, path):
        r = requests.request(method, f"{BASE}{path}", headers=HEADERS, json={} if method == "POST" else None, timeout=15)
        assert r.status_code == 404, f"{method} {path} → {r.status_code}"

    def test_core_endpoints_still_work(self):
        assert requests.get(f"{BASE}/api/auth/me", headers=HEADERS, timeout=15).status_code == 200
        assert requests.get(f"{BASE}/api/stats", headers=HEADERS, timeout=15).status_code == 200
        assert requests.get(f"{BASE}/api/plants/current", headers=HEADERS, timeout=15).status_code == 200


# ---------- Streak freeze status + claim ----------
class TestStreakFreezes:
    def test_status_requires_auth(self):
        r = requests.get(f"{BASE}/api/streak-freezes/status", timeout=15)
        assert r.status_code == 401

    def test_claim_requires_auth(self):
        r = requests.post(f"{BASE}/api/streak-freezes/claim", timeout=15)
        assert r.status_code == 401

    def test_status_initial_claimable(self, db, _reset_freeze_state):
        r = requests.get(f"{BASE}/api/streak-freezes/status", headers=HEADERS, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["claimable"] is True
        assert body["streak_freezes"] == 0
        assert body["month"] == datetime.now(timezone.utc).strftime("%Y-%m")

    def test_claim_grants_once_then_blocks(self, db, _reset_freeze_state):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        # First claim → granted
        r1 = requests.post(f"{BASE}/api/streak-freezes/claim", headers=HEADERS, timeout=15)
        assert r1.status_code == 200
        b1 = r1.json()
        assert b1["granted"] is True
        assert b1["month"] == month
        assert b1["streak_freezes"] == 1

        # DB check
        u = db.users.find_one({"user_id": UID}, {"_id": 0, "streak_freezes": 1, "last_freeze_claim_month": 1})
        assert u["streak_freezes"] == 1
        assert u["last_freeze_claim_month"] == month

        # Second claim → blocked
        r2 = requests.post(f"{BASE}/api/streak-freezes/claim", headers=HEADERS, timeout=15)
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["granted"] is False
        assert b2["reason"] == "already_claimed_this_month"

        # Status now not claimable
        r3 = requests.get(f"{BASE}/api/streak-freezes/status", headers=HEADERS, timeout=15).json()
        assert r3["claimable"] is False
        assert r3["streak_freezes"] == 1


# ---------- Revive endpoint (frontend calls POST /api/plants/revive) ----------
class TestReviveEndpoint:
    PID = "plant_f950c13f4790"

    def _kill(self, db):
        db.plants.update_one(
            {"plant_id": self.PID},
            {"$set": {"is_dead": True, "died_at": datetime.now(timezone.utc)}, "$unset": {"revived_at": ""}},
        )

    def _restore(self, db):
        db.plants.update_one(
            {"plant_id": self.PID},
            {"$set": {"is_dead": False}, "$unset": {"died_at": "", "revived_at": ""}},
        )

    def test_revive_requires_auth(self):
        r = requests.post(f"{BASE}/api/plants/revive", timeout=15)
        assert r.status_code == 401

    def test_revive_404_when_no_dead_tree(self, db):
        # Ensure plant is alive
        self._restore(db)
        r = requests.post(f"{BASE}/api/plants/revive", headers=HEADERS, timeout=15)
        assert r.status_code == 404, f"expected 404 when no dead tree, got {r.status_code}: {r.text[:200]}"

    def test_revive_dead_tree_returns_alive_serialized_plant(self, db):
        try:
            self._kill(db)
            # Confirm it's actually dead
            pre = db.plants.find_one({"plant_id": self.PID}, {"_id": 0})
            assert pre["is_dead"] is True

            r = requests.post(f"{BASE}/api/plants/revive", headers=HEADERS, timeout=15)
            assert r.status_code == 200, f"revive failed: {r.status_code} — {r.text[:200]}"
            plant = r.json()

            # Serialized response checks
            assert plant.get("plant_id") == self.PID
            assert plant.get("is_dead") in (False, None) or plant.get("is_dead") is False
            assert plant.get("died_at") in (None, "") or plant.get("died_at") is None
            # Note: _serialize_plant does not currently include revived_at in the API response.
            # DB-level check below verifies it is persisted.

            # DB state checks
            doc = db.plants.find_one({"plant_id": self.PID}, {"_id": 0})
            assert doc["is_dead"] is False
            assert doc.get("died_at") is None
            assert doc.get("revived_at") is not None

            # user.last_activity_date refreshed so stale-sweep won't re-kill immediately
            u = db.users.find_one({"user_id": UID}, {"_id": 0, "last_activity_date": 1})
            assert u.get("last_activity_date") is not None
            # It should be very recent (within last 60s)
            lad = u["last_activity_date"]
            if isinstance(lad, str):
                # tolerate ISO string
                lad_dt = datetime.fromisoformat(lad.replace("Z", "+00:00"))
            else:
                lad_dt = lad
            if lad_dt.tzinfo is None:
                lad_dt = lad_dt.replace(tzinfo=timezone.utc)
            delta = (datetime.now(timezone.utc) - lad_dt).total_seconds()
            assert delta < 120, f"last_activity_date not refreshed ({delta}s old)"

            # GET /plants/current confirms alive
            r2 = requests.get(f"{BASE}/api/plants/current", headers=HEADERS, timeout=15)
            assert r2.status_code == 200
            cur = r2.json()
            assert cur.get("plant_id") == self.PID
            assert cur.get("is_dead") in (False, None)
        finally:
            self._restore(db)
