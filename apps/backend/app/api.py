from fastapi import APIRouter
from .services.analysis import llm_scan

router = APIRouter()


@router.post("/llm/scan")
async def llm_scan_api(payload: dict):
    text = (payload.get("text") or "").strip()
    language = payload.get("language")

    if not text:
        return {"language": language or "auto", "findings": []}

    return await llm_scan(text=text, language=language)
