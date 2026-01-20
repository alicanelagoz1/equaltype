from pydantic import BaseModel
from typing import List, Optional, Literal


Severity = Literal["soft", "warning", "strong"]
Mode = Literal["warn", "autofix"]


class Finding(BaseModel):
    id: str
    start: int
    end: int
    category: str
    severity: Severity
    surface: str


class DetectRequest(BaseModel):
    text: str
    preferredLanguage: Optional[str] = None
    mode: Mode = "warn"


class DetectResponse(BaseModel):
    language: str
    findings: List[Finding]


class ExplainRequest(BaseModel):
    text: str
    findingId: str
    language: str
    tone: Literal["neutral", "formal", "friendly"] = "neutral"
    span: Finding  # we reuse fields start/end/surface/category/severity/id


class Suggestion(BaseModel):
    label: str
    text: str


class ExplainResponse(BaseModel):
    id: str
    reason: str
    suggestions: List[Suggestion]
    severity: Severity
    category: str
