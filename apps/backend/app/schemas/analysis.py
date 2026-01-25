# app/schemas/analysis.py

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from typing import List, Literal, Optional
from pydantic import BaseModel, Field

class EditSpan(BaseModel):
    start: int = Field(..., ge=0)
    end: int = Field(..., ge=0)
    replacement: str

class UIStrings(BaseModel):
    message: str
    change_label: str = "Change"
    keep_label: str = "Keep"

class AnalysisResponse(BaseModel):
    severity: Literal["none", "low", "medium", "high"]
    type: Literal["none", "term_replacement", "sentence_rewrite"]
    reason: Optional[str] = None
    edits: List[EditSpan] = Field(default_factory=list)
    suggested_text: Optional[str] = None  # sadece sentence_rewrite için
    ui: Optional[UIStrings] = None


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
