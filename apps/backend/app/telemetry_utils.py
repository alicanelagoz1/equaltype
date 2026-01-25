from __future__ import annotations

import os
import re
import uuid
import hashlib
from typing import Any

ET_POLICY_VERSION = os.getenv("ET_POLICY_VERSION", "2026-01-25")

CID_COOKIE = "et_cid"
SID_COOKIE = "et_sid"

# naive sentence splitter (good enough for dashboard stats)
_SENT_RE = re.compile(r"[.!?]+(?=\s|$)|\n+")


def ensure_uuid_str(v: str | None) -> str:
    if v and len(v) >= 32:
        return v
    return str(uuid.uuid4())


def count_words(text: str) -> int:
    if not text:
        return 0
    # keep it simple and stable
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def count_sentences(text: str) -> int:
    if not text:
        return 0
    parts = [p for p in _SENT_RE.split(text.strip()) if p and p.strip()]
    return max(1, len(parts)) if text.strip() else 0


def guess_device_from_ua(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    ua = user_agent.lower()
    if "iphone" in ua or "android" in ua or "mobile" in ua:
        return "mobile"
    return "desktop"


def canonical_bias_fallback(finding: dict[str, Any]) -> str:
    """
    Deterministic fallback ID until LLM provides canonical_bias_id.
    Uses category+severity+type+original hash.
    """
    cat = str(finding.get("category") or "other")
    sev = str(finding.get("severity") or "low")
    t = str(finding.get("type") or "review")

    original = str(finding.get("original") or "")
    h = hashlib.sha1(original.encode("utf-8", errors="ignore")).hexdigest()[:10]
    return f"{cat}:{sev}:{t}:{h}"
