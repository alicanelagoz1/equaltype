import json
import re
from typing import Any, Dict, Optional, List, Tuple

from openai import AsyncOpenAI
from .config import settings

_client = AsyncOpenAI(api_key=settings.openai_api_key)
MODEL = getattr(settings, "openai_model", None) or "gpt-4o-mini"


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def _is_sentence_end(ch: str) -> bool:
    return ch in ".!?\n"


def _expand_to_sentence(text: str, start: int, end: int) -> Tuple[int, int]:
    n = len(text)

    s = start
    while s > 0:
        if _is_sentence_end(text[s - 1]):
            break
        s -= 1
    while s < n and text[s].isspace():
        s += 1

    e = end
    while e < n:
        if _is_sentence_end(text[e]):
            e += 1
            break
        e += 1

    s = max(0, min(s, n))
    e = max(s, min(e, n))
    return s, e


def _extract_json(s: str) -> Dict[str, Any]:
    s = s.strip()
    if s.startswith("{") and s.endswith("}"):
        return json.loads(s)

    # Strip code fences
    s = re.sub(r"^```(json)?", "", s.strip(), flags=re.IGNORECASE).strip()
    s = re.sub(r"```$", "", s.strip()).strip()

    # First {...} block
    m = re.search(r"\{.*\}", s, flags=re.DOTALL)
    if not m:
        raise ValueError("No JSON object found in model output.")
    return json.loads(m.group(0))


def _to_clean_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    return str(v).strip()


def _normalize_suggestions(ftype: str, raw_suggestions: Any) -> List[Dict[str, Any]]:
    """
    Normalize suggestions to:
      [{ "text": "...", "replacement": "...", "message": "..." }, ...]
    For avoid: always [].
    """
    if ftype == "avoid":
        return []

    if not isinstance(raw_suggestions, list):
        raw_suggestions = []

    out: List[Dict[str, Any]] = []

    for s in raw_suggestions[:10]:
        if isinstance(s, dict):
            repl = _to_clean_str(s.get("replacement")) or _to_clean_str(s.get("text"))
            msg = _to_clean_str(s.get("message"))
            if repl:
                out.append({"text": repl, "replacement": repl, "message": msg})
            continue

        if isinstance(s, str):
            repl = s.strip()
            if repl:
                out.append({"text": repl, "replacement": repl, "message": ""})
            continue

        repl = _to_clean_str(s)
        if repl:
            out.append({"text": repl, "replacement": repl, "message": ""})

    # dedup by replacement (case-insensitive)
    dedup: List[Dict[str, Any]] = []
    seen = set()
    for it in out:
        key = _to_clean_str(it.get("replacement")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        dedup.append(it)

    return dedup[:3]


def _is_placeholder_replacement(rep: str) -> bool:
    r = (rep or "").strip().lower()
    if not r:
        return True
    bad = {
        "neutral alternative",
        "(neutral alternative)",
        "a neutral alternative",
        "a neutral term",
        "neutral term",
        "a respectful term",
        "a respectful alternative",
        "respectful term",
        "a different term",
        "different term",
    }
    return r in bad


async def _llm_suggest_replacements(
    *,
    sentence: str,
    language: str,
    subtype: str,
) -> List[Dict[str, Any]]:
    """
    Second-step LLM call:
    - subtype=identity_slur: MUST generate respectful reference phrases.
    - subtype=simple/other: generate neutral replacements.

    IMPORTANT: We do NOT ask the model to repeat the slur term.
    We only provide sentence context and rules.
    """
    if subtype == "identity_slur":
        sys = (
            "You are EqualType, an inclusive language assistant.\n"
            "Generate respectful reference phrases to replace an identity-based slur/insult.\n"
            "Return ONLY JSON: {\"suggestions\": [...]}\n\n"
            "Each suggestion must be an object:\n"
            "{ \"replacement\": \"string\", \"message\": \"string\" }\n\n"
            "Rules:\n"
            "- NEVER repeat any slur/insult or masked form.\n"
            "- NEVER output placeholders like 'neutral alternative' or 'a neutral term'.\n"
            "- Replacement may be multi-word and must fit the sentence.\n"
            "- Use sentence context.\n"
            "- If context is unclear, use a safe generic like 'people' or 'a group of people'.\n"
        )
    else:
        sys = (
            "You are EqualType, an inclusive language assistant.\n"
            "Generate neutral replacements for a problematic term/phrase.\n"
            "Return ONLY JSON: {\"suggestions\": [...]}\n\n"
            "Each suggestion must be an object:\n"
            "{ \"replacement\": \"string\", \"message\": \"string\" }\n\n"
            "Rules:\n"
            "- Do not repeat offensive wording.\n"
            "- No placeholders like 'neutral alternative'.\n"
            "- Replacement must be non-empty and fit the sentence.\n"
        )

    user = (
        f"Language: {language}\n\n"
        f"Sentence:\n{sentence}\n\n"
        "Return JSON now."
    )

    res = await _client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
        temperature=0.2,
    )

    content = res.choices[0].message.content or "{}"
    data = _extract_json(content)
    sug = _normalize_suggestions("replace", data.get("suggestions", []))

    cleaned: List[Dict[str, Any]] = []
    for s in sug:
        rep = _to_clean_str(s.get("replacement"))
        if not rep:
            continue
        if _is_placeholder_replacement(rep):
            continue
        cleaned.append(s)

    if cleaned:
        return cleaned[:3]

    # Final hard fallback (never placeholder)
    return [
        {
            "text": "people",
            "replacement": "people",
            "message": "Use respectful, neutral language when referring to groups of people.",
        }
    ]


async def _llm_suggest_review_rewrites(
    *,
    sentence: str,
    language: str,
) -> List[Dict[str, Any]]:
    """
    For type=review: Provide 1–2 calmer / clearer rewrites WITHOUT blocking the user.
    This is optional; we keep copy_enabled true for review-only cases.
    """
    sys = (
        "You are EqualType, an inclusive language assistant.\n"
        "The user may be reporting violence or sensitive content.\n"
        "Return ONLY JSON: {\"suggestions\": [...]}\n\n"
        "Each suggestion must be an object:\n"
        "{ \"replacement\": \"string\", \"message\": \"string\" }\n\n"
        "Rules:\n"
        "- Do NOT censor facts; do not refuse.\n"
        "- Provide 1–2 rewrites that are clearer/less graphic and avoid unnecessary escalation.\n"
        "- Keep meaning as close as possible.\n"
        "- No placeholders.\n"
    )

    user = (
        f"Language: {language}\n\n"
        f"Sentence:\n{sentence}\n\n"
        "Return JSON now."
    )

    res = await _client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
        temperature=0.2,
    )

    content = res.choices[0].message.content or "{}"
    data = _extract_json(content)
    sug = _normalize_suggestions("review", data.get("suggestions", []))

    cleaned: List[Dict[str, Any]] = []
    for s in sug:
        rep = _to_clean_str(s.get("replacement"))
        if not rep:
            continue
        if _is_placeholder_replacement(rep):
            continue
        cleaned.append(s)

    return cleaned[:2]


def _clamp_findings(text: str, findings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for i, f in enumerate(findings):
        try:
            start = max(0, int(f.get("start", 0)))
            end = max(start, int(f.get("end", start)))
        except Exception:
            continue

        if start >= len(text):
            continue
        if end > len(text):
            end = len(text)

        ftype = _to_clean_str(f.get("type"))
        if ftype not in ("replace", "avoid", "review"):
            continue

        subtype = _to_clean_str(f.get("subtype")) or "simple"

        span = text[start:end]
        msg = _to_clean_str(f.get("message")) or (
            "We suggest not using this sentence."
            if ftype == "avoid"
            else "This could be phrased more clearly and calmly."
            if ftype == "review"
            else "We strongly suggest changing this word to a neutral term."
        )

        suggestions = _normalize_suggestions(ftype, f.get("suggestions"))

        if ftype == "avoid":
            # Avoid = sentence-level, no suggestions
            start, end = _expand_to_sentence(text, start, end)
            span = text[start:end]
            suggestions = []

        conf = f.get("confidence", 0.7)
        try:
            conf = float(conf)
        except Exception:
            conf = 0.7
        conf = max(0.0, min(1.0, conf))

        out.append(
            {
                "id": str(f.get("id") or f"f_{i+1:03d}"),
                "type": ftype,
                "subtype": subtype,
                "start": start,
                "end": end,
                "text": span,
                "message": msg,
                "suggestions": suggestions,
                "confidence": conf,
            }
        )

    return out


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
async def llm_scan(text: str, language: Optional[str] = None) -> Dict[str, Any]:
    """
    Step 1: detect findings: replace / avoid / review (+ subtype)
    Step 2:
      - for replace: guarantee real replacements (no placeholder)
      - for review: optionally provide 1–2 calmer rewrites
    """
    target_lang = (language or "en").lower()
    if target_lang == "auto":
        target_lang = "en"

    sys = (
        "You are EqualType, an inclusive language assistant.\n"
        "Detect discriminatory, exclusionary, or harmful language.\n"
        "Return ONLY JSON with keys: language, findings.\n\n"
        "Each finding must include:\n"
        "- id (string)\n"
        '- type: "replace" or "avoid" or "review"\n'
        '- subtype: "simple" or "identity_slur" or "other"\n'
        "- start (int char offset), end (int char offset)\n"
        "- message (polite)\n"
        "- suggestions (array; may be empty)\n"
        "- confidence (0..1)\n\n"
        "Rules:\n"
        '1) Sentence-level discrimination, dehumanization, stereotyping, or exclusion => type="avoid" (cover FULL sentence). suggestions must be [].\n'
        '2) Replaceable biased/pejorative term/phrase => type="replace", subtype="simple". Provide suggestions or leave empty.\n'
        '3) Identity-based slur/insult/dehumanizing label => type="replace", subtype="identity_slur". Provide suggestions or leave empty.\n'
        '4) If the text describes violence/sensitive events as reporting/news/factual context WITHOUT encouraging it => type="review". Do NOT block. suggestions may be empty.\n'
        '5) Use type="avoid" for violence ONLY if it encourages, threatens, or calls for violence.\n'
        "6) Offsets must be accurate.\n"
        "7) Do not output placeholder suggestions like 'neutral alternative'.\n"
    )

    user = (
        f"Language hint: {target_lang}\n"
        f"Text:\n{text}\n\n"
        "Return JSON now."
    )

    res = await _client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": sys}, {"role": "user", "content": user}],
        temperature=0.2,
    )

    content = res.choices[0].message.content or "{}"
    data = _extract_json(content)

    findings = data.get("findings", [])
    if not isinstance(findings, list):
        findings = []

    normalized = _clamp_findings(text, findings)

    # Step 2: Guarantee suggestions where needed
    for f in normalized:
        ftype = f.get("type")

        if ftype == "replace":
            subtype = _to_clean_str(f.get("subtype")) or "simple"
            sugs = f.get("suggestions") or []
            first_rep = ""
            if sugs and isinstance(sugs[0], dict):
                first_rep = _to_clean_str(sugs[0].get("replacement"))

            if (not sugs) or _is_placeholder_replacement(first_rep):
                s, e = _expand_to_sentence(text, int(f["start"]), int(f["end"]))
                sent = text[s:e]
                f["suggestions"] = await _llm_suggest_replacements(
                    sentence=sent,
                    language=target_lang,
                    subtype=subtype,
                )

        elif ftype == "review":
            # Review-only: do NOT block copy; suggestions optional (calmer rewrite)
            sugs = f.get("suggestions") or []
            if not sugs:
                s, e = _expand_to_sentence(text, int(f["start"]), int(f["end"]))
                sent = text[s:e]
                f["suggestions"] = await _llm_suggest_review_rewrites(
                    sentence=sent,
                    language=target_lang,
                )

        # avoid: do nothing

    lang_out = data.get("language") or (language or "auto")
    return {"language": lang_out, "findings": normalized}
