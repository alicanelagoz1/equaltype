# app/services/llm.py

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ------------------------------------------------------------
# Guardrails / deterministic fallbacks
# ------------------------------------------------------------

# Minimal deterministic replacements for high-risk terms.
# Keep this small and intentional; extend later if you want.
FORCED_SPAN_REPLACEMENTS = {
    # LGBTQ+ slurs -> neutral term (per your product rule)
    "faggot": "homosexuals",
    "faggots": "homosexuals",
    "fag": "homosexuals",
    "fags": "homosexuals",
}

# For case-insensitive match & preserving capitalization lightly
def _preserve_case(src: str, repl: str) -> str:
    if not src:
        return repl
    if src.isupper():
        return repl.upper()
    if src[0].isupper():
        return repl.capitalize()
    return repl


def _repair_indices(text: str, item: Dict[str, Any]) -> None:
    """
    If start/end are invalid or don't match original, attempt to repair by searching "original".
    Mutates item in-place.
    """
    original = item.get("original") or ""
    if not original or not isinstance(original, str):
        return

    start = item.get("start")
    end = item.get("end")

    try:
        start_i = int(start)
        end_i = int(end)
    except Exception:
        start_i, end_i = -1, -1

    # Already valid and matches
    if 0 <= start_i <= end_i <= len(text) and text[start_i:end_i] == original:
        return

    # Find first occurrence
    idx = text.find(original)
    if idx != -1:
        item["start"] = idx
        item["end"] = idx + len(original)


def _force_rewrite_if_needed(item: Dict[str, Any]) -> None:
    """
    Deterministic override for certain slurs/terms so we always return the short replacement you want.
    """
    original = item.get("original")
    if not original or not isinstance(original, str):
        return

    key = original.strip().lower()
    if key in FORCED_SPAN_REPLACEMENTS:
        forced = _preserve_case(original, FORCED_SPAN_REPLACEMENTS[key])
        item["suggested_rewrite"] = forced

        # Suggestions should be short too
        item["suggestions"] = [forced]

        # Message can stay model-generated, but ensure it exists
        if not item.get("message"):
            item["message"] = "This term is an offensive slur. Please use respectful language."

        # Actions: keep existing rubric if present; otherwise ensure block disables copy
        if not item.get("actions") or not isinstance(item["actions"], list):
            item["actions"] = ["replace", "keep", "disable_copy"]


def _clamp_suggestions(item: Dict[str, Any]) -> None:
    """
    Ensure suggestions are short and not full-sentence rewrites.
    """
    sugg = item.get("suggestions")
    if not isinstance(sugg, list):
        item["suggestions"] = []
        return

    cleaned: List[str] = []
    for s in sugg[:3]:
        if not isinstance(s, str):
            continue
        ss = s.strip()
        # Drop anything that looks like a sentence rewrite (contains punctuation ending, or too long)
        if len(ss) > 40:
            continue
        if re.search(r"[.!?]$", ss):
            continue
        cleaned.append(ss)

    item["suggestions"] = cleaned


SYSTEM_PROMPT = """You are EqualType, an inclusive-language assistant.
Return ONLY valid JSON. No markdown. No extra text.

Core task:
- Detect discriminatory, exclusionary, dehumanizing, hateful, or stereotypical language.
- Detect both:
  (A) term-level issues (a specific word/phrase),
  (B) sentence-level issues (the whole sentence is discriminatory even without a single slur).
- Provide span indices as character offsets in the ORIGINAL input text (0-based, end-exclusive).

MOST IMPORTANT PRODUCT BEHAVIOR:
- If the issue is term-level (a single word/short phrase), DO NOT rewrite the whole sentence.
  Only propose a replacement for the AFFECTED SPAN ("suggested_rewrite").
- Avoid redundancy: if the sentence already explains/defines the concept elsewhere
  (e.g., "people who love the same gender", "attracted to the same gender"),
  do NOT repeat or paraphrase that explanation in suggestions. Keep suggestions minimal.

Span rules (strict):
- start/end are 0-based character offsets in the ORIGINAL text, end-exclusive.
- The substring text[start:end] MUST exactly equal "original".
- If you cannot provide exact indices, set start = -1 and end = -1 (backend will repair by searching "original").

Severity rubric (deterministic):
- block:
  - slurs
  - explicit hate / dehumanization against a protected group
  - calls for harm, removal, eradication
  - dehumanizing metaphors (e.g., "vermin", "infestation", "animals") used to describe a group
- warn:
  - explicit exclusion from roles/services/opportunities (e.g., "only men should apply")
  - stereotypes/generalizations about a group ("X are lazy", "X are too emotional")
- info:
  - milder harmful framing, microaggressions, stigmatizing language
  - casual ableist terms like: "lame", "crazy", "insane" (context-sensitive but usually info/warn)

Type rubric:
- slur: identity-based slurs
- hate: hate or dehumanization / violence directed at a group
- exclusion: excluding a group from roles/services ("only men", "no disabled people")
- stereotype: generalizations about a group ("X are always...", "X can't...")
- other: anything else harmful or context-dependent

Actions:
- block -> ["replace","keep","disable_copy"]
- warn/info -> ["replace","keep","allow_copy"]

For each item:
- "suggestions": 0-3 SHORT alternatives (ideally 1-2 words, NOT full sentences).
- "suggested_rewrite": a fluent replacement for the AFFECTED SPAN only, meaning-preserving.
  Keep it as short as possible while staying neutral.

Output JSON schema (MUST match exactly):
{
  "is_clean": boolean,
  "items": [
    {
      "type": "slur|stereotype|exclusion|hate|other",
      "severity": "block|warn|info",
      "start": number,
      "end": number,
      "original": string,
      "masked": string|null,
      "message": string,
      "suggestions": [string],
      "suggested_rewrite": string|null,
      "actions": ["replace","keep","disable_copy"|"allow_copy"]
    }
  ],
  "safe_text": string|null
}

Hard requirement:
- Output MUST be valid JSON. No surrounding text.
"""


def _get_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4o-mini")


def analyze_text_with_llm(text: str) -> Dict[str, Any]:
    if not text or not text.strip():
        return {"is_clean": True, "items": [], "safe_text": text}

    model = _get_model()

    resp = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        # Keep compatibility: do not require response_format.
    )

    output_text = getattr(resp, "output_text", None)

    if not output_text:
        # Fallback for SDK variations
        try:
            output_text = resp.output[0].content[0].text  # type: ignore[attr-defined]
        except Exception:
            output_text = str(resp)

    try:
        data = json.loads(output_text)
    except Exception as e:
        raise ValueError(
            f"LLM returned non-JSON output: {e}\n"
            f"Raw (first 800 chars): {output_text[:800]}"
        )

    # ------------------------------------------------------------
    # Post-process: repair indices, enforce minimal replacements,
    # and guarantee your "Faggot" -> "homosexuals" behavior.
    # ------------------------------------------------------------
    items = data.get("items", [])
    if not isinstance(items, list):
        data["items"] = []
        items = data["items"]

    for item in items:
        if not isinstance(item, dict):
            continue

        # 1) Repair indices if needed
        _repair_indices(text, item)

        # 2) Ensure suggestions are short
        _clamp_suggestions(item)

        # 3) Force minimal rewrite for certain slurs (your requirement)
        # Only if it's actually a slur item OR if model didn't classify but original matches.
        original = item.get("original")
        if isinstance(original, str) and original.strip():
            if (item.get("type") == "slur") or (original.strip().lower() in FORCED_SPAN_REPLACEMENTS):
                _force_rewrite_if_needed(item)

        # 4) If suggested_rewrite is suspiciously long for term-level items, trim it.
        # We treat "term-level" as: has valid start/end and original is not too long.
        try:
            start_i = int(item.get("start", -1))
            end_i = int(item.get("end", -1))
        except Exception:
            start_i, end_i = -1, -1

        original = item.get("original")
        suggested_rewrite = item.get("suggested_rewrite")

        if (
            isinstance(original, str)
            and isinstance(suggested_rewrite, str)
            and 0 <= start_i < end_i <= len(text)
            and len(original) <= 30  # likely a span
        ):
            # If model tries to inject an explanation, keep only first chunk.
            sr = suggested_rewrite.strip()
            if len(sr) > 40:
                # take first 1-3 words
                parts = sr.split()
                sr = " ".join(parts[:3]).strip()
            item["suggested_rewrite"] = sr

            # Keep suggestions aligned
            if not item.get("suggestions"):
                item["suggestions"] = [sr]
            elif isinstance(item.get("suggestions"), list):
                # ensure first suggestion equals suggested_rewrite if short
                if sr and (sr not in item["suggestions"]):
                    item["suggestions"] = [sr] + item["suggestions"][:2]

    # is_clean sanity
    if not items:
        data["is_clean"] = True
        data["safe_text"] = text
    else:
        # if any block exists, safe_text can stay null (your UI may block copy)
        data["is_clean"] = False
        if "safe_text" not in data:
            data["safe_text"] = None

    return data
