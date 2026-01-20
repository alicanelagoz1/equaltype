#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from openai import OpenAI


CURATE_SYSTEM = """You are a strict evaluator for an inclusive-language detection system.

Given an input text, decide whether it should be flagged.

Return ONLY valid JSON:
{
  "label": "problematic|clean",
  "type": "slur|stereotype|exclusion|hate|other|null",
  "severity": "block|warn|info|null",
  "target_substring": "string|null",
  "rewrite": "string|null",
  "rationale": "string",
  "confidence": 0.0-1.0,
  "false_positive_risk": 0.0-1.0
}

Rules:
- If label="clean": type/severity/target_substring/rewrite should be null.
- If label="problematic": provide a target_substring that appears verbatim in the input text.
  Prefer the smallest meaningful span (word/phrase). Do NOT invent a substring.
- Severity rubric:
  - block: slurs, dehumanization metaphors against a group, explicit hate/violence
  - warn: exclusion from roles/opportunities; stereotypes/generalizations
  - info: milder harmful framing (e.g., casual ableism like "lame")
- Keep rewrite neutral, meaning-preserving, non-preachy.
"""


def client() -> OpenAI:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    return OpenAI(api_key=key)


def model_1() -> str:
    return os.getenv("OPENAI_MODEL_CURATE", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))


def model_2() -> Optional[str]:
    return os.getenv("OPENAI_MODEL_CURATE_2")


def call_curator(c: OpenAI, model: str, text: str) -> Dict[str, Any]:
    resp = c.responses.create(
        model=model,
        input=[
            {"role": "system", "content": CURATE_SYSTEM},
            {"role": "user", "content": text},
        ],
    )
    out = getattr(resp, "output_text", None) or ""
    try:
        data = json.loads(out)
    except Exception as e:
        raise RuntimeError(f"Curator returned non-JSON: {e}\nRaw (first 600): {out[:600]}")
    return data


def normalize_result(text: str, d: Dict[str, Any]) -> Dict[str, Any]:
    label = d.get("label")
    if label not in ("problematic", "clean"):
        label = "clean"

    type_ = d.get("type")
    severity = d.get("severity")

    if label == "clean":
        return {
            "label": "clean",
            "type": None,
            "severity": None,
            "target_substring": None,
            "rewrite": None,
            "rationale": str(d.get("rationale") or "").strip()[:400],
            "confidence": float(d.get("confidence") or 0.0),
            "false_positive_risk": float(d.get("false_positive_risk") or 0.0),
        }

    # problematic
    if type_ not in ("slur", "stereotype", "exclusion", "hate", "other"):
        type_ = "other"
    if severity not in ("block", "warn", "info"):
        severity = "warn"

    target = d.get("target_substring")
    if not isinstance(target, str) or not target.strip():
        target = None
    else:
        target = target.strip()
        if target not in text:
            # invalid target; force reject later by setting confidence low
            target = None

    rewrite = d.get("rewrite")
    if not isinstance(rewrite, str) or not rewrite.strip():
        rewrite = None
    else:
        rewrite = rewrite.strip()

    return {
        "label": "problematic" if target else "clean",
        "type": type_ if target else None,
        "severity": severity if target else None,
        "target_substring": target,
        "rewrite": rewrite if target else None,
        "rationale": str(d.get("rationale") or "").strip()[:400],
        "confidence": float(d.get("confidence") or 0.0),
        "false_positive_risk": float(d.get("false_positive_risk") or 0.0),
    }


def agree(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    # strict-ish: label must match; if problematic, type+severity must match too
    if a.get("label") != b.get("label"):
        return False
    if a.get("label") == "clean":
        return True
    return a.get("type") == b.get("type") and a.get("severity") == b.get("severity")


def main() -> int:
    ap = argparse.ArgumentParser(description="LLM auto-curation for discovered candidates")
    ap.add_argument("--in", dest="inp", default="tests/candidates_raw.jsonl", help="Input JSONL path")
    ap.add_argument("--out", default="tests/candidates_curated.jsonl", help="Output JSONL path")
    ap.add_argument("--max", type=int, default=100000, help="Max records to process")
    ap.add_argument("--min-confidence", type=float, default=0.70, help="Minimum curator confidence to accept")
    ap.add_argument("--max-fp-risk", type=float, default=0.35, help="Maximum false-positive risk to accept")
    args = ap.parse_args()

    in_path = Path(args.inp)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    c = client()
    m1 = model_1()
    m2 = model_2()

    processed = 0
    accepted = 0
    rejected = 0

    with in_path.open("r", encoding="utf-8") as fin, out_path.open("a", encoding="utf-8") as fout:
        for line in fin:
            if processed >= args.max:
                break
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            text = rec.get("text", "")
            if not isinstance(text, str) or not text.strip():
                continue

            r1 = normalize_result(text, call_curator(c, m1, text))

            consensus = True
            if m2:
                r2 = normalize_result(text, call_curator(c, m2, text))
                consensus = agree(r1, r2)

            ok = (
                consensus
                and r1.get("confidence", 0.0) >= args.min_confidence
                and r1.get("false_positive_risk", 1.0) <= args.max_fp_risk
            )

            out_rec = {
                **rec,
                "curation": r1,
                "consensus": consensus,
                "accepted": bool(ok),
            }

            fout.write(json.dumps(out_rec, ensure_ascii=False) + "\n")

            processed += 1
            if ok:
                accepted += 1
            else:
                rejected += 1

    print(f"Processed: {processed} | Accepted: {accepted} | Rejected: {rejected}")
    print(f"Wrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
