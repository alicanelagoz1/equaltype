# apps/backend/app/db.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if not DATABASE_URL:
  # Fail fast: better to know immediately in logs
  raise RuntimeError("DATABASE_URL is not set")

engine = create_engine(
  DATABASE_URL,
  pool_pre_ping=True,
  pool_size=5,
  max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()
