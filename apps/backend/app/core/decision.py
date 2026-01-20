from typing import Any, Dict, Optional

from app.schemas.analysis import AnalyzeResponse
from app.services.llm import analyze_with_llm

def analyze_text(text: str, locale: str = "en-US", context: Optional[Dict[str, Any]] = None) -> AnalyzeResponse:
    """
    LLM-only brain.
    If LLM not configured, returns clean + popup message.
    """
    data = analyze_with_llm(text, locale=locale, context=context)

    # Pydantic response_model is AnalyzeResponse, ama sen şemanı genişlettin (status/actions vs).
    # AnalyzeResponse bunu kapsıyorsa direkt dönebilir.
    # Eğer şeman dar ise, aşağıdaki gibi sadece temel alanları döndürmen gerekir.
    return AnalyzeResponse(**data)
