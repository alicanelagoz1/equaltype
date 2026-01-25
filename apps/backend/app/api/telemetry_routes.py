from __future__ import annotations

import os
import uuid
from datetime import datetime, date, timedelta

from fastapi import APIRouter, Depends, Request, Response, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db import get_db, engine
from app.models_telemetry import Base, Consent, Decision, CopyEvent, AnalysisRun, BiasOccurrence
from app.telemetry_utils import (
    ET_POLICY_VERSION,
    CID_COOKIE,
    SID_COOKIE,
    ensure_uuid_str,
)

router = APIRouter()

# Create tables if migrations aren't set up yet (MVP convenience)
# In production you'll replace this with Alembic.
Base.metadata.create_all(bind=engine)


def _get_or_set_ids(request: Request, response: Response):
    cid = request.cookies.get(CID_COOKIE)
    sid = request.cookies.get(SID_COOKIE)

    cid = ensure_uuid_str(cid)
    sid = ensure_uuid_str(sid)

    # cookie properties
    cookie_kwargs = dict(
        httponly=True,
        samesite="lax",
        secure=True,  # set to False if testing on http
        path="/",
        max_age=60 * 60 * 24 * 365,
    )

    # Only set if missing
    if request.cookies.get(CID_COOKIE) is None:
        response.set_cookie(CID_COOKIE, cid, **cookie_kwargs)
    if request.cookies.get(SID_COOKIE) is None:
        response.set_cookie(SID_COOKIE, sid, **cookie_kwargs)

    return cid, sid


def _telemetry_allowed(db: Session, cid: str) -> bool:
    c = db.get(Consent, cid)
    if not c:
        return False
    return bool(c.product_telemetry)


class ConsentState(BaseModel):
    analytics: bool = False
    product_telemetry: bool = False


class ConsentResponse(BaseModel):
    policy_version: str
    consent: dict
    needs_banner: bool


@router.get("/consent", response_model=ConsentResponse)
def get_consent(request: Request, response: Response, db: Session = Depends(get_db)):
    cid, _sid = _get_or_set_ids(request, response)

    row = db.get(Consent, cid)
    if not row:
        # essential cookie exists, but no explicit consent preferences saved yet
        return {
            "policy_version": ET_POLICY_VERSION,
            "consent": {"essential": True, "analytics": False, "product_telemetry": False},
            "needs_banner": True,
        }

    return {
        "policy_version": row.policy_version or ET_POLICY_VERSION,
        "consent": {
            "essential": True,
            "analytics": bool(row.analytics),
            "product_telemetry": bool(row.product_telemetry),
        },
        "needs_banner": False,
    }


@router.post("/consent", response_model=ConsentResponse)
def set_consent(state: ConsentState, request: Request, response: Response, db: Session = Depends(get_db)):
    cid, _sid = _get_or_set_ids(request, response)

    row = db.get(Consent, cid)
    now = datetime.utcnow()

    if not row:
        row = Consent(
            cid=cid,
            policy_version=ET_POLICY_VERSION,
            essential=True,
            analytics=bool(state.analytics),
            product_telemetry=bool(state.product_telemetry),
            created_at=now,
            updated_at=now,
            last_seen_at=now,
        )
        db.add(row)
    else:
        row.policy_version = ET_POLICY_VERSION
        row.analytics = bool(state.analytics)
        row.product_telemetry = bool(state.product_telemetry)
        row.updated_at = now
        row.last_seen_at = now

    db.commit()

    return {
        "policy_version": row.policy_version,
        "consent": {"essential": True, "analytics": bool(row.analytics), "product_telemetry": bool(row.product_telemetry)},
        "needs_banner": False,
    }


class DecisionRequest(BaseModel):
    analysis_id: str = Field(..., min_length=8)
    canonical_bias_id: str = Field(..., min_length=3)
    decision: str = Field(..., pattern="^(accepted|rejected)$")
    decision_target: str = Field("word", pattern="^(word|sentence)$")
    words_changed: int = Field(0, ge=0, le=10000)
    sentences_changed: int = Field(0, ge=0, le=2000)
    device: str | None = Field(default=None, pattern="^(mobile|desktop)$")


@router.post("/decision")
def post_decision(payload: DecisionRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    cid, sid = _get_or_set_ids(request, response)

    if not _telemetry_allowed(db, cid):
        return Response(status_code=204)

    now = datetime.utcnow()

    dec = Decision(
        id=str(uuid.uuid4()),
        ts=now,
        cid=cid,
        session_id=sid,
        analysis_id=payload.analysis_id,
        canonical_bias_id=payload.canonical_bias_id,
        decision=payload.decision,
        decision_target=payload.decision_target,
        words_changed=payload.words_changed,
        sentences_changed=payload.sentences_changed,
        device=payload.device,
    )
    db.add(dec)

    # Update matching bias occurrences (best-effort). Not mandatory for metrics, but nice.
    db.query(BiasOccurrence).filter(
        BiasOccurrence.analysis_id == payload.analysis_id,
        BiasOccurrence.canonical_bias_id == payload.canonical_bias_id,
    ).update({"action": payload.decision})

    db.commit()
    return {"status": "ok"}


class CopyRequest(BaseModel):
    analysis_id: str | None = None
    enabled: bool
    device: str | None = Field(default=None, pattern="^(mobile|desktop)$")


@router.post("/copy")
def post_copy(payload: CopyRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    cid, sid = _get_or_set_ids(request, response)

    if not _telemetry_allowed(db, cid):
        return Response(status_code=204)

    ce = CopyEvent(
        id=str(uuid.uuid4()),
        ts=datetime.utcnow(),
        cid=cid,
        session_id=sid,
        analysis_id=payload.analysis_id,
        enabled=bool(payload.enabled),
        device=payload.device,
    )
    db.add(ce)
    db.commit()
    return {"status": "ok"}


@router.get("/dashboard/summary")
def dashboard_summary(days: int = 30, db: Session = Depends(get_db)):
    """
    Power Move MVP summary for dashboard.
    Returns totals + last N days aggregates.
    """
    days = max(1, min(365, int(days)))
    since = datetime.utcnow() - timedelta(days=days)

    # 1) Usage & volume
    total_analyses = db.query(func.count(AnalysisRun.analysis_id)).scalar() or 0
    total_findings = db.query(func.coalesce(func.sum(AnalysisRun.findings_total), 0)).scalar() or 0
    avg_sentences = db.query(func.avg(AnalysisRun.text_sentence_count)).scalar() or 0
    avg_words = db.query(func.avg(AnalysisRun.text_word_count)).scalar() or 0

    # Session-level: analyses per session
    total_sessions = db.query(func.count(func.distinct(AnalysisRun.session_id))).scalar() or 0
    analyses_per_session = (total_analyses / total_sessions) if total_sessions else 0

    # 2) Actions
    shown = db.query(func.count(BiasOccurrence.id)).scalar() or 0
    accepted = db.query(func.count(Decision.id)).filter(Decision.decision == "accepted").scalar() or 0
    rejected = db.query(func.count(Decision.id)).filter(Decision.decision == "rejected").scalar() or 0

    copy_enabled_clicks = db.query(func.count(CopyEvent.id)).filter(CopyEvent.enabled == True).scalar() or 0  # noqa
    copy_disabled_clicks = db.query(func.count(CopyEvent.id)).filter(CopyEvent.enabled == False).scalar() or 0  # noqa

    # 3/4) content delta
    corrected_sentences = (
        db.query(func.coalesce(func.sum(Decision.sentences_changed), 0))
        .filter(Decision.decision == "accepted")
        .scalar()
        or 0
    )
    corrected_words = (
        db.query(func.coalesce(func.sum(Decision.words_changed), 0)).filter(Decision.decision == "accepted").scalar() or 0
    )

    rejected_sentences = (
        db.query(func.coalesce(func.sum(Decision.sentences_changed), 0))
        .filter(Decision.decision == "rejected")
        .scalar()
        or 0
    )
    rejected_words = (
        db.query(func.coalesce(func.sum(Decision.words_changed), 0)).filter(Decision.decision == "rejected").scalar() or 0
    )

    accept_rate = (accepted / shown) if shown else 0
    reject_rate = (rejected / shown) if shown else 0

    # 5/6/7) Top bias lists + resistance index (over window)
    # resistance = rejected * frequency
    subq_freq = (
        db.query(
            BiasOccurrence.canonical_bias_id.label("bid"),
            func.count(BiasOccurrence.id).label("freq"),
        )
        .filter(BiasOccurrence.ts >= since)
        .group_by(BiasOccurrence.canonical_bias_id)
        .subquery()
    )

    subq_rej = (
        db.query(
            Decision.canonical_bias_id.label("bid"),
            func.count(Decision.id).label("rej"),
        )
        .filter(Decision.ts >= since, Decision.decision == "rejected")
        .group_by(Decision.canonical_bias_id)
        .subquery()
    )

    subq_acc = (
        db.query(
            Decision.canonical_bias_id.label("bid"),
            func.count(Decision.id).label("acc"),
        )
        .filter(Decision.ts >= since, Decision.decision == "accepted")
        .group_by(Decision.canonical_bias_id)
        .subquery()
    )

    # join these three by bid
    # (SQLite compatibility: use outer joins carefully)
    q = (
        db.query(
            subq_freq.c.bid,
            subq_freq.c.freq,
            func.coalesce(subq_acc.c.acc, 0).label("acc"),
            func.coalesce(subq_rej.c.rej, 0).label("rej"),
        )
        .outerjoin(subq_acc, subq_acc.c.bid == subq_freq.c.bid)
        .outerjoin(subq_rej, subq_rej.c.bid == subq_freq.c.bid)
    )

    rows = []
    for r in q.all():
        freq = int(r.freq or 0)
        accc = int(r.acc or 0)
        rejj = int(r.rej or 0)
        rows.append(
            {
                "canonical_bias_id": r.bid,
                "frequency": freq,
                "accepted": accc,
                "rejected": rejj,
                "reject_rate": (rejj / freq) if freq else 0,
                "resistance_index": rejj * freq,
            }
        )

    top_accepted = sorted(rows, key=lambda x: x["accepted"], reverse=True)[:10]
    top_rejected = sorted(rows, key=lambda x: x["rejected"], reverse=True)[:10]
    top_resistance = sorted(rows, key=lambda x: x["resistance_index"], reverse=True)[:10]

    return {
        "window_days": days,
        "usage": {
            "total_analyses": total_analyses,
            "total_findings": total_findings,
            "avg_sentences_per_analysis": float(avg_sentences or 0),
            "avg_words_per_analysis": float(avg_words or 0),
            "total_sessions": total_sessions,
            "analyses_per_session": analyses_per_session,
        },
        "actions": {
            "shown": shown,
            "accepted": accepted,
            "rejected": rejected,
            "accept_rate": accept_rate,
            "reject_rate": reject_rate,
            "copy_click_enabled": copy_enabled_clicks,
            "copy_click_disabled": copy_disabled_clicks,
        },
        "content": {
            "corrected_sentences": corrected_sentences,
            "corrected_words": corrected_words,
            "rejected_sentences": rejected_sentences,
            "rejected_words": rejected_words,
        },
        "top": {
            "top_accepted_bias": top_accepted,
            "top_rejected_bias": top_rejected,
            "top_resistance_bias": top_resistance,
        },
    }
