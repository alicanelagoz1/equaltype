from typing import Optional, Dict, Any

from app.core.openai_client import llm_scan as _llm_scan


async def llm_scan(text: str, language: Optional[str] = None) -> Dict[str, Any]:
    return await _llm_scan(text=text, language=language)
