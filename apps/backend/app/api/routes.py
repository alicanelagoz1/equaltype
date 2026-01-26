# apps/backend/app/api/routes.py

from __future__ import annotations

from typing import Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.analysis import llm_scan

router = APIRouter()


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    locale: Optional[str] = "en-US"
    context: Optional[Dict] = Field(default_factory=dict)


def _locale_to_lang(locale: str | None) -> str:
    if not locale:
        return "en"
    loc = locale.lower()
    if loc.startswith("de"):
        return "de"
    if loc.startswith("lv"):
        return "lv"
    return "en"


def _normalize_findings(findings: list, original_text: str) -> list:
    """
    Ensures each finding has the minimum fields the frontend needs:
    - type: avoid|replace|review
    - start/end/original
    - suggested_rewrite (span replacement)
    """
    if not isinstance(findings, list):
        return []

    out = []
    for f in findings:
        if not isinstance(f, dict):
            continue

        # Basic safety normalization
        f_type = f.get("type") or "review"
        if f_type not in ("avoid", "replace", "review"):
            f_type = "review"
        f["type"] = f_type

        # Ensure span fields exist
        start = f.get("start")
        end = f.get("end")
        original = f.get("original")

        # If llm layer returned -1/-1, analysis layer may have repaired, but guard anyway.
        try:
            start_i = int(start) if start is not None else -1
            end_i = int(end) if end is not None else -1
        except Exception:
            start_i, end_i = -1, -1

        if (
            isinstance(original, str)
            and original
            and 0 <= start_i < end_i <= len(original_text)
            and original_text[start_i:end_i] != original
        ):
            # If mismatch, try to locate (first occurrence).
            idx = original_text.find(original)
            if idx != -1:
                start_i = idx
                end_i = idx + len(original)

        f["start"] = start_i
        f["end"] = end_i

        if not isinstance(original, str) or not original:
            if 0 <= start_i < end_i <= len(original_text):
                f["original"] = original_text[start_i:end_i]
            else:
                f["original"] = ""

        # Ensure suggested_rewrite is present for replace-type findings
        if f_type == "replace":
            sr = f.get("suggested_rewrite")
            if not isinstance(sr, str) or not sr.strip():
                # Fallback: first suggestion if exists
                sugg = f.get("suggestions")
                if isinstance(sugg, list) and sugg and isinstance(sugg[0], str):
                    f["suggested_rewrite"] = sugg[0].strip()
                else:
                    f["suggested_rewrite"] = None

        out.append(f)

    return out


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest):
    """
    Frontend endpoint: /api/analyze
    Returns a backend-compatible shape the current Page.tsx expects:
      {status, overall, primary_action, actions, popup_message, findings, error_message}
    """
    try:
        lang = _locale_to_lang(payload.locale)

        out = await llm_scan(text=payload.text, language=lang)
        findings_raw = out.get("findings", []) or []
        findings = _normalize_findings(findings_raw, payload.text)

        # Decide actions based on finding types:
        # - avoid => block copy
        # - replace => block copy (until user changes)
        # - review only => allow copy
        has_avoid = any(f.get("type") == "avoid" for f in findings)
        has_replace = any(f.get("type") == "replace" for f in findings)
        has_review = any(f.get("type") == "review" for f in findings)

        if has_avoid:
            primary_action = "avoid"
            copy_enabled = False
            overall = "avoid"
        elif has_replace:
            primary_action = "replace"
            copy_enabled = False
            overall = "replace"
        else:
            primary_action = "ok"
            copy_enabled = True
            overall = "clean" if not has_review else "review"

        return {
            "status": "ok",
            "overall": overall,
            "primary_action": primary_action,
            "actions": {
                "copy_enabled": copy_enabled,
                "show_suggestion": True,  # frontend tooltip uses findings suggested_rewrite
                "show_avoid_prompt": True,
            },
            "popup_message": None,
            "error_message": None,
            "findings": findings,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/llm/scan")
async def llm_scan_api(payload: dict):
    """
    Debug endpoint: /api/llm/scan
    """
    text = (payload.get("text") or "").strip()
    language = payload.get("language")
    if not text:
        return {"language": language or "auto", "findings": []}
    return await llm_scan(text=text, language=language)
