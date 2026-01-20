# app/services/postprocess.py

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


SEVERITY_TO_ACTIONS = {
    "block": ["replace", "keep", "disable_copy"],
    "warn": ["replace", "keep", "allow_copy"],
    "info": ["replace", "keep", "allow_copy"],
}

VALID_TYPES = {"slur", "stereotype", "exclusion", "hate", "other"}


# --- Copy UX messages (Step 4) ---
COPY_MSG_WORD_BLOCK = (
    "This word has a long history of harm and exclusion. "
    "For this reason, it cannot be copied or used in this context."
)

COPY_MSG_WORDING_BLOCK = (
    "This wording has a long history of harm and exclusion. "
    "For this reason, it cannot be copied or used in this context."
)

COPY_MSG_WORDING_WARN = (
    "This wording may unintentionally exclude or stereotype some people. "
    "We recommend revising or avoiding it."
)


# --- Keep UX messages (Step 4.5) ---
KEEP_MSG_WORD_BLOCK = (
    "You chose to keep this word. Copy remains disabled because it is harmful in this context."
)

KEEP_MSG_WORDING_BLOCK = (
    "You chose to keep this wording. Copy remains disabled because it is harmful in this context."
)

KEEP_MSG_WORD_WARN = (
    "You chose to keep this word. We still recommend revising it to avoid unintended harm."
)

KEEP_MSG_WORDING_WARN = (
    "You chose to keep this wording. We still recommend revising it to avoid unintended harm."
)

KEEP_MSG_WORD_INFO = (
    "You chose to keep this word. Consider revising it if you want a clearer, more respectful tone."
)

KEEP_MSG_WORDING_INFO = (
    "You chose to keep this wording. Consider revising it if you want a clearer, more respectful tone."
)


def mask_slur(word: str) -> str:
    w = (word or "").strip()
    if not w:
        return w
    if len(w) == 1:
        return w[0] + "*"
    stars = "*" * min(5, max(3, len(w) - 1))
    return w[0] + stars


def find_all_occurrences(text: str, needle: str) -> List[Tuple[int, int]]:
    if not needle:
        return []
    out: List[Tuple[int, int]] = []
    start = 0
    while True:
        idx = text.find(needle, start)
        if idx == -1:
            break
        out.append((idx, idx + len(needle)))
        start = idx + len(needle)
    return out


def repair_spans(text: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for it in items:
        original = (it.get("original") or "").strip()
        if not original:
            continue

        start = it.get("start")
        end = it.get("end")

        if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(text):
            if text[start:end] == original:
                continue

        occ = find_all_occurrences(text, original)
        if not occ:
            lower_text = text.lower()
            lower_orig = original.lower()
            occ = find_all_occurrences(lower_text, lower_orig)

        if not occ:
            continue

        if isinstance(start, int) and start >= 0:
            occ.sort(key=lambda se: abs(se[0] - start))

        chosen = occ[0]
        it["start"], it["end"] = chosen[0], chosen[1]

    return items


def _is_word_span(original: str) -> bool:
    o = (original or "").strip()
    if not o:
        return False
    return " " not in o and "\t" not in o and "\n" not in o


def _keep_message_for(severity: str, original: str) -> str:
    is_word = _is_word_span(original)
    if severity == "block":
        return KEEP_MSG_WORD_BLOCK if is_word else KEEP_MSG_WORDING_BLOCK
    if severity == "warn":
        return KEEP_MSG_WORD_WARN if is_word else KEEP_MSG_WORDING_WARN
    return KEEP_MSG_WORD_INFO if is_word else KEEP_MSG_WORDING_INFO


def _compute_replacement(it: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """
    Returns (replacement_text, replacement_kind)
      - kind: "rewrite" | "suggestion" | None
    Priority:
      1) suggested_rewrite
      2) suggestions[0]
    """
    rw = it.get("suggested_rewrite")
    if isinstance(rw, str) and rw.strip():
        return rw.strip(), "rewrite"

    sug = it.get("suggestions") or []
    if isinstance(sug, list) and len(sug) > 0 and isinstance(sug[0], str) and sug[0].strip():
        return sug[0].strip(), "suggestion"

    return None, None


def normalize_items(text: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []

    for it in items:
        if not isinstance(it, dict):
            continue

        sev = it.get("severity", "warn")
        if sev not in SEVERITY_TO_ACTIONS:
            sev = "warn"
        it["severity"] = sev

        it["actions"] = SEVERITY_TO_ACTIONS[sev]

        t = it.get("type", "other")
        if t not in VALID_TYPES:
            t = "other"
        it["type"] = t

        original = it.get("original") or ""
        if not isinstance(original, str):
            original = str(original)
        it["original"] = original

        if sev == "block" or t in {"slur", "hate"}:
            masked = it.get("masked")
            if not isinstance(masked, str) or not masked.strip():
                it["masked"] = mask_slur(original)
        else:
            it["masked"] = None

        sug = it.get("suggestions") or []
        if not isinstance(sug, list):
            sug = []
        sug_clean: List[str] = []
        for s in sug:
            if isinstance(s, str) and s.strip():
                sug_clean.append(s.strip())
            if len(sug_clean) >= 3:
                break
        it["suggestions"] = sug_clean

        rw = it.get("suggested_rewrite")
        if not isinstance(rw, str) or not rw.strip():
            it["suggested_rewrite"] = None
        else:
            it["suggested_rewrite"] = rw.strip()

        msg = it.get("message")
        if not isinstance(msg, str) or not msg.strip():
            it["message"] = "We recommend revising this wording."
        else:
            it["message"] = msg.strip()

        km = it.get("keep_message")
        if not isinstance(km, str) or not km.strip():
            it["keep_message"] = _keep_message_for(sev, original)
        else:
            it["keep_message"] = km.strip()

        # Step 5: deterministic replacement payload
        replacement_text, replacement_kind = _compute_replacement(it)
        it["replacement_text"] = replacement_text
        it["replacement_kind"] = replacement_kind

        normalized.append(it)

    normalized = repair_spans(text, normalized)

    cleaned: List[Dict[str, Any]] = []
    for it in normalized:
        s, e = it.get("start"), it.get("end")
        if isinstance(s, int) and isinstance(e, int) and 0 <= s < e <= len(text):
            cleaned.append(it)

    return cleaned


def build_safe_text(text: str, items: List[Dict[str, Any]]) -> Optional[str]:
    if not items:
        return text

    for it in items:
        if it.get("severity") == "block":
            if not it.get("replacement_text"):
                return None

    repls: List[Tuple[int, int, str]] = []
    for it in items:
        s, e = it["start"], it["end"]
        replacement = it.get("replacement_text")
        if replacement:
            repls.append((s, e, replacement))

    if not repls:
        return text

    repls.sort(key=lambda x: x[0], reverse=True)
    out = text
    for s, e, r in repls:
        out = out[:s] + r + out[e:]
    return out


def compute_copy_policy(items: List[Dict[str, Any]]) -> Tuple[bool, Optional[str]]:
    if not items:
        return True, None

    block_items = [it for it in items if it.get("severity") == "block"]
    if block_items:
        it = block_items[0]
        original = it.get("original") or ""
        if _is_word_span(original):
            return False, COPY_MSG_WORD_BLOCK
        return False, COPY_MSG_WORDING_BLOCK

    if any(it.get("severity") == "warn" for it in items):
        return True, COPY_MSG_WORDING_WARN

    return True, None


def postprocess_llm_result(text: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    items = raw.get("items") or []
    if not isinstance(items, list):
        items = []

    items = normalize_items(text, items)
    is_clean = len(items) == 0

    safe_text = raw.get("safe_text")
    if not isinstance(safe_text, str) or not safe_text.strip():
        safe_text = build_safe_text(text, items)

    copy_allowed, copy_message = compute_copy_policy(items)

    return {
        "is_clean": is_clean,
        "items": items,
        "safe_text": safe_text,
        "copy_allowed": copy_allowed,
        "copy_message": copy_message,
    }
