#!/usr/bin/env python3
"""Audit a schema / migration / PR-diff file against the Taleemabad Data Standards.

This is a HEURISTIC scanner, not a certifier. It greps the given file(s) for the
regex fragments each standard declares in `detect:` and reports which standards
look POSSIBLY RELEVANT and worth a human/agent look — it cannot see DB-level
enforcement (actual constraints, RLS policies, CI gates), so a hit is a pointer,
not a pass, and a miss is not proof of absence. See SKILL.md "What this script
can and cannot check" before trusting its output as a compliance report.

Usage:
    python3 audit.py <file-or-diff> [file2 ...]
    python3 audit.py --tier non_negotiable schema.sql
    python3 audit.py --product lesson_plans migration_017.sql
    python3 audit.py --json schema.sql        # machine-readable output
    python3 audit.py --list                   # print every standard, no scan

Exit code: 0 always for a normal scan (this is advisory). Use --strict to exit 1
when any NON-NEGOTIABLE standard has zero detected signal in the input — wire
that into a pre-commit hook or CI step if you want a hard gate outside Claude Code
(hooks/schema-change-gate.sh + scripts/validate_schema.py cover the in-session
Claude-initiated case with structural, not just keyword, checks).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Missing dependency: pyyaml. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

REFERENCE = Path(__file__).resolve().parent.parent / "reference" / "standards.yaml"


def load_standards() -> dict:
    if not REFERENCE.exists():
        print(f"Can't find {REFERENCE}", file=sys.stderr)
        sys.exit(1)
    return yaml.safe_load(REFERENCE.read_text(encoding="utf-8"))


def scan_text(text: str, standards: list[dict]) -> dict[str, list[str]]:
    """Return {standard_id: [matched fragments]} for every standard with >=1 hit."""
    low = text.lower()
    hits: dict[str, list[str]] = {}
    for std in standards:
        matched = []
        for pattern in std.get("detect") or []:
            if re.search(pattern, low, re.IGNORECASE):
                matched.append(pattern)
        if matched:
            hits[std["id"]] = matched
    return hits


def filter_standards(standards: list[dict], tier: str | None, product: str | None) -> list[dict]:
    out = standards
    if tier:
        out = [s for s in out if s["tier"] == tier]
    if product:
        out = [s for s in out if (s.get("products", {}).get(product) or {}).get("applies", True)]
    return out


def format_report(data: dict, hits: dict[str, list[str]], files: list[str]) -> str:
    by_id = {s["id"]: s for s in data["standards"]}
    lines = [f"Data Standards scan — {', '.join(files)}", "=" * 60]

    if not hits:
        lines.append("\nNo standard-related keywords detected. This does NOT mean")
        lines.append("compliant — it means nothing in this input matched the heuristic")
        lines.append("patterns. Read reference/standards.yaml and check by hand for")
        lines.append("standards that don't have a textual signature (D7 ownership,")
        lines.append("D10 freshness SLAs, D18 contracts, D21 quality dimensions, etc).")
        return "\n".join(lines)

    by_tier: dict[str, list[str]] = {}
    for sid in hits:
        by_tier.setdefault(by_id[sid]["tier"], []).append(sid)

    tier_order = ["non_negotiable", "essential", "advanced", "specialized"]
    for tier in tier_order:
        ids = sorted(by_tier.get(tier, []), key=lambda x: int(x[1:]))
        if not ids:
            continue
        label = data["tiers"][tier]["label"]
        lines.append(f"\n{label}")
        for sid in ids:
            std = by_id[sid]
            lines.append(f"  {sid}  {std['standard']}")
            lines.append(f"       matched: {', '.join(hits[sid])}")
            lines.append(f"       verify against metric: {std['metrics'][0]}")

    lines.append("\n" + "-" * 60)
    lines.append("These are HITS on keyword patterns, not passed checks.")
    lines.append("For each one: confirm the actual enforcement (constraint, label,")
    lines.append("test, contract) is present — not just the word.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="schema/migration/diff files to scan")
    ap.add_argument("--tier", choices=["non_negotiable", "essential", "advanced", "specialized"])
    ap.add_argument("--product", choices=["lesson_plans", "digital_coach", "teacher_training",
                                           "exam_generator", "user_mgmt", "data_analytics"])
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--list", action="store_true", help="list standards and exit, no scan")
    ap.add_argument("--strict", action="store_true",
                     help="exit 1 if any non_negotiable standard has zero detected signal")
    args = ap.parse_args()

    data = load_standards()
    standards = filter_standards(data["standards"], args.tier, args.product)

    if args.list:
        for std in standards:
            print(f"{std['id']}  [{data['tiers'][std['tier']]['label']}]  {std['standard']}")
        return 0

    if not args.files:
        ap.error("give at least one file to scan, or use --list")

    text = ""
    for f in args.files:
        p = Path(f)
        if not p.exists():
            print(f"Not found: {f}", file=sys.stderr)
            return 1
        text += p.read_text(encoding="utf-8", errors="replace") + "\n"

    hits = scan_text(text, standards)

    if args.json:
        print(json.dumps({"files": args.files, "hits": hits}, indent=2))
    else:
        print(format_report(data, hits, args.files))

    if args.strict:
        non_neg = [s["id"] for s in data["standards"] if s["tier"] == "non_negotiable"]
        missing = [sid for sid in non_neg if sid not in hits]
        if missing:
            print(f"\nSTRICT MODE: no signal for {', '.join(missing)} — review by hand before merging.",
                  file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
