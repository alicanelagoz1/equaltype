# app/schemas/analysis.py

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


Severity = Literal["block", "warn", "info"]
ItemType = Literal["slur", "stereotype", "exclusion", "hate", "other"]
Action = Literal["replace", "keep", "disable_copy", "allow_copy"]
ReplacementKind = Literal["rewrite", "suggestion"]


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


class AnalysisItem(BaseModel):
    type: ItemType
    severity: Severity

    # 0-based character offsets, end-exclusive
    start: int
    end: int

    original: str
    masked: Optional[str] = None

    message: str
    suggestions: List[str] = []
    actions: List[Action] = []

    # Step 3: span-level fluent rewrite suggestion
    suggested_rewrite: Optional[str] = None

    # Step 4.5: UI message to show AFTER user clicks "Keep"
    keep_message: Optional[str] = None

    # Step 5: Deterministic replacement payload (frontend uses ONLY this)
    replacement_text: Optional[str] = None
    replacement_kind: Optional[ReplacementKind] = None


class AnalyzeResponse(BaseModel):
    is_clean: bool
    items: List[AnalysisItem] = []
    safe_text: Optional[str] = None

    # Step 4: Copy Policy & UX Contract (global decision)
    copy_allowed: bool
    copy_message: Optional[str] = None
