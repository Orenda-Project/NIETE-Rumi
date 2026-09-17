#!/usr/bin/env python3
"""Feature execution order for the NIETE E2E suite (`/niete-e2e`).

SINGLE SOURCE OF TRUTH for the order features run in = the `order:` value in each
`.claude/qa/agents/niete-<feature>-agent.md` frontmatter. This script reads every
agent's frontmatter, sorts ascending by `order:`, and prints the run sequence.

The `/niete-e2e` runner (both the empty/SAFE run and `all`) MUST obtain the feature
order by calling this script — never a hardcoded list anywhere else. Scenario order
WITHIN a feature is unchanged: authored top-to-bottom `.feature` order (see
parse-gherkin.py); this script only orders the FEATURES.

Usage:
  python3 .claude/qa/shared/feature-order.py           # human-readable ordered list
  python3 .claude/qa/shared/feature-order.py --json     # machine-readable array

Exit non-zero if two agents share an `order:` value (a divergence guard).
"""
import sys, os, glob, json, re

AGENTS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "agents"))


def parse_frontmatter(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.lstrip().startswith("#"):
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm


def collect():
    rows = []
    for path in sorted(glob.glob(os.path.join(AGENTS_DIR, "niete-*-agent.md"))):
        fm = parse_frontmatter(path)
        if "order" not in fm:
            print(f"WARN: no `order:` in {os.path.basename(path)} — excluded from run order",
                  file=sys.stderr)
            continue
        try:
            order = int(fm["order"])
        except ValueError:
            print(f"WARN: non-int `order:` in {os.path.basename(path)}: {fm['order']!r}",
                  file=sys.stderr)
            continue
        spec = fm.get("feature", "")
        slug = os.path.basename(spec)[:-len(".feature")] if spec.endswith(".feature") \
            else os.path.basename(path)
        rows.append({
            "order": order,
            "feature": slug,
            "spec": spec,
            "agent": fm.get("name", os.path.basename(path)[:-3]),
        })
    rows.sort(key=lambda r: r["order"])
    return rows


def main():
    rows = collect()

    # Divergence guard: no two agents may claim the same order value.
    by_order = {}
    for r in rows:
        by_order.setdefault(r["order"], []).append(r["feature"])
    dups = {o: fs for o, fs in by_order.items() if len(fs) > 1}
    if dups:
        print(f"ERROR: duplicate `order:` values in agent frontmatter: {dups}", file=sys.stderr)
        sys.exit(2)

    if "--json" in sys.argv:
        print(json.dumps(rows, indent=2))
        return

    print("NIETE E2E feature execution order (source of truth: agent `order:` frontmatter)")
    for r in rows:
        print(f"  {r['order']}. {r['feature']:<13} agent={r['agent']:<26} spec={r['spec']}")


if __name__ == "__main__":
    main()
