# apps/backend/app/schemas/events.py
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional
from datetime import datetime

class EventIn(BaseModel):
  event: str
  session_id: str

  # ISO string coming from client. We'll parse it best-effort.
  ts: Optional[str] = None

  utm_source: Optional[str] = "unknown"
  utm_medium: Optional[str] = "unknown"
  utm_campaign: Optional[str] = "unknown"
  utm_content: Optional[str] = "unknown"

  url: Optional[str] = None
  user_agent: Optional[str] = None

  payload: Dict[str, Any] = Field(default_factory=dict)

class SummaryOut(BaseModel):
  from_ts: str
  to_ts: str

  sessions: int
  page_views: int
  text_started: int
  analysis_started: int
  analysis_completed: int
  flagged: int
  accepted: int
  rejected: int
  copy_clicked: int

  completion_rate: float
  flag_rate: float
  accept_rate_given_flagged: float
