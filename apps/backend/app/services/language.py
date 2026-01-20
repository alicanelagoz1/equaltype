from langdetect import detect, DetectorFactory

DetectorFactory.seed = 0
SUPPORTED = {"en", "de", "lv"}

def detect_language(text: str) -> str:
    clean = (text or "").strip()
    if len(clean) < 20:
        return "en"
    try:
        lang = detect(clean)
        return lang if lang in SUPPORTED else "en"
    except Exception:
        return "en"
