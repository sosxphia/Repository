"""Seed a password_resets row with code_hash=hash('123456') for a given email."""
import sys
from pymongo import MongoClient
from pwdlib import PasswordHash
from datetime import datetime, timezone, timedelta

email = sys.argv[1].lower()
ph = PasswordHash.recommended()
db = MongoClient("mongodb://localhost:27017")["test_database"]
db.password_resets.delete_many({"email": email})
db.password_resets.insert_one({
    "email": email,
    "code_hash": ph.hash("123456"),
    "created_at": datetime.now(timezone.utc),
    "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
    "attempts": 0,
})
print("SEEDED_OK")
