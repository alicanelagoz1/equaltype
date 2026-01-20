import re
from typing import List, Tuple

# NOTE: This is MVP lexicon/rule layer (fast).
# We'll expand language coverage incrementally and keep structure stable.

RuleMatch = Tuple[re.Pattern, str, str, str]  # (regex, category, severity, suggestion_hint)

RULES = {
    "tr": [
        (re.compile(r"\badam gibi\b", re.IGNORECASE), "gender", "warning", "düzgünce / iyi bir şekilde"),
        (re.compile(r"\bbayan\b", re.IGNORECASE), "gender", "warning", "kadın (context-dependent)"),
        (re.compile(r"\bkız gibi ağlama\b", re.IGNORECASE), "gender", "strong", "ağlama / üzülme"),
        (re.compile(r"\bbilim adamı\b", re.IGNORECASE), "gender", "warning", "bilim insanı"),
        (re.compile(r"\bsakat\b", re.IGNORECASE), "disability", "strong", "engelli / engellilik (context-dependent)"),
        (re.compile(r"\bdeli\b", re.IGNORECASE), "disability", "warning", "mantıksız / aşırı / beklenmedik (context-dependent)"),
    ],
    "en": [
        (re.compile(r"\bguys\b", re.IGNORECASE), "gender", "warning", "everyone / folks"),
        (re.compile(r"\bcrazy\b", re.IGNORECASE), "disability", "soft", "unexpected / wild"),
        (re.compile(r"\bmanpower\b", re.IGNORECASE), "gender", "warning", "workforce / staff"),
    ],
    "lv": [
        # Latvian placeholders (we'll expand with real LV lexicon later)
        (re.compile(r"\bčigāns\b", re.IGNORECASE), "ethnicity", "strong", "romu (context-dependent)"),
    ],
}

def detect_language_fast(text: str) -> str:
    # MVP language detection:
    # - If TR-specific chars or common words appear -> 'tr'
    # - If LV diacritics appear -> 'lv'
    # - else default to 'en'
    t = text.lower()
    if any(ch in t for ch in ["ı", "ğ", "ş", "ç", "ö", "ü"]):
        return "tr"
    if any(ch in t for ch in ["ā", "ē", "ī", "ū", "ļ", "ķ", "ģ", "ņ", "š", "č", "ž"]):
        return "lv"
    return "en"

def find_all(text: str, lang: str) -> List[dict]:
    rules = RULES.get(lang, RULES["en"])
    findings = []
    idx = 1
    for rx, category, severity, _hint in rules:
        for m in rx.finditer(text):
            findings.append({
                "id": f"f{idx}",
                "start": m.start(),
                "end": m.end(),
                "category": category,
                "severity": severity,
                "surface": text[m.start():m.end()],
            })
            idx += 1
    # Sort by start index
    findings.sort(key=lambda x: (x["start"], x["end"]))
    return findings

def hint_for(surface: str, lang: str) -> str:
    rules = RULES.get(lang, RULES["en"])
    for rx, _cat, _sev, hint in rules:
        if rx.search(surface):
            return hint
    return ""
