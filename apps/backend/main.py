# /Users/aliced/equaltype/apps/backend/main.py

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
# Routers (import AFTER dotenv)
# -----------------------------------------------------------------------------
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
    return {
        "main_file": __file__,
        "cwd": os.getcwd(),
        "sys_executable": sys.executable,
        "env_path": str(ENV_PATH),
        "env_exists": ENV_PATH.exists(),
        "openai_key_present": key is not None,
        "openai_key_len": 0 if key is None else len(key),
        "router_import_error": _router_import_error,
        "pythonpath_has_basedir": str(BASE_DIR) in sys.path,
    }
