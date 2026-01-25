from __future__ import annotations

import time
import uuid
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.services.analysis import llm_scan

# telemetry imports
from app.db import get_db
from app.models_telemetry import AnalysisRun, BiasOccurrence, Consent
from app.telemetry_utils import (
    CID_COOKIE,
    SID_COOKIE,
    ensure_uuid_str,
    count_words,
    count_sentences,
    guess_device_from_ua,
    canonical_bias_fallback,
    ET_POLICY_VERSION,
)

router = APIRouter()

# mount telemetry endpoints
from app.api.telemetry_routes import router as telemetry_router  # noqa: E402

router.include_router(telemetry_router)


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


def _get_or_set_ids(request: Request, response: Response):
    cid = request.cookies.get(CID_COOKIE)
    sid = request.cookies.get(SID_COOKIE)

    cid = ensure_uuid_str(cid)
    sid = ensure_uuid_str(sid)

    cookie_kwargs = dict(
        httponly=True,
        samesite="lax",
        secure=True,  # set False if testing on http
        path="/",
        max_age=60 * 60 * 24 * 365,
    )

    if request.cookies.get(CID_COOKIE) is None:
        response.set_cookie(CID_COOKIE, cid, **cookie_kwargs)
    if request.cookies.get(SID_COOKIE) is None:
        response.set_cookie(SID_COOKIE, sid, **cookie_kwargs)

    return cid, sid


def _telemetry_allowed(db: Session, cid: str) -> bool:
    row = db.get(Consent, cid)
    return bool(row and row.product_telemetry)


@router.post("/analyze")
async def analyze(payload: AnalyzeRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Frontend endpoint: /api/analyze
    Returns a backend-compatible shape the current Page.tsx expects:
      {status, overall, primary_action, actions, popup_message, findings, error_message}
    Additionally logs Power Move telemetry when user consented.
    """
    t0 = time.perf_counter()

    try:
        cid, sid = _get_or_set_ids(request, response)
        device = guess_device_from_ua(request.headers.get("user-agent"))
        app_version = request.headers.get("x-app-version")

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

        latency_ms = int((time.perf_counter() - t0) * 1000)

        # --------------------------
        # Telemetry hook (non-blocking)
        # --------------------------
        if _telemetry_allowed(db, cid):
            analysis_id = str(uuid.uuid4())
            wc = count_words(payload.text)
            sc = count_sentences(payload.text)

            fr = sum(1 for f in findings if f.get("type") == "replace")
            fa = sum(1 for f in findings if f.get("type") == "avoid")
            ft = len(findings)

            run = AnalysisRun(
                analysis_id=analysis_id,
                cid=cid,
                session_id=sid,
                locale=payload.locale or "en-US",
                text_word_count=wc,
                text_sentence_count=sc,
                findings_total=ft,
                findings_replace=fr,
                findings_avoid=fa,
                latency_ms=latency_ms,
                copy_enabled_result=bool(copy_enabled),
                app_version=app_version,
                device=device,
            )
            db.add(run)

            # Each finding = shown occurrence (MVP canonical fallback)
            for f in findings:
                cbid = f.get("canonical_bias_id") or canonical_bias_fallback(f)
                cat = (f.get("bias_category") or f.get("category") or "other")
                sev = (f.get("bias_severity") or f.get("severity") or "low")

                occ = BiasOccurrence(
                    id=str(uuid.uuid4()),
                    cid=cid,
                    session_id=sid,
                    analysis_id=analysis_id,
                    canonical_bias_id=cbid,
                    category=str(cat),
                    severity=str(sev),
                    finding_type=str(f.get("type") or "review"),
                    span_start=int(f.get("start") or 0),
                    span_end=int(f.get("end") or 0),
                    span_word_count=count_words(str(f.get("original") or "")),
                    span_sentence_count=1,
                    action="shown",
                    device=device,
                )
                db.add(occ)

            db.commit()

            # expose analysis_id to frontend without breaking existing clients
            # (extra field; Page.tsx ignores it safely)
            extra_analysis_id = analysis_id
        else:
            extra_analysis_id = None

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
            # Optional: dashboard plumbing
            "analysis_id": extra_analysis_id,
            "policy_version": ET_POLICY_VERSION,
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
