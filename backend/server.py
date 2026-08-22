from fastapi import FastAPI, APIRouter, HTTPException, Header, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
import jwt
from jwt import PyJWKClient
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------- Helpers ----------
def now_utc():
    return datetime.now(timezone.utc)

def stage_for_xp(xp: int) -> str:
    if xp < 50:
        return "seed"
    if xp < 150:
        return "sprout"
    if xp < 350:
        return "sapling"
    return "bloom"

def stage_progress(xp: int):
    thresholds = [(0, 50, "seed"), (50, 150, "sprout"), (150, 350, "sapling"), (350, 500, "bloom")]
    for lo, hi, name in thresholds:
        if xp < hi:
            return {"stage": name, "stage_min": lo, "stage_max": hi, "in_stage": xp - lo, "stage_span": hi - lo}
    return {"stage": "bloom", "stage_min": 350, "stage_max": 500, "in_stage": min(xp - 350, 150), "stage_span": 150}

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if exp:
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Models ----------
class SessionRequest(BaseModel):
    session_id: str

class AppleAuthRequest(BaseModel):
    identity_token: str
    name: Optional[str] = None
    email: Optional[str] = None

class GoalCreate(BaseModel):
    title: str

class GoalToggle(BaseModel):
    completed: bool

class PlantCreate(BaseModel):
    name: str
    species: Optional[str] = "succulent"

class PlantReset(BaseModel):
    name: Optional[str] = None
    species: Optional[str] = "succulent"

class PlantUpdate(BaseModel):
    note: Optional[str] = None
    name: Optional[str] = None

class DailyQuestToggle(BaseModel):
    completed: bool

class FocusSessionCreate(BaseModel):
    duration_minutes: int  # completed focus minutes

# ---------- Auth ----------
@api_router.post("/auth/session")
async def create_session(payload: SessionRequest):
    session_id = payload.session_id
    async with httpx.AsyncClient(timeout=15.0) as http:
        resp = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = resp.json()
    email = data.get("email")
    name = data.get("name")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Invalid session payload")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": now_utc(),
            "streak_days": 0,
            "last_activity_date": None,
            "total_focus_minutes": 0,
            "total_tasks_completed": 0,
        })
        # Auto-seed first plant
        await db.plants.insert_one({
            "plant_id": f"plant_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "name": "My First Plant",
            "species": "succulent",
            "xp": 0,
            "is_current": True,
            "created_at": now_utc(),
            "bloomed_at": None,
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
_apple_jwks_client: Optional[PyJWKClient] = None

def _get_apple_jwks_client() -> PyJWKClient:
    global _apple_jwks_client
    if _apple_jwks_client is None:
        _apple_jwks_client = PyJWKClient(APPLE_JWKS_URL)
    return _apple_jwks_client

@api_router.post("/auth/apple")
async def auth_apple(payload: AppleAuthRequest):
    audiences = [a.strip() for a in os.environ.get("APPLE_AUDIENCES", "").split(",") if a.strip()]
    if not audiences:
        raise HTTPException(status_code=500, detail="Apple audiences not configured")
    try:
        signing_key = _get_apple_jwks_client().get_signing_key_from_jwt(payload.identity_token)
        claims = jwt.decode(
            payload.identity_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=APPLE_ISSUER,
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Apple identity token: {e}")

    apple_sub = claims.get("sub")
    if not apple_sub:
        raise HTTPException(status_code=401, detail="Missing sub in Apple token")
    token_email = claims.get("email")
    email = token_email or (payload.email if payload.email else None)
    name = payload.name

    # 1) lookup by apple_sub
    existing = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
    # 2) fallback lookup by email to link Apple sign-in with an existing Google user
    if not existing and email:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": {"apple_sub": apple_sub}})

    if existing:
        user_id = existing["user_id"]
        set_fields = {"apple_sub": apple_sub}
        # Apple only returns email/name on FIRST sign-in — never overwrite with nulls
        if email and not existing.get("email"):
            set_fields["email"] = email
        if name and not existing.get("name"):
            set_fields["name"] = name
        await db.users.update_one({"user_id": user_id}, {"$set": set_fields})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "apple_sub": apple_sub,
            "email": email,
            "name": name,
            "picture": None,
            "created_at": now_utc(),
            "streak_days": 0,
            "last_activity_date": None,
            "total_focus_minutes": 0,
            "total_tasks_completed": 0,
        })
        await db.plants.insert_one({
            "plant_id": f"plant_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "name": "My First Plant",
            "species": "succulent",
            "xp": 0,
            "is_current": True,
            "created_at": now_utc(),
            "bloomed_at": None,
        })

    session_token = f"apple_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}

@api_router.get("/auth/me")
async def me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return user

@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}

# ---------- Plants ----------
async def _serialize_plant(p):
    return {
        "plant_id": p["plant_id"],
        "name": p["name"],
        "species": p.get("species", "succulent"),
        "xp": p.get("xp", 0),
        "is_current": p.get("is_current", False),
        "stage": stage_for_xp(p.get("xp", 0)),
        "progress": stage_progress(p.get("xp", 0)),
        "note": p.get("note", ""),
        "created_at": (p.get("created_at") or now_utc()).isoformat(),
        "bloomed_at": p["bloomed_at"].isoformat() if p.get("bloomed_at") else None,
    }

@api_router.get("/plants")
async def list_plants(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    plants = await db.plants.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [await _serialize_plant(p) for p in plants]

@api_router.get("/plants/current")
async def current_plant(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    p = await db.plants.find_one({"user_id": user["user_id"], "is_current": True}, {"_id": 0})
    if not p:
        # Create one
        pid = f"plant_{uuid.uuid4().hex[:12]}"
        doc = {
            "plant_id": pid, "user_id": user["user_id"], "name": "My Plant",
            "species": "succulent", "xp": 0, "is_current": True,
            "created_at": now_utc(), "bloomed_at": None,
        }
        await db.plants.insert_one(doc)
        p = await db.plants.find_one({"plant_id": pid}, {"_id": 0})
    return await _serialize_plant(p)

@api_router.post("/plants")
async def create_plant(payload: PlantCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    # Mark previous current as not current
    await db.plants.update_many({"user_id": user["user_id"], "is_current": True}, {"$set": {"is_current": False}})
    pid = f"plant_{uuid.uuid4().hex[:12]}"
    doc = {
        "plant_id": pid, "user_id": user["user_id"],
        "name": payload.name or "New Plant",
        "species": payload.species or "succulent",
        "xp": 0, "is_current": True,
        "created_at": now_utc(), "bloomed_at": None,
    }
    await db.plants.insert_one(doc)
    p = await db.plants.find_one({"plant_id": pid}, {"_id": 0})
    return await _serialize_plant(p)

@api_router.patch("/plants/{plant_id}")
async def update_plant(plant_id: str, payload: PlantUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {}
    if payload.note is not None:
        updates["note"] = payload.note.strip()[:200]
    if payload.name is not None and payload.name.strip():
        updates["name"] = payload.name.strip()[:40]
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    res = await db.plants.update_one({"plant_id": plant_id, "user_id": user["user_id"]}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Plant not found")
    p = await db.plants.find_one({"plant_id": plant_id}, {"_id": 0})
    return await _serialize_plant(p)

async def _add_xp(user_id: str, amount: int):
    p = await db.plants.find_one({"user_id": user_id, "is_current": True}, {"_id": 0})
    if not p:
        pid = f"plant_{uuid.uuid4().hex[:12]}"
        await db.plants.insert_one({
            "plant_id": pid, "user_id": user_id, "name": "My Plant",
            "species": "succulent", "xp": 0, "is_current": True,
            "created_at": now_utc(), "bloomed_at": None,
        })
        p = await db.plants.find_one({"plant_id": pid}, {"_id": 0})
    new_xp = p.get("xp", 0) + amount
    updates = {"xp": new_xp}
    if new_xp >= 500 and not p.get("bloomed_at"):
        updates["bloomed_at"] = now_utc()
    await db.plants.update_one({"plant_id": p["plant_id"]}, {"$set": updates})
    return await db.plants.find_one({"plant_id": p["plant_id"]}, {"_id": 0})

@api_router.post("/plants/{plant_id}/reset")
async def reset_plant(plant_id: str, payload: Optional[PlantReset] = None, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    p = await db.plants.find_one({"plant_id": plant_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Plant not found")
    # Archive: mark not current, keep, then create fresh current
    await db.plants.update_one({"plant_id": plant_id}, {"$set": {"is_current": False}})
    pid = f"plant_{uuid.uuid4().hex[:12]}"
    new_name = (payload.name.strip() if payload and payload.name else "") or "New Plant"
    new_species = (payload.species if payload and payload.species else "succulent")
    await db.plants.insert_one({
        "plant_id": pid, "user_id": user["user_id"], "name": new_name,
        "species": new_species, "xp": 0, "is_current": True,
        "created_at": now_utc(), "bloomed_at": None,
    })
    new_p = await db.plants.find_one({"plant_id": pid}, {"_id": 0})
    return await _serialize_plant(new_p)

# ---------- Goals ----------
@api_router.get("/goals")
async def list_goals(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    goals = await db.goals.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for g in goals:
        if g.get("created_at"):
            g["created_at"] = g["created_at"].isoformat()
        if g.get("completed_at"):
            g["completed_at"] = g["completed_at"].isoformat()
    return goals

@api_router.post("/goals")
async def create_goal(payload: GoalCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    doc = {
        "goal_id": f"goal_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "title": payload.title.strip(),
        "completed": False,
        "created_at": now_utc(),
        "completed_at": None,
        "xp_reward": 10,
    }
    await db.goals.insert_one(doc)
    return {
        **{k: v for k, v in doc.items() if k != "_id"},
        "created_at": doc["created_at"].isoformat(),
        "completed_at": None,
    }

async def _update_activity(user_id: str, focus_minutes: int = 0, tasks_completed: int = 0):
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    today = now_utc().date()
    last = user.get("last_activity_date")
    if last:
        last_date = last.date() if hasattr(last, "date") else datetime.fromisoformat(last).date()
        if last_date == today:
            new_streak = user.get("streak_days", 1)
        elif (today - last_date).days == 1:
            new_streak = user.get("streak_days", 0) + 1
        else:
            new_streak = 1
    else:
        new_streak = 1
    updates = {
        "streak_days": new_streak,
        "last_activity_date": now_utc(),
        "total_focus_minutes": user.get("total_focus_minutes", 0) + focus_minutes,
        "total_tasks_completed": user.get("total_tasks_completed", 0) + tasks_completed,
    }
    await db.users.update_one({"user_id": user_id}, {"$set": updates})

@api_router.patch("/goals/{goal_id}")
async def toggle_goal(goal_id: str, payload: GoalToggle, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    g = await db.goals.find_one({"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0})
    if not g:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {"completed": payload.completed}
    xp_delta = 0
    if payload.completed and not g.get("completed"):
        updates["completed_at"] = now_utc()
        xp_delta = g.get("xp_reward", 10)
    elif not payload.completed and g.get("completed"):
        updates["completed_at"] = None
        xp_delta = -g.get("xp_reward", 10)
    await db.goals.update_one({"goal_id": goal_id}, {"$set": updates})
    if xp_delta != 0:
        await _add_xp(user["user_id"], xp_delta)
    if payload.completed and not g.get("completed"):
        await _update_activity(user["user_id"], tasks_completed=1)
    return {"ok": True, "xp_delta": xp_delta}

@api_router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.goals.delete_one({"goal_id": goal_id, "user_id": user["user_id"]})
    return {"ok": True}

# ---------- Daily Quest ----------
DAILY_QUEST_POOL = [
    ("Focus for 25 minutes without stopping", 30),
    ("Complete 3 regular goals today", 30),
    ("Study or read for 45 minutes total", 35),
    ("Tackle your hardest task first thing", 30),
    ("Take a mindful 5-minute break", 25),
    ("Add 3 new goals for tomorrow", 25),
    ("Do one thing that scares you a little", 40),
    ("Learn one new thing today", 30),
]

def _today_str():
    return now_utc().date().isoformat()

def _pick_quest_for(user_id: str, date_str: str):
    # deterministic per user+date
    seed = sum(ord(c) for c in user_id + date_str)
    return DAILY_QUEST_POOL[seed % len(DAILY_QUEST_POOL)]

@api_router.get("/daily-quest")
async def get_daily_quest(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    date_str = _today_str()
    q = await db.daily_quests.find_one(
        {"user_id": user["user_id"], "date": date_str}, {"_id": 0}
    )
    if not q:
        title, xp = _pick_quest_for(user["user_id"], date_str)
        q = {
            "quest_id": f"dq_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "date": date_str,
            "title": title,
            "xp_reward": xp,
            "completed": False,
            "created_at": now_utc(),
            "completed_at": None,
        }
        await db.daily_quests.insert_one(q)
        q = await db.daily_quests.find_one({"quest_id": q["quest_id"]}, {"_id": 0})
    return {
        "quest_id": q["quest_id"],
        "date": q["date"],
        "title": q["title"],
        "xp_reward": q["xp_reward"],
        "completed": q.get("completed", False),
    }

@api_router.patch("/daily-quest/{quest_id}")
async def toggle_daily_quest(quest_id: str, payload: DailyQuestToggle, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    q = await db.daily_quests.find_one({"quest_id": quest_id, "user_id": user["user_id"]}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {"completed": payload.completed}
    xp_delta = 0
    if payload.completed and not q.get("completed"):
        updates["completed_at"] = now_utc()
        xp_delta = q.get("xp_reward", 30)
    elif not payload.completed and q.get("completed"):
        updates["completed_at"] = None
        xp_delta = -q.get("xp_reward", 30)
    await db.daily_quests.update_one({"quest_id": quest_id}, {"$set": updates})
    if xp_delta != 0:
        await _add_xp(user["user_id"], xp_delta)
    if payload.completed and not q.get("completed"):
        await _update_activity(user["user_id"], tasks_completed=1)
    return {"ok": True, "xp_delta": xp_delta}

# ---------- Focus Sessions ----------
@api_router.post("/focus-sessions")
async def create_focus_session(payload: FocusSessionCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    minutes = max(1, min(payload.duration_minutes, 240))
    xp = minutes * 2
    doc = {
        "session_id": f"fs_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "duration_minutes": minutes,
        "xp_earned": xp,
        "created_at": now_utc(),
    }
    await db.focus_sessions.insert_one(doc)
    await _add_xp(user["user_id"], xp)
    await _update_activity(user["user_id"], focus_minutes=minutes)
    return {"ok": True, "xp_earned": xp, "duration_minutes": minutes}

# ---------- Stats ----------
@api_router.get("/weekly-recap")
async def weekly_recap(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    end = now_utc()
    start = end - timedelta(days=7)
    goals_done = await db.goals.count_documents({
        "user_id": user["user_id"],
        "completed": True,
        "completed_at": {"$gte": start},
    })
    plants_bloomed = await db.plants.count_documents({
        "user_id": user["user_id"],
        "bloomed_at": {"$gte": start},
    })
    plants_grown = await db.plants.count_documents({
        "user_id": user["user_id"],
        "created_at": {"$gte": start},
    })
    quests_done = await db.daily_quests.count_documents({
        "user_id": user["user_id"],
        "completed": True,
        "completed_at": {"$gte": start},
    })
    # Focus minutes this week
    pipeline = [
        {"$match": {"user_id": user["user_id"], "created_at": {"$gte": start}}},
        {"$group": {"_id": None, "total": {"$sum": "$duration_minutes"}}},
    ]
    focus_agg = await db.focus_sessions.aggregate(pipeline).to_list(1)
    focus_minutes = focus_agg[0]["total"] if focus_agg else 0
    focus_sessions = await db.focus_sessions.count_documents({
        "user_id": user["user_id"],
        "created_at": {"$gte": start},
    })
    return {
        "week_start": start.date().isoformat(),
        "week_end": end.date().isoformat(),
        "goals_completed": goals_done,
        "daily_quests_completed": quests_done,
        "plants_bloomed": plants_bloomed,
        "plants_grown": plants_grown,
        "focus_minutes": focus_minutes,
        "focus_sessions": focus_sessions,
        "current_streak": user.get("streak_days", 0),
    }

@api_router.get("/stats")
async def get_stats(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    total_plants = await db.plants.count_documents({"user_id": user["user_id"]})
    bloomed = await db.plants.count_documents({"user_id": user["user_id"], "bloomed_at": {"$ne": None}})
    total_sessions = await db.focus_sessions.count_documents({"user_id": user["user_id"]})
    return {
        "streak_days": user.get("streak_days", 0),
        "total_focus_minutes": user.get("total_focus_minutes", 0),
        "total_tasks_completed": user.get("total_tasks_completed", 0),
        "total_plants": total_plants,
        "bloomed_plants": bloomed,
        "total_focus_sessions": total_sessions,
    }

@api_router.get("/")
async def root():
    return {"message": "SproutGoals API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    # Migrate legacy email unique index → sparse (Apple users may not have email)
    try:
        idx_info = await db.users.index_information()
        if "email_1" in idx_info and (idx_info["email_1"].get("unique") or not idx_info["email_1"].get("sparse")):
            await db.users.drop_index("email_1")
    except Exception as e:
        logger.warning(f"index migration: {e}")
    await db.users.create_index("email", sparse=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("apple_sub", unique=True, sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.plants.create_index("user_id")
    await db.plants.create_index("plant_id", unique=True)
    await db.goals.create_index("user_id")
    await db.goals.create_index("goal_id", unique=True)
    await db.daily_quests.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.daily_quests.create_index("quest_id", unique=True)
    await db.focus_sessions.create_index("user_id")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
