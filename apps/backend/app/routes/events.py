# apps/backend/app/routes/events.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime
from app.db import get_db
from app.schemas.events import EventIn
from app.models.event import Event

router = APIRouter()

def _parse_ts(ts: str | None):
  if not ts:
    return None
  try:
    # accepts "2026-01-29T12:34:56.000Z" style
    # datetime.fromisoformat doesn't like "Z" in py<3.11 -> replace with +00:00
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))
  except Exception:
    return None

@router.post("/events")
def ingest_event(evt: EventIn, db: Session = Depends(get_db)):
  # IMPORTANT: do NOT store raw user text. Your frontend payload is metadata only.
  e = Event(
    event_name=evt.event,
    session_id=evt.session_id,
    ts=_parse_ts(evt.ts),

    utm_source=evt.utm_source,
    utm_medium=evt.utm_medium,
    utm_campaign=evt.utm_campaign,
    utm_content=evt.utm_content,

    url=evt.url,
    user_agent=evt.user_agent,

    payload=evt.payload or {},
  )
  db.add(e)
  db.commit()
  return {"ok": True}
