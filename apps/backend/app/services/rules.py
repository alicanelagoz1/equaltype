import os
import re
import yaml
from dataclasses import dataclass
from typing import List, Dict, Any

@dataclass
class Rule:
    id: str
    category: str
    severity: str
    description: str
    patterns: List[re.Pattern]
    suggestions: List[str]

def _compile_patterns(patterns: List[str]) -> List[re.Pattern]:
    return [re.compile(p, flags=re.IGNORECASE | re.UNICODE) for p in patterns]

def load_rules_for_language(lang: str) -> List[Rule]:
    app_dir = os.path.dirname(os.path.dirname(__file__))  # app/services -> app
    rules_dir = os.path.join(app_dir, "rules")
    path = os.path.join(rules_dir, f"{lang}.yaml")
    if not os.path.exists(path):
        return []

    with open(path, "r", encoding="utf-8") as f:
        data: Dict[str, Any] = yaml.safe_load(f) or {}

    out: List[Rule] = []
    for r in data.get("rules", []):
        out.append(
            Rule(
                id=r["id"],
                category=r.get("category", "other"),
                severity=r.get("severity", "low"),
                description=r.get("description", ""),
                patterns=_compile_patterns(r.get("patterns", [])),
                suggestions=r.get("suggestions", []),
            )
        )
    return out

def scan_text(lang: str, text: str) -> List[dict]:
    rules = load_rules_for_language(lang)
    findings: List[dict] = []

    for rule in rules:
        for pat in rule.patterns:
            for m in pat.finditer(text):
                findings.append(
                    {
                        "rule_id": rule.id,
                        "category": rule.category,
                        "severity": rule.severity,
                        "description": rule.description,
                        "start": m.start(),
                        "end": m.end(),
                        "match": text[m.start():m.end()],
                        "rule_suggestions": rule.suggestions,
                    }
                )

    findings.sort(key=lambda x: (x["start"], -(x["end"] - x["start"])))
    filtered: List[dict] = []
    last_end = -1
    for f in findings:
        if f["start"] >= last_end:
            filtered.append(f)
            last_end = f["end"]
    return filtered
