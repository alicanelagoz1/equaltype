# apps/backend/app/models/event.py
from sqlalchemy import Column, BigInteger, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.db import Base

class Event(Base):
  __tablename__ = "events"

  id = Column(BigInteger, primary_key=True, index=True)
  event_name = Column(Text, nullable=False, index=True)
  session_id = Column(Text, nullable=False, index=True)

  ts = Column(DateTime(timezone=True), nullable=True)

  utm_source = Column(Text, nullable=True, index=True)
  utm_medium = Column(Text, nullable=True)
  utm_campaign = Column(Text, nullable=True)
  utm_content = Column(Text, nullable=True)

  url = Column(Text, nullable=True)
  user_agent = Column(Text, nullable=True)

  payload = Column(JSONB, nullable=False, server_default="{}")

  created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
