#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/Users/aliced/equaltype/apps/backend"
VENV="$BASE_DIR/.venv"
BASE_URL="http://127.0.0.1:8000"

cd "$BASE_DIR"
source "$VENV/bin/activate"

# Ensure deps for tooling
python -c "import requests" >/dev/null 2>&1 || pip install requests

# Start API if not running
if ! curl -s "$BASE_URL/health" >/dev/null 2>&1; then
  echo "[L3] Starting API..."
  nohup python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > uvicorn.log 2>&1 &
  sleep 3
fi

echo "[L3] Discover..."
python tests/llm_discover.py --batches 10 --per-batch 100 --out tests/candidates_raw.jsonl

echo "[L3] Curate..."
python tests/llm_autocurate.py --in tests/candidates_raw.jsonl --out tests/candidates_curated.jsonl --min-confidence 0.75 --max-fp-risk 0.30 --max 200000

echo "[L3] Promote..."
python tests/llm_promote.py --base-url "$BASE_URL" --in tests/candidates_curated.jsonl --cases tests/cases.json --max 5000

echo "[L3] Regression..."
python tests/run_cases.py --base-url "$BASE_URL" --cases tests/cases.json

echo "[L3] Done."
