# apps/backend/main.py

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# -----------------------------------------------------------------------------
# Paths + Python path
# -----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent  # .../apps/backend
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# -----------------------------------------------------------------------------
# Load .env (MUST be before importing anything that needs env)
# -----------------------------------------------------------------------------
ENV_PATH = BASE_DIR / ".env"
load_dotenv(ENV_PATH, override=True)

# -----------------------------------------------------------------------------
# Create app
# -----------------------------------------------------------------------------
app = FastAPI(title="EqualType API", version="0.2.0")

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://equaltype.com",
        "https://www.equaltype.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# DB init (import AFTER dotenv)
# -----------------------------------------------------------------------------
_db_init_error = None
try:
    from app.db import Base, engine  # noqa: E402
except Exception as e:
    Base = None  # type: ignore
    engine = None  # type: ignore
    _db_init_error = repr(e)

if Base is not None and engine is not None:

    @app.on_event("startup")
    def _startup_create_tables():
        # Minimal & safe: create tables if they don't exist
        Base.metadata.create_all(bind=engine)


# -----------------------------------------------------------------------------
# Routers (import AFTER dotenv)
# -----------------------------------------------------------------------------
# Existing API router (keep as-is)
try:
    from app.api.routes import router as api_router  # noqa: E402
except Exception as e:
    # If this fails, server will still boot and /debug/runtime will show why.
    api_router = None
    _router_import_error = repr(e)
else:
    _router_import_error = None

if api_router is not None:
    app.include_router(api_router, prefix="/api")

# New: Power Move routers (events + summary)
_events_router_import_error = None
_powermove_router_import_error = None

try:
    from app.routes.events import router as events_router  # noqa: E402
except Exception as e:
    events_router = None
    _events_router_import_error = repr(e)

try:
    from app.routes.powermove import router as powermove_router  # noqa: E402
except Exception as e:
    powermove_router = None
    _powermove_router_import_error = repr(e)

if events_router is not None:
    app.include_router(events_router, prefix="/api", tags=["events"])

if powermove_router is not None:
    app.include_router(powermove_router, prefix="/api", tags=["powermove"])


# -----------------------------------------------------------------------------
# Basic health check
# -----------------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


# -----------------------------------------------------------------------------
# Runtime debug (PROVES which file is running + whether env is visible)
# -----------------------------------------------------------------------------
@app.get("/debug/runtime")
def debug_runtime():
    key = os.getenv("OPENAI_API_KEY")
    db_url = os.getenv("DATABASE_URL")

    return {
        "main_file": __file__,
        "cwd": os.getcwd(),
        "sys_executable": sys.executable,
        "env_path": str(ENV_PATH),
        "env_exists": ENV_PATH.exists(),
        "openai_key_present": key is not None,
        "openai_key_len": 0 if key is None else len(key),
        "database_url_present": db_url is not None,
        "database_url_len": 0 if db_url is None else len(db_url),
        "router_import_error": _router_import_error,
        "events_router_import_error": _events_router_import_error,
        "powermove_router_import_error": _powermove_router_import_error,
        "db_init_error": _db_init_error,
        "pythonpath_has_basedir": str(BASE_DIR) in sys.path,
    }
