from fastapi import FastAPI, APIRouter, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
import asyncio
import os
import logging
import uuid
import secrets
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
    title: str = Field(min_length=1, max_length=200)

class GoalToggle(BaseModel):
    completed: bool

class PlantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    species: Optional[str] = Field(default="succulent", max_length=40)

class PlantReset(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    species: Optional[str] = Field(default="succulent", max_length=40)

class PlantUpdate(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)

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
    # SECURITY: only trust the email Apple signed into the token. A client-supplied
    # email must never be used to look up or link an existing account (takeover risk).
    email = claims.get("email")
    email_verified = str(claims.get("email_verified", "true")).lower() == "true"
    name = payload.name

    # Accounts are matched on the Apple subject only
    existing = await db.users.find_one({"apple_sub": apple_sub}, {"_id": 0})
    # Link to an existing account only when Apple itself vouches for the email
    if not existing and email and email_verified:
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
    now = now_utc()
    is_dead = p.get("is_dead", False)
    return {
        "plant_id": p["plant_id"],
        "name": p["name"],
        "species": p.get("species", "tree"),
        "xp": p.get("xp", 0),
        "is_current": p.get("is_current", False),
        "is_dead": is_dead,
        "needs_naming": p.get("needs_naming", False),
        "stage": "seed" if is_dead else stage_for_xp(p.get("xp", 0)),
        "progress": stage_progress(0 if is_dead else p.get("xp", 0)),
        "note": p.get("note", ""),
        "created_at": (p.get("created_at") or now).isoformat(),
        "bloomed_at": p["bloomed_at"].isoformat() if p.get("bloomed_at") else None,
        "died_at": p["died_at"].isoformat() if p.get("died_at") else None,
    }

async def _check_and_kill_stale_plant(user):
    """If last_activity was 2+ days ago, current tree dies (unless a freeze is consumed first)."""
    last = user.get("last_activity_date")
    if not last:
        return
    if hasattr(last, "date"):
        last_date = last.date() if last.tzinfo else last.replace(tzinfo=timezone.utc).date()
    else:
        last_date = datetime.fromisoformat(str(last)).date()
    today = now_utc().date()
    gap = (today - last_date).days
    if gap < 2:
        return  # missing 1 day is a grace period
    # Consume freezes to cover missed days
    freezes = int(user.get("streak_freezes", 0))
    missed = gap - 1
    if freezes >= missed:
        # Consume freezes: streak survives, bump last_activity_date to yesterday so gap becomes 1
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"streak_freezes": -missed},
             "$set": {"last_activity_date": now_utc() - timedelta(days=1)}},
        )
        return
    # Not enough freezes: kill current tree, reset streak
    consumed = freezes
    plant = await db.plants.find_one(
        {"user_id": user["user_id"], "is_current": True, "is_dead": {"$ne": True}},
        {"_id": 0, "name": 1},
    )
    res = await db.plants.update_many(
        {"user_id": user["user_id"], "is_current": True, "is_dead": {"$ne": True}},
        {"$set": {"is_dead": True, "died_at": now_utc()}},
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"streak_days": 0, "streak_freezes": max(0, freezes - consumed)}},
    )
    if res.modified_count > 0:
        try:
            name = plant["name"] if plant else "Your tree"
            await send_push(
                recipients=[user["user_id"]],
                data={
                    "title": "Your tree died 💔",
                    "message": f"{name} couldn't survive the missed days. Revive it or replant a new seed in the app.",
                    "action_url": "/(tabs)/garden",
                },
                idempotency_key=f"tree-died:{user['user_id']}:{now_utc().date().isoformat()}",
            )
        except Exception as e:
            logger.warning(f"Push failed (non-blocking): {e}")

@api_router.post("/plants/revive")
async def revive_plant(authorization: Optional[str] = Header(None)):
    """Bring the current dead tree back with all its progress (PRO benefit)."""
    user = await get_current_user(authorization)
    month = now_utc().strftime("%Y-%m")
    if user.get("last_revive_month") == month:
        raise HTTPException(status_code=429, detail="You can revive one tree per month")
    plant = await db.plants.find_one(
        {"user_id": user["user_id"], "is_current": True, "is_dead": True}, {"_id": 0}
    )
    if not plant:
        raise HTTPException(status_code=404, detail="No dead tree to revive")
    await db.plants.update_one(
        {"plant_id": plant["plant_id"]},
        {"$set": {"is_dead": False, "died_at": None, "revived_at": now_utc()}},
    )
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "last_activity_date": now_utc(),
            "streak_days": max(1, int(user.get("streak_days", 0))),
            "last_revive_month": month,
        }},
    )
    fresh = await db.plants.find_one({"plant_id": plant["plant_id"]}, {"_id": 0})
    return await _serialize_plant(fresh)

@api_router.post("/plants/focus-break")
async def focus_break_kill(authorization: Optional[str] = Header(None)):
    """Focus Lock broken: user left the app mid-session for too long — the tree dies."""
    user = await get_current_user(authorization)
    plant = await db.plants.find_one(
        {"user_id": user["user_id"], "is_current": True, "is_dead": {"$ne": True}},
        {"_id": 0, "name": 1},
    )
    res = await db.plants.update_many(
        {"user_id": user["user_id"], "is_current": True, "is_dead": {"$ne": True}},
        {"$set": {"is_dead": True, "died_at": now_utc()}},
    )
    if res.modified_count == 0:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"focus_lock_streak": 0}})
        return {"killed": False, "name": plant["name"] if plant else None}
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"streak_days": 0, "focus_lock_streak": 0}},
    )
    return {"killed": True, "name": plant["name"] if plant else "Your tree"}

@api_router.get("/plants")
async def list_plants(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    plants = await db.plants.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [await _serialize_plant(p) for p in plants]

@api_router.get("/plants/current")
async def current_plant(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await _check_and_kill_stale_plant(user)
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    p = await db.plants.find_one({"user_id": user["user_id"], "is_current": True}, {"_id": 0})
    if not p:
        # Create one (new user — needs to pick a name)
        pid = f"plant_{uuid.uuid4().hex[:12]}"
        doc = {
            "plant_id": pid, "user_id": user["user_id"], "name": "My Tree",
            "species": "tree", "xp": 0, "is_current": True,
            "needs_naming": True,
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
        updates["needs_naming"] = False
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
            "plant_id": pid, "user_id": user_id, "name": "My Tree",
            "species": "tree", "xp": 0, "is_current": True,
            "needs_naming": True,
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
DAILY_FOCUS_MINUTE_CAP = 720   # 12 h of credited focus per day
DAILY_FOCUS_SESSION_CAP = 40   # sane upper bound on sessions per day
MIN_SESSION_GAP_SECONDS = 30   # block replay bursts

@api_router.post("/focus-sessions")
async def create_focus_session(payload: FocusSessionCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    minutes = max(1, min(payload.duration_minutes, 240))

    # Abuse guard: cap credited sessions/minutes per day and throttle rapid replays
    day_start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    todays = await db.focus_sessions.find(
        {"user_id": user["user_id"], "created_at": {"$gte": day_start}},
        {"_id": 0, "duration_minutes": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(DAILY_FOCUS_SESSION_CAP + 1)
    if len(todays) >= DAILY_FOCUS_SESSION_CAP:
        raise HTTPException(status_code=429, detail="Daily focus session limit reached")
    if todays and (now_utc() - todays[0]["created_at"].replace(tzinfo=timezone.utc)).total_seconds() < MIN_SESSION_GAP_SECONDS:
        raise HTTPException(status_code=429, detail="Slow down — finish a real session first")
    credited = sum(int(t.get("duration_minutes", 0)) for t in todays)
    if credited + minutes > DAILY_FOCUS_MINUTE_CAP:
        raise HTTPException(status_code=429, detail="Daily focus minute limit reached")

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
    # Focus Lock streak: sessions finished in a row without breaking the lock
    res = await db.users.find_one_and_update(
        {"user_id": user["user_id"]},
        {"$inc": {"focus_lock_streak": 1}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "focus_lock_streak": 1, "focus_lock_best": 1},
    )
    streak = int((res or {}).get("focus_lock_streak", 1))
    if streak > int((res or {}).get("focus_lock_best", 0)):
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"focus_lock_best": streak}})
    return {"ok": True, "xp_earned": xp, "duration_minutes": minutes, "focus_lock_streak": streak}

@api_router.get("/focus-sessions/today")
async def focus_sessions_today(authorization: Optional[str] = Header(None)):
    """Today's focus sessions + Focus Lock streak."""
    user = await get_current_user(authorization)
    start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = await db.focus_sessions.find(
        {"user_id": user["user_id"], "created_at": {"$gte": start}},
        {"_id": 0, "session_id": 1, "duration_minutes": 1, "xp_earned": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(100)
    sessions = [
        {
            "session_id": r["session_id"],
            "duration_minutes": r.get("duration_minutes", 0),
            "xp_earned": r.get("xp_earned", 0),
            "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
        }
        for r in rows
    ]
    return {
        "sessions": sessions,
        "total_minutes": sum(s["duration_minutes"] for s in sessions),
        "total_xp": sum(s["xp_earned"] for s in sessions),
        "focus_lock_streak": int(user.get("focus_lock_streak", 0)),
        "focus_lock_best": int(user.get("focus_lock_best", 0)),
    }

# ---------- Settings ----------
class SettingsUpdate(BaseModel):
    notifications_enabled: Optional[bool] = None
    focus_lock_enabled: Optional[bool] = None
    strict_lock_enabled: Optional[bool] = None

@api_router.get("/settings")
async def get_settings(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {
        "notifications_enabled": bool(user.get("notifications_enabled", True)),
        "focus_lock_enabled": bool(user.get("focus_lock_enabled", True)),
        "strict_lock_enabled": bool(user.get("strict_lock_enabled", True)),
    }

@api_router.patch("/settings")
async def update_settings(payload: SettingsUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {
        "notifications_enabled": bool(fresh.get("notifications_enabled", True)),
        "focus_lock_enabled": bool(fresh.get("focus_lock_enabled", True)),
        "strict_lock_enabled": bool(fresh.get("strict_lock_enabled", True)),
    }

# ---------- Friends ----------
FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

class FriendRequestCreate(BaseModel):
    code: str

async def _ensure_friend_code(user) -> str:
    code = user.get("friend_code")
    if code:
        return code
    for _ in range(10):
        candidate = "".join(secrets.choice(FRIEND_CODE_ALPHABET) for _ in range(6))
        exists = await db.users.find_one({"friend_code": candidate}, {"_id": 1})
        if exists:
            continue
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"friend_code": candidate}})
        return candidate
    raise HTTPException(status_code=500, detail="Could not generate friend code")

async def _friend_ids(user_id: str) -> List[str]:
    rows = await db.friends.find({"user_id": user_id}, {"_id": 0, "friend_id": 1}).to_list(500)
    return [r["friend_id"] for r in rows]

async def _link_friends(a: str, b: str):
    ts = now_utc()
    for x, y in ((a, b), (b, a)):
        await db.friends.update_one(
            {"user_id": x, "friend_id": y},
            {"$setOnInsert": {"created_at": ts}},
            upsert=True,
        )

@api_router.get("/friends/me")
async def friends_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    code = await _ensure_friend_code(user)
    return {
        "user_id": user["user_id"],
        "name": user.get("name") or "Friend",
        "friend_code": code,
        "qr_payload": f"sproutly:friend:{code}",
    }

@api_router.post("/friends/requests")
async def send_friend_request(payload: FriendRequestCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    raw = (payload.code or "").strip()
    if raw.lower().startswith(("sproutly:friend:", "sproutgoals:friend:")):
        raw = raw.split(":")[-1]
    code = raw.upper()
    if len(code) != 6:
        raise HTTPException(status_code=400, detail="Invalid friend code")
    target = await db.users.find_one({"friend_code": code}, {"_id": 0, "user_id": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=404, detail="No one found with that code")
    if target["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="That's your own code!")
    already = await db.friends.find_one({"user_id": user["user_id"], "friend_id": target["user_id"]})
    if already:
        raise HTTPException(status_code=400, detail="You're already friends")
    # If they already invited us, accept instantly
    incoming = await db.friend_requests.find_one({
        "from_user_id": target["user_id"], "to_user_id": user["user_id"], "status": "pending",
    })
    if incoming:
        await db.friend_requests.update_one(
            {"request_id": incoming["request_id"]},
            {"$set": {"status": "accepted", "responded_at": now_utc()}},
        )
        await _link_friends(user["user_id"], target["user_id"])
        return {"status": "accepted", "friend_name": target.get("name") or "Friend"}
    dup = await db.friend_requests.find_one({
        "from_user_id": user["user_id"], "to_user_id": target["user_id"], "status": "pending",
    })
    if dup:
        return {"status": "pending", "friend_name": target.get("name") or "Friend"}
    await db.friend_requests.insert_one({
        "request_id": f"fr_{uuid.uuid4().hex[:12]}",
        "from_user_id": user["user_id"],
        "to_user_id": target["user_id"],
        "status": "pending",
        "created_at": now_utc(),
    })
    try:
        await send_push(
            recipients=[target["user_id"]],
            data={
                "title": "New friend request 🌱",
                "message": f"{user.get('name') or 'Someone'} wants to grow trees with you.",
                "action_url": "/(tabs)/friends",
            },
        )
    except Exception as e:
        logger.warning(f"Push failed (non-blocking): {e}")
    return {"status": "pending", "friend_name": target.get("name") or "Friend"}

@api_router.get("/friends/requests")
async def list_friend_requests(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    incoming_rows = await db.friend_requests.find(
        {"to_user_id": user["user_id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    outgoing_rows = await db.friend_requests.find(
        {"from_user_id": user["user_id"], "status": "pending"}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)

    async def _name(uid: str) -> str:
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1})
        return (u or {}).get("name") or "Friend"

    incoming = [
        {"request_id": r["request_id"], "user_id": r["from_user_id"], "name": await _name(r["from_user_id"])}
        for r in incoming_rows
    ]
    outgoing = [
        {"request_id": r["request_id"], "user_id": r["to_user_id"], "name": await _name(r["to_user_id"])}
        for r in outgoing_rows
    ]
    return {"incoming": incoming, "outgoing": outgoing}

@api_router.post("/friends/requests/{request_id}/{action}")
async def respond_friend_request(request_id: str, action: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if action not in ("accept", "decline"):
        raise HTTPException(status_code=400, detail="Invalid action")
    req = await db.friend_requests.find_one(
        {"request_id": request_id, "to_user_id": user["user_id"], "status": "pending"}, {"_id": 0}
    )
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    await db.friend_requests.update_one(
        {"request_id": request_id},
        {"$set": {"status": "accepted" if action == "accept" else "declined", "responded_at": now_utc()}},
    )
    if action == "accept":
        await _link_friends(user["user_id"], req["from_user_id"])
    return {"ok": True, "status": action}

@api_router.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.friends.delete_many({"user_id": user["user_id"], "friend_id": friend_id})
    await db.friends.delete_many({"user_id": friend_id, "friend_id": user["user_id"]})
    return {"ok": True}

@api_router.get("/friends/leaderboard")
async def friends_leaderboard(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    ids = await _friend_ids(user["user_id"])
    all_ids = [user["user_id"]] + ids
    week_start = now_utc() - timedelta(days=7)

    users = await db.users.find(
        {"user_id": {"$in": all_ids}}, {"_id": 0, "user_id": 1, "name": 1, "streak_days": 1}
    ).to_list(500)
    plants = await db.plants.find(
        {"user_id": {"$in": all_ids}, "is_current": True}, {"_id": 0, "user_id": 1, "xp": 1, "is_dead": 1}
    ).to_list(500)
    xp_by_user = {p["user_id"]: int(p.get("xp", 0)) for p in plants}
    dead_by_user = {p["user_id"]: bool(p.get("is_dead", False)) for p in plants}
    focus_rows = await db.focus_sessions.aggregate([
        {"$match": {"user_id": {"$in": all_ids}, "created_at": {"$gte": week_start}}},
        {"$group": {"_id": "$user_id", "total": {"$sum": "$duration_minutes"}}},
    ]).to_list(500)
    focus_by_user = {r["_id"]: int(r["total"]) for r in focus_rows}

    rows = [
        {
            "user_id": u["user_id"],
            "name": u.get("name") or "Friend",
            "xp": xp_by_user.get(u["user_id"], 0),
            "streak_days": int(u.get("streak_days", 0)),
            "focus_minutes_week": focus_by_user.get(u["user_id"], 0),
            "is_dead": dead_by_user.get(u["user_id"], False),
            "is_me": u["user_id"] == user["user_id"],
        }
        for u in users
    ]
    rows.sort(key=lambda r: (-r["xp"], -r["streak_days"], r["name"].lower()))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"leaderboard": rows, "friend_count": len(ids)}


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
        "streak_freezes": int(user.get("streak_freezes", 0)),
    }

@api_router.get("/streak-status")
async def streak_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    last = user.get("last_activity_date")
    at_risk = False
    active_today = False
    if last:
        if hasattr(last, "date"):
            last_date = last.date() if last.tzinfo else last.replace(tzinfo=timezone.utc).date()
        else:
            last_date = datetime.fromisoformat(str(last)).date()
        today = now_utc().date()
        gap = (today - last_date).days
        active_today = gap == 0
        # Nothing done today + last activity was yesterday → streak breaks at midnight
        at_risk = gap == 1 and user.get("streak_days", 0) > 0
    return {
        "at_risk": at_risk,
        "active_today": active_today,
        "streak_days": user.get("streak_days", 0),
        "streak_freezes": int(user.get("streak_freezes", 0)),
    }

@api_router.get("/activity-calendar")
async def activity_calendar(year: int = 0, month: int = 0, authorization: Optional[str] = Header(None)):
    """Days of the given month (default: current) on which the user was active."""
    user = await get_current_user(authorization)
    now = now_utc()
    y = year if 2000 <= year <= 2100 else now.year
    m = month if 1 <= month <= 12 else now.month
    start = datetime(y, m, 1, tzinfo=timezone.utc)
    end = datetime(y + 1, 1, 1, tzinfo=timezone.utc) if m == 12 else datetime(y, m + 1, 1, tzinfo=timezone.utc)
    uid = user["user_id"]
    active: set = set()

    def _day(dt):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.day

    async for fs in db.focus_sessions.find(
        {"user_id": uid, "created_at": {"$gte": start, "$lt": end}}, {"_id": 0, "created_at": 1}
    ):
        active.add(_day(fs["created_at"]))
    async for g in db.goals.find(
        {"user_id": uid, "completed": True, "completed_at": {"$gte": start, "$lt": end}}, {"_id": 0, "completed_at": 1}
    ):
        active.add(_day(g["completed_at"]))
    async for q in db.daily_quests.find(
        {"user_id": uid, "completed": True, "completed_at": {"$gte": start, "$lt": end}}, {"_id": 0, "completed_at": 1}
    ):
        if q.get("completed_at"):
            active.add(_day(q["completed_at"]))
    return {
        "year": y,
        "month": m,
        "active_days": sorted(active),
        "streak_days": user.get("streak_days", 0),
    }

# ---------- Streak Freeze (PRO benefit, claimed monthly) ----------
@api_router.post("/streak-freezes/claim")
async def claim_monthly_freeze(authorization: Optional[str] = Header(None)):
    """Grant one streak freeze, at most once per calendar month."""
    user = await get_current_user(authorization)
    month = now_utc().strftime("%Y-%m")
    if user.get("last_freeze_claim_month") == month:
        return {
            "granted": False,
            "reason": "already_claimed_this_month",
            "month": month,
            "streak_freezes": int(user.get("streak_freezes", 0)),
        }
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$inc": {"streak_freezes": 1}, "$set": {"last_freeze_claim_month": month}},
    )
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "streak_freezes": 1})
    return {
        "granted": True,
        "month": month,
        "streak_freezes": int((fresh or {}).get("streak_freezes", 0)),
    }

@api_router.get("/streak-freezes/status")
async def freeze_claim_status(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    month = now_utc().strftime("%Y-%m")
    return {
        "streak_freezes": int(user.get("streak_freezes", 0)),
        "claimable": user.get("last_freeze_claim_month") != month,
        "month": month,
    }


# ---------- Emergent Managed Push Notifications ----------
PUSH_BASE_URL = "https://integrations.emergentagent.com"
push_http = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": os.environ.get("EMERGENT_PUSH_KEY", "placeholder")},
    timeout=10.0,
)

class RegisterPushBody(BaseModel):
    platform: str  # "android" | "ios"
    device_token: str

@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, authorization: Optional[str] = Header(None)):
    # SECURITY: bind the device to the authenticated user; never trust a body user_id
    user = await get_current_user(authorization)
    if body.platform not in ("android", "ios"):
        raise HTTPException(status_code=400, detail="Invalid platform")
    payload = {
        "user_id": user["user_id"],
        "platform": body.platform,
        "device_token": body.device_token[:512],
    }
    resp = await push_http.post("/api/v1/push/users/register", json=payload)
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}

async def send_push(recipients: List[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    # Respect the per-user notification setting
    opted_out = await db.users.find(
        {"user_id": {"$in": recipients}, "notifications_enabled": False}, {"_id": 0, "user_id": 1}
    ).to_list(len(recipients))
    blocked = {u["user_id"] for u in opted_out}
    recipients = [r for r in recipients if r not in blocked]
    if not recipients:
        return
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await push_http.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()

async def _push_sweeper():
    """Hourly: proactively kill lapsed trees (with 'tree died' push) and send the
    evening streak-rescue reminder to users who did nothing today."""
    while True:
        try:
            now = now_utc()
            today = now.date()
            today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
            yesterday_start = today_start - timedelta(days=1)
            # 1) Users idle 2+ days → run the kill/freeze check (sends 'tree died' push on kill)
            async for u in db.users.find({"last_activity_date": {"$lt": yesterday_start}}, {"_id": 0}):
                try:
                    await _check_and_kill_stale_plant(u)
                except Exception as e:
                    logger.warning(f"sweeper kill check failed: {e}")
            # 2) Evening reminder (~17:00 UTC) for users whose streak breaks at midnight
            if now.hour == 17:
                cursor = db.users.find(
                    {"streak_days": {"$gt": 0},
                     "last_activity_date": {"$gte": yesterday_start, "$lt": today_start}},
                    {"_id": 0},
                )
                async for u in cursor:
                    key = f"streak-risk:{u['user_id']}:{today.isoformat()}"
                    try:
                        await db.push_log.insert_one({"key": key, "created_at": now_utc()})
                    except DuplicateKeyError:
                        continue
                    try:
                        await send_push(
                            recipients=[u["user_id"]],
                            data={
                                "title": "🔥 Your streak breaks at midnight!",
                                "message": f"Keep your {u.get('streak_days', 0)}-day streak alive — a quick goal or focus session saves your tree. 🌳",
                                "action_url": "/(tabs)/garden",
                            },
                            idempotency_key=key,
                        )
                    except Exception as e:
                        logger.warning(f"Push failed (non-blocking): {e}")
        except Exception as e:
            logger.warning(f"push sweeper error: {e}")
        await asyncio.sleep(3600)

@api_router.get("/")
async def root():
    return {"message": "Sproutly API"}

app.include_router(api_router)

_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_origins else r"https://[a-z0-9-]+\.(preview\.)?emergentagent\.com",
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
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
    await db.push_log.create_index("key", unique=True)
    asyncio.create_task(_push_sweeper())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
