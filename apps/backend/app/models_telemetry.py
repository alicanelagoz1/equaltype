from __future__ import annotations

from datetime import datetime
from sqlalchemy import Boolean, DateTime, Integer, String, Text, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Consent(Base):
    __tablename__ = "consents"

    # consent cookie id (cid)
    cid: Mapped[str] = mapped_column(String(36), primary_key=True)

    policy_version: Mapped[str] = mapped_column(String(32), default="unknown")
    essential: Mapped[bool] = mapped_column(Boolean, default=True)
    analytics: Mapped[bool] = mapped_column(Boolean, default=False)
    product_telemetry: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    analysis_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    cid: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)

    locale: Mapped[str] = mapped_column(String(16), default="en-US")
    text_word_count: Mapped[int] = mapped_column(Integer, default=0)
    text_sentence_count: Mapped[int] = mapped_column(Integer, default=0)

    findings_total: Mapped[int] = mapped_column(Integer, default=0)
    findings_replace: Mapped[int] = mapped_column(Integer, default=0)
    findings_avoid: Mapped[int] = mapped_column(Integer, default=0)

    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    copy_enabled_result: Mapped[bool] = mapped_column(Boolean, default=True)

    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    device: Mapped[str | None] = mapped_column(String(12), nullable=True)  # "mobile" | "desktop"


Index("idx_analysis_runs_day", AnalysisRun.ts)


class BiasOccurrence(Base):
    __tablename__ = "bias_occurrence"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    cid: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    analysis_id: Mapped[str] = mapped_column(String(36), index=True)

    canonical_bias_id: Mapped[str] = mapped_column(String(96), index=True)

    category: Mapped[str] = mapped_column(String(24), default="other", index=True)
    severity: Mapped[str] = mapped_column(String(12), default="low", index=True)

    finding_type: Mapped[str] = mapped_column(String(12))  # replace|avoid|review
    span_start: Mapped[int] = mapped_column(Integer, default=0)
    span_end: Mapped[int] = mapped_column(Integer, default=0)
    span_word_count: Mapped[int] = mapped_column(Integer, default=0)
    span_sentence_count: Mapped[int] = mapped_column(Integer, default=1)

    action: Mapped[str] = mapped_column(String(12), default="shown", index=True)  # shown|accepted|rejected
    device: Mapped[str | None] = mapped_column(String(12), nullable=True)


class Decision(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    cid: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    analysis_id: Mapped[str] = mapped_column(String(36), index=True)

    canonical_bias_id: Mapped[str] = mapped_column(String(96), index=True)
    decision: Mapped[str] = mapped_column(String(12), index=True)  # accepted|rejected
    decision_target: Mapped[str] = mapped_column(String(12), default="word")  # word|sentence

    words_changed: Mapped[int] = mapped_column(Integer, default=0)
    sentences_changed: Mapped[int] = mapped_column(Integer, default=0)

    device: Mapped[str | None] = mapped_column(String(12), nullable=True)


class CopyEvent(Base):
    __tablename__ = "copy_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    cid: Mapped[str] = mapped_column(String(36), index=True)
    session_id: Mapped[str] = mapped_column(String(36), index=True)
    analysis_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    device: Mapped[str | None] = mapped_column(String(12), nullable=True)
