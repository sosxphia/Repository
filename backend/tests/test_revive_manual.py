import asyncio, sys
sys.path.insert(0, '/app/backend')
import server

class FakeResp:
    status_code = 201
    text = ''
    def json(self): return {"status": "COMPLETED"}

class FakeClient:
    def __init__(self, **kw): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): pass
    async def post(self, *a, **kw): return FakeResp()

async def main():
    uid = "ui-test-user"
    plant = await server.db.plants.find_one({"user_id": uid, "is_current": True})
    assert plant and plant.get("is_dead"), "expected a dead current plant"
    pid = plant["plant_id"]
    old_xp = plant.get("xp")
    await server.db.payments.delete_many({"order_id": "TEST_REVIVE_1"})
    await server.db.payments.insert_one({
        "order_id": "TEST_REVIVE_1", "user_id": uid, "product": "tree_revive", "plant_id": pid,
        "amount": "2.99", "currency": "USD", "status": "created", "created_at": server.now_utc(),
    })
    freezes_before = (await server.db.users.find_one({"user_id": uid})).get("streak_freezes", 0)
    async def fake_token(): return "fake"
    server._paypal_access_token = fake_token
    server.httpx.AsyncClient = FakeClient
    s1 = await server._capture_and_grant("TEST_REVIVE_1")
    s2 = await server._capture_and_grant("TEST_REVIVE_1")  # idempotent
    p = await server.db.plants.find_one({"plant_id": pid})
    u = await server.db.users.find_one({"user_id": uid})
    print("statuses:", s1, s2)
    print("is_dead:", p.get("is_dead"), "| died_at:", p.get("died_at"), "| is_current:", p.get("is_current"), "| xp preserved:", p.get("xp") == old_xp)
    print("freezes unchanged:", u.get("streak_freezes", 0) == freezes_before)
    assert s1 == s2 == "completed"
    assert p.get("is_dead") is False and p.get("died_at") is None and p.get("is_current") is True
    assert p.get("xp") == old_xp
    assert u.get("streak_freezes", 0) == freezes_before
    # last_activity_date refreshed to today so tree isn't re-killed
    lad = u.get("last_activity_date")
    assert lad and (server.now_utc().date() - (lad.date() if lad.tzinfo else lad.replace(tzinfo=server.timezone.utc).date())).days == 0
    print("PASS: revive restores tree exactly once, freezes untouched, activity refreshed")
    await server.db.payments.delete_many({"order_id": "TEST_REVIVE_1"})

asyncio.run(main())
