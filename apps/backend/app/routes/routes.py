# apps/backend/app/routes/powermove.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone

from app.db import get_db
from app.models.event import Event
from app.schemas.events import SummaryOut

router = APIRouter()

def _dt(s: str | None):
  if not s:
    return None
  try:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))
  except Exception:
    return None

@router.get("/powermove/summary", response_model=SummaryOut)
def summary(
  db: Session = Depends(get_db),
  # Example: from=2026-01-29T00:00:00Z&to=2026-01-29T23:59:59Z
  from_ts: str | None = Query(default=None, alias="from"),
  to_ts: str | None = Query(default=None, alias="to"),
):
  now = datetime.now(timezone.utc)
  start = _dt(from_ts) or (now - timedelta(days=1))
  end = _dt(to_ts) or now

  base = db.query(Event).filter(Event.created_at >= start, Event.created_at <= end)

  # unique sessions in period
  sessions = base.with_entities(Event.session_id).distinct().count()

  def count(name: str) -> int:
    return base.filter(Event.event_name == name).count()

  page_views = count("page_view")
  text_started = count("text_started")
  analysis_started = count("analysis_started")
  analysis_completed = count("analysis_completed")
  flagged = count("flagged_discriminative")
  accepted = count("suggestion_accepted")
  rejected = count("suggestion_rejected")
  copy_clicked = count("copy_clicked")

  completion_rate = (analysis_completed / analysis_started) if analysis_started else 0.0
  flag_rate = (flagged / analysis_completed) if analysis_completed else 0.0
  accept_rate_given_flagged = (accepted / flagged) if flagged else 0.0

  return SummaryOut(
    from_ts=start.isoformat(),
    to_ts=end.isoformat(),

    sessions=sessions,
    page_views=page_views,
    text_started=text_started,
    analysis_started=analysis_started,
    analysis_completed=analysis_completed,
    flagged=flagged,
    accepted=accepted,
    rejected=rejected,
    copy_clicked=copy_clicked,

    completion_rate=float(completion_rate),
    flag_rate=float(flag_rate),
    accept_rate_given_flagged=float(accept_rate_given_flagged),
  )
