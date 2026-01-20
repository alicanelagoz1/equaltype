from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.analysis import llm_scan

router = APIRouter()


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    locale: str | None = "en-US"
    context: dict | None = {}


def _locale_to_lang(locale: str | None) -> str:
    if not locale:
        return "en"
    loc = locale.lower()
    if loc.startswith("de"):
        return "de"
    if loc.startswith("lv"):
        return "lv"
    return "en"


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
        findings = out.get("findings", []) or []

        # Decide actions based on finding types:
        # - avoid => block copy
        # - replace => block copy (until user changes)
        # - review only => allow copy (user can still say factual things)
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
                "show_suggestion": True,
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
