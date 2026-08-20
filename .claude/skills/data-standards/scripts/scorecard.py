#!/usr/bin/env python3
"""Build the D21-style weekly compliance scorecard: % of standards satisfied,
per product, per tier — as a house-style chart PNG.

This script does NOT determine compliance itself (it has no access to your
live schema, CI logs, or metadata catalog). You supply the pass/fail/na verdicts
— from an audit you've already done by hand, via an LLM-assisted read of the
schema, or from whatever system tracks D18 contracts — and this renders them
into the chart the notion-board rule 18 / D21 "shared dashboard" convention
expects.

Input: a JSON file shaped like:
  {
    "lesson_plans":     {"D1": "pass", "D2": "pass", "D3": "fail", "D4": "na", ...},
    "digital_coach":    {"D1": "pass", ...},
    ...
  }
Any standard omitted for a product is treated as "unknown" and excluded from
that product's denominator (it does not count against them, but it also isn't
claimed as passing).

Usage:
    python3 scorecard.py verdicts.json --tier non_negotiable -o scorecard.png
    python3 scorecard.py verdicts.json -o scorecard.png          # all tiers, weighted

Renders with the house-style engine (skills/notion-board/reference/economist_chart.py)
per the house-style-charts skill — never hand-roll a differently-styled chart.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Missing dependency: pyyaml. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parents[2]  # skills/data-standards/scripts -> skills -> repo root... adjusted below
SKILL_DIR = Path(__file__).resolve().parent.parent
REFERENCE = SKILL_DIR / "reference" / "standards.yaml"
CHART_ENGINE_DIR = SKILL_DIR.parent / "notion-board" / "reference"

sys.path.insert(0, str(CHART_ENGINE_DIR))

PRODUCT_LABELS = {
    "lesson_plans": "Lesson Plans",
    "digital_coach": "Digital Coach",
    "teacher_training": "Teacher Training",
    "exam_generator": "Exam Generator",
    "user_mgmt": "User Mgmt",
    "data_analytics": "Data & Analytics",
}


def load_standards() -> dict:
    return yaml.safe_load(REFERENCE.read_text(encoding="utf-8"))


def compliance_pct(verdicts: dict, standard_ids: list[str]) -> tuple[float, int, int]:
    """Return (pct, passed, counted). 'na' verdicts and omitted IDs are excluded
    from the denominator — a product that legitimately doesn't need a standard
    (per standards.yaml `applies: false`) should never be penalised for it."""
    counted = passed = 0
    for sid in standard_ids:
        v = verdicts.get(sid)
        if v in ("pass", "fail"):
            counted += 1
            if v == "pass":
                passed += 1
        # v is None (not scored) or "na" -> excluded entirely
    pct = (passed / counted * 100) if counted else 0.0
    return pct, passed, counted


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("verdicts", help="JSON file: {product: {standard_id: 'pass'|'fail'|'na'}}")
    ap.add_argument("--tier", choices=["non_negotiable", "essential", "advanced", "specialized"],
                     help="restrict to one tier; default = all standards that apply")
    ap.add_argument("-o", "--out", default="scorecard.png", help="output PNG path")
    ap.add_argument("--title", default=None, help="override the chart title")
    args = ap.parse_args()

    data = load_standards()
    standards = data["standards"]
    if args.tier:
        standards = [s for s in standards if s["tier"] == args.tier]

    verdicts_path = Path(args.verdicts)
    if not verdicts_path.exists():
        print(f"Not found: {verdicts_path}", file=sys.stderr)
        return 1
    all_verdicts = json.loads(verdicts_path.read_text(encoding="utf-8"))

    labels, values, footnotes = [], [], []
    for product in data["products"]:
        applicable_ids = [
            s["id"] for s in standards
            if (s.get("products", {}).get(product) or {}).get("applies", True)
        ]
        product_verdicts = all_verdicts.get(product, {})
        pct, passed, counted = compliance_pct(product_verdicts, applicable_ids)
        labels.append(PRODUCT_LABELS[product])
        values.append(round(pct, 1))
        footnotes.append(f"{passed}/{counted}")

    tier_label = data["tiers"][args.tier]["label"] if args.tier else "All standards"
    title = args.title or f"Data standards compliance — {tier_label}"
    subtitle = "  ·  ".join(f"{l}: {f}" for l, f in zip(labels, footnotes))

    try:
        from economist_chart import bar_h, save_chart
    except ImportError as e:
        print(f"Couldn't import the house chart engine from {CHART_ENGINE_DIR}: {e}", file=sys.stderr)
        print("Make sure skills/notion-board/reference/economist_chart.py exists.", file=sys.stderr)
        return 1

    fig = bar_h(
        title=title,
        subtitle=f"% of applicable standards passing, by product ({subtitle})",
        labels=labels,
        values=values,
        source="Source: skills/data-standards — verdicts supplied by the caller, not auto-detected.",
    )
    path = save_chart(fig, args.out)
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
