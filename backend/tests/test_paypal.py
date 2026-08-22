"""PayPal Streak Freeze integration tests — sandbox only.

Guardrails:
- Do NOT attempt real buyer approval (needs PayPal login).
- Create at most ONE real sandbox order per test run (module-scoped).
- All authed calls use pre-seeded `uitest_token_123` for ui-test-user
  (already present in test_database.user_sessions).
"""
import os
import re
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://grow-by-goals.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = os.environ.get("DB_NAME", "test_database")

SEEDED_TOKEN = "uitest_token_123"
SEEDED_USER = "ui-test-user"


@pytest.fixture(scope="module")
def db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module", autouse=True)
def ensure_seeded_session(db):
    """Make sure the ui-test-user + session are present and non-expired for this run."""
    # Refresh expiry to be safe
    db.user_sessions.update_one(
        {"session_token": SEEDED_TOKEN},
        {"$set": {
            "session_token": SEEDED_TOKEN,
            "user_id": SEEDED_USER,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        }},
        upsert=True,
    )
    if not db.users.find_one({"user_id": SEEDED_USER}):
        db.users.insert_one({
            "user_id": SEEDED_USER,
            "email": "uitest@example.com",
            "name": "UI Tester",
            "streak_days": 3,
            "streak_freezes": 1,
            "created_at": datetime.now(timezone.utc),
        })


def auth():
    return {"Authorization": f"Bearer {SEEDED_TOKEN}", "Content-Type": "application/json"}


# ---- Auth guards -----------------------------------------------------
class TestPayPalAuthGuards:
    def test_create_order_requires_auth(self):
        r = requests.post(f"{API}/paypal/orders")
        assert r.status_code == 401, r.text

    def test_status_requires_auth(self):
        r = requests.get(f"{API}/paypal/orders/NON_EXISTENT/status")
        assert r.status_code == 401, r.text

    def test_create_order_bad_token(self):
        r = requests.post(
            f"{API}/paypal/orders",
            headers={"Authorization": "Bearer definitely_not_a_real_token"},
        )
        assert r.status_code == 401


# ---- Real sandbox order (created ONCE, reused for the rest) ----------
@pytest.fixture(scope="module")
def sandbox_order(db):
    r = requests.post(f"{API}/paypal/orders", headers=auth())
    assert r.status_code == 200, f"paypal create order failed: {r.status_code} {r.text}"
    body = r.json()
    assert "order_id" in body and body["order_id"], f"missing order_id: {body}"
    assert "approve_url" in body and body["approve_url"], f"missing approve_url: {body}"
    order_id = body["order_id"]
    approve_url = body["approve_url"]
    yield {"order_id": order_id, "approve_url": approve_url}
    # Best-effort cleanup: remove the payment doc so we don't accrete test rows
    db.payments.delete_one({"order_id": order_id})


class TestPayPalCreateOrder:
    def test_order_shape_and_persisted(self, sandbox_order, db):
        oid = sandbox_order["order_id"]
        approve = sandbox_order["approve_url"]
        # PayPal order ids look like uppercase alnum, typically 17 chars
        assert re.match(r"^[A-Z0-9]{5,}$", oid), f"unexpected order_id format: {oid}"
        # Approve URL should be a PayPal sandbox checkout URL
        assert "paypal.com" in approve, f"unexpected approve_url: {approve}"
        # payments doc created with status=created for the seeded user
        p = db.payments.find_one({"order_id": oid})
        assert p is not None, "payments doc not inserted"
        assert p["user_id"] == SEEDED_USER
        assert p["status"] == "created"
        assert p["product"] == "streak_freeze"
        assert str(p["amount"]) == "1.99"
        assert p["currency"] == "USD"


# ---- Status endpoint --------------------------------------------------
class TestPayPalStatus:
    def test_status_for_created_order(self, sandbox_order, db):
        oid = sandbox_order["order_id"]
        r = requests.get(f"{API}/paypal/orders/{oid}/status", headers=auth())
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "created"
        assert "streak_freezes" in data and isinstance(data["streak_freezes"], int)
        # Should match the value stored on the seeded user right now
        u = db.users.find_one({"user_id": SEEDED_USER})
        assert data["streak_freezes"] == int(u.get("streak_freezes", 0))

    def test_status_unknown_order_returns_404(self):
        r = requests.get(f"{API}/paypal/orders/NOPE_DOES_NOT_EXIST/status", headers=auth())
        assert r.status_code == 404, r.text

    def test_status_other_users_order_returns_404(self, db, sandbox_order):
        """Insert a payment doc owned by a different user_id — seeded user must NOT see it."""
        other_order_id = f"TEST_OTHER_{uuid.uuid4().hex[:10].upper()}"
        db.payments.insert_one({
            "order_id": other_order_id,
            "user_id": "someone_else",
            "product": "streak_freeze",
            "amount": "1.99",
            "currency": "USD",
            "status": "created",
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = requests.get(
                f"{API}/paypal/orders/{other_order_id}/status", headers=auth()
            )
            assert r.status_code == 404, r.text
        finally:
            db.payments.delete_one({"order_id": other_order_id})


# ---- Return endpoint (unapproved order must NOT grant a freeze) ------
class TestPayPalReturn:
    def test_return_missing_token_returns_error_html(self):
        r = requests.get(f"{API}/paypal/return")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "Something went wrong" in r.text
        assert "Missing order reference" in r.text

    def test_return_unapproved_does_not_grant(self, sandbox_order, db):
        """Buyer never approved → capture will fail → freeze must NOT be granted."""
        oid = sandbox_order["order_id"]
        before = int(db.users.find_one({"user_id": SEEDED_USER}).get("streak_freezes", 0))
        r = requests.get(f"{API}/paypal/return", params={"token": oid})
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "").lower()
        assert "Payment not completed" in r.text, r.text[:400]
        # Payment must NOT be flipped to completed
        p = db.payments.find_one({"order_id": oid})
        assert p is not None
        assert p["status"] != "completed", f"unapproved order was marked completed: {p}"
        # Streak freezes must NOT have increased
        after = int(db.users.find_one({"user_id": SEEDED_USER}).get("streak_freezes", 0))
        assert after == before, f"freeze granted without approval: {before} -> {after}"


# ---- Cancel endpoint --------------------------------------------------
class TestPayPalCancel:
    def test_cancel_marks_payment_cancelled(self, db):
        """Insert an owned 'created' payment (no real PayPal call) then hit /paypal/cancel."""
        oid = f"TEST_CANCEL_{uuid.uuid4().hex[:10].upper()}"
        db.payments.insert_one({
            "order_id": oid,
            "user_id": SEEDED_USER,
            "product": "streak_freeze",
            "amount": "1.99",
            "currency": "USD",
            "status": "created",
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = requests.get(f"{API}/paypal/cancel", params={"token": oid})
            assert r.status_code == 200
            assert "text/html" in r.headers.get("content-type", "").lower()
            assert "Payment cancelled" in r.text

            # Status endpoint should now report 'cancelled'
            s = requests.get(f"{API}/paypal/orders/{oid}/status", headers=auth())
            assert s.status_code == 200, s.text
            assert s.json()["status"] == "cancelled"
        finally:
            db.payments.delete_one({"order_id": oid})

    def test_cancel_does_not_downgrade_completed(self, db):
        """A payment already in 'completed' state must NOT be flipped to cancelled."""
        oid = f"TEST_DONE_{uuid.uuid4().hex[:10].upper()}"
        db.payments.insert_one({
            "order_id": oid,
            "user_id": SEEDED_USER,
            "product": "streak_freeze",
            "amount": "1.99",
            "currency": "USD",
            "status": "completed",
            "created_at": datetime.now(timezone.utc),
            "paid_at": datetime.now(timezone.utc),
        })
        try:
            r = requests.get(f"{API}/paypal/cancel", params={"token": oid})
            assert r.status_code == 200
            p = db.payments.find_one({"order_id": oid})
            assert p["status"] == "completed", f"completed was overwritten: {p}"
        finally:
            db.payments.delete_one({"order_id": oid})


# ---- Stats field ------------------------------------------------------
class TestStatsHasStreakFreezes:
    def test_stats_exposes_streak_freezes(self, db):
        r = requests.get(f"{API}/stats", headers=auth())
        assert r.status_code == 200, r.text
        s = r.json()
        assert "streak_freezes" in s, f"missing streak_freezes in stats: {s}"
        assert isinstance(s["streak_freezes"], int)
        u = db.users.find_one({"user_id": SEEDED_USER})
        assert s["streak_freezes"] == int(u.get("streak_freezes", 0))


# ---- Regression on existing endpoints --------------------------------
class TestRegressionCoreEndpoints:
    def test_plants_current(self):
        r = requests.get(f"{API}/plants/current", headers=auth())
        assert r.status_code == 200, r.text
        p = r.json()
        for k in ("plant_id", "name", "species", "xp", "is_current", "stage", "progress"):
            assert k in p, f"missing {k} in plant: {p}"

    def test_goals_list(self):
        r = requests.get(f"{API}/goals", headers=auth())
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_stats_regression(self):
        r = requests.get(f"{API}/stats", headers=auth())
        assert r.status_code == 200
        for k in ("streak_days", "total_focus_minutes", "total_tasks_completed",
                  "total_plants", "bloomed_plants", "total_focus_sessions",
                  "streak_freezes"):
            assert k in r.json()

    def test_daily_quest(self):
        r = requests.get(f"{API}/daily-quest", headers=auth())
        assert r.status_code == 200
        for k in ("quest_id", "date", "title", "xp_reward", "completed"):
            assert k in r.json()

    def test_weekly_recap(self):
        r = requests.get(f"{API}/weekly-recap", headers=auth())
        assert r.status_code == 200
        for k in ("week_start", "week_end", "goals_completed", "daily_quests_completed",
                  "plants_bloomed", "plants_grown", "focus_minutes", "focus_sessions",
                  "current_streak"):
            assert k in r.json()
