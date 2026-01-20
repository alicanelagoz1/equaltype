#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


VALID_TYPES = {"slur", "stereotype", "exclusion", "hate", "other"}
VALID_SEVERITIES = {"block", "warn", "info"}


def load_cases(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if "cases" not in data or not isinstance(data["cases"], list):
        raise ValueError("Invalid cases.json: missing 'cases' list")
    return data


def post_analyze(base_url: str, text: str, timeout: float = 30.0) -> Dict[str, Any]:
    url = base_url.rstrip("/") + "/api/analyze"
    r = requests.post(url, json={"text": text}, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"POST {url} failed: {r.status_code} {r.text[:500]}")
    return r.json()


def assert_bool(name: str, got: Any) -> Optional[str]:
    if not isinstance(got, bool):
        return f"{name} expected bool, got {type(got).__name__}"
    return None


def assert_items_span_integrity(text: str, items: List[Dict[str, Any]]) -> List[str]:
    errs: List[str] = []
    for i, it in enumerate(items):
        start = it.get("start")
        end = it.get("end")
        original = it.get("original")
        if not isinstance(start, int) or not isinstance(end, int):
            errs.append(f"items[{i}].start/end not ints")
            continue
        if not (0 <= start < end <= len(text)):
            errs.append(f"items[{i}] invalid span [{start},{end}) for text len {len(text)}")
            continue
        if not isinstance(original, str):
            errs.append(f"items[{i}].original not str")
            continue
        if text[start:end] != original:
            errs.append(
                f"items[{i}] span mismatch: text[{start}:{end}]='{text[start:end]}' != original='{original}'"
            )
        t = it.get("type")
        s = it.get("severity")
        if t not in VALID_TYPES:
            errs.append(f"items[{i}].type invalid '{t}'")
        if s not in VALID_SEVERITIES:
            errs.append(f"items[{i}].severity invalid '{s}'")
    return errs


def contains_any_item_with(items: List[Dict[str, Any]], field: str, allowed: List[str]) -> bool:
    for it in items:
        v = it.get(field)
        if v in allowed:
            return True
    return False


def any_item_original_contains(items: List[Dict[str, Any]], needles: List[str]) -> bool:
    needles_l = [n.lower() for n in needles]
    for it in items:
        orig = it.get("original")
        if isinstance(orig, str) and orig.lower() in needles_l:
            return True
    return False


def validate_case(case: Dict[str, Any], resp: Dict[str, Any]) -> List[str]:
    errs: List[str] = []

    text = case["text"]
    exp = case.get("expected", {})

    # basic fields
    for field in ["is_clean", "copy_allowed"]:
        e = assert_bool(field, resp.get(field))
        if e:
            errs.append(e)

    items = resp.get("items")
    if not isinstance(items, list):
        errs.append(f"items expected list, got {type(items).__name__}")
        items = []

    # min_items / is_clean consistency
    min_items = exp.get("min_items")
    if isinstance(min_items, int):
        if len(items) < min_items:
            errs.append(f"min_items expected >= {min_items}, got {len(items)}")

    is_clean_exp = exp.get("is_clean")
    if isinstance(is_clean_exp, bool):
        if resp.get("is_clean") != is_clean_exp:
            errs.append(f"is_clean expected {is_clean_exp}, got {resp.get('is_clean')}")
        # if clean expected, enforce no items
        if is_clean_exp is True and len(items) != 0:
            errs.append(f"is_clean true but items length is {len(items)}")

    copy_allowed_exp = exp.get("copy_allowed")
    if isinstance(copy_allowed_exp, bool):
        if resp.get("copy_allowed") != copy_allowed_exp:
            errs.append(f"copy_allowed expected {copy_allowed_exp}, got {resp.get('copy_allowed')}")

    # span integrity checks (strong regression signal)
    errs.extend(assert_items_span_integrity(text, items))

    # must have severity types
    must_sev = exp.get("must_have_severity")
    if isinstance(must_sev, list) and must_sev:
        ok = False
        for sev in must_sev:
            if contains_any_item_with(items, "severity", [sev]):
                ok = True
                break
        if not ok:
            errs.append(f"must_have_severity not satisfied. expected any of {must_sev}")

    must_type_any = exp.get("must_have_type_any_of")
    if isinstance(must_type_any, list) and must_type_any:
        if not contains_any_item_with(items, "type", must_type_any):
            errs.append(f"must_have_type_any_of not satisfied. expected any of {must_type_any}")

    must_orig = exp.get("must_contain_original")
    if isinstance(must_orig, list) and must_orig:
        if not any_item_original_contains(items, must_orig):
            errs.append(f"must_contain_original not satisfied. expected one of {must_orig}")

    return errs


def main() -> int:
    ap = argparse.ArgumentParser(description="Run EqualType golden test set against /api/analyze")
    ap.add_argument("--base-url", default="http://localhost:8000", help="API base URL (default: http://localhost:8000)")
    ap.add_argument("--cases", default="tests/cases.json", help="Path to cases.json (default: tests/cases.json)")
    ap.add_argument("--timeout", type=float, default=30.0, help="Request timeout seconds (default: 30)")
    ap.add_argument("--fail-fast", action="store_true", help="Stop at first failure")
    args = ap.parse_args()

    cases_path = Path(args.cases)
    if not cases_path.exists():
        print(f"ERROR: cases file not found: {cases_path}", file=sys.stderr)
        return 2

    data = load_cases(cases_path)
    cases = data["cases"]

    total = 0
    failed = 0

    print(f"Running {len(cases)} cases against {args.base_url} ...")

    for case in cases:
        total += 1
        cid = case.get("id", f"case_{total}")
        text = case["text"]

        try:
            resp = post_analyze(args.base_url, text, timeout=args.timeout)
            errs = validate_case(case, resp)
        except Exception as e:
            errs = [f"request/error: {e}"]

        if errs:
            failed += 1
            print(f"\n[FAIL] {cid}")
            for e in errs:
                print(f"  - {e}")
            # Print a compact debug view
            try:
                dbg = {
                    "is_clean": resp.get("is_clean"),
                    "copy_allowed": resp.get("copy_allowed"),
                    "copy_message": resp.get("copy_message"),
                    "items_count": len(resp.get("items", [])) if isinstance(resp.get("items"), list) else None,
                    "items_preview": resp.get("items", [])[:2] if isinstance(resp.get("items"), list) else None,
                }
                print("  response_preview:", json.dumps(dbg, ensure_ascii=False, indent=2))
            except Exception:
                pass

            if args.fail_fast:
                print(f"\nStopped (fail-fast). {failed}/{total} failed.")
                return 1
        else:
            print(f"[PASS] {cid}")

    print(f"\nDone. {failed}/{total} failed.")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
