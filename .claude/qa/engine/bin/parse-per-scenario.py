#!/usr/bin/env python3
"""Turn a run's PER-SCENARIO.md into canonical scenarios.json.

The markdown is written by hand during a run and its tables come in two shapes
(some features log a `waited` column, some don't), so the header row is read
per-table rather than assumed. Emitting JSON here keeps the artifact builder
free of markdown parsing.
"""
import json, re, sys, os

VERDICTS = [
    ("promoted",  r"PASS\s*→\s*PROMOTE"),
    ("fail",      r"\bFAIL\b"),
    ("blocked",   r"\bBLOCKED\b"),
    ("skip",      r"\bSKIP\b"),
    ("notdriven", r"NOT DRIVEN"),
    ("deferred",  r"\bDEFERRED\b"),
    ("changed",   r"NO LONGER REPRODUCES|ISSUE REPRODUCES"),
    ("partial",   r"\bPARTIAL\b"),
    ("pass",      r"\bPASS\b"),
]

def classify(v):
    # A verdict that OPENS with PASS is a pass even when its note also mentions a
    # known issue reproducing (e.g. LP10 "PASS (issue reproduces, partly)") — the
    # leading token is the verdict, the parenthetical is commentary.
    head = re.sub(r"[*_`]", "", v).strip()
    if re.match(r"^PASS\b", head, re.I):
        return "promoted" if re.search(r"→\s*PROMOTE", head, re.I) else "pass"
    for name, pat in VERDICTS:
        if re.search(pat, v, re.I):
            return name
    return "other"

def parse(path):
    feature, cols, out = None, None, []
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        m = re.match(r"^##\s*\d+\.\s*([a-z\-]+)\s*\((\d+)\)", line.strip())
        if m:
            feature, cols = m.group(1), None
            continue
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        low = [c.lower() for c in cells]
        if "id" in low and "verdict" in low:
            cols = low
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if not cols or not feature:
            continue
        row = dict(zip(cols, cells))
        sid = row.get("id", "")
        # feature-runner ids: R01 · M12 · L03 · T09-ladder · COA04 · LANG12 · STA-surface · R13-pre · COA-pipeline
        if not re.match(r"^[A-Z]{1,4}[0-9A-Za-z\-]{0,14}$", sid) or sid.upper() in ("RUNNER", "RESET"):
            continue
        verdict = row.get("verdict", "")
        out.append({
            "feature": feature,
            "id": sid,
            "name": row.get("scenario", ""),
            "tags": row.get("tags", ""),
            "verdict_raw": verdict,
            "verdict": classify(verdict),
            "waited": row.get("waited", "") or "",
            "evidence": row.get("evidence", ""),
        })
    return out

if __name__ == "__main__":
    run_dir = sys.argv[1]
    rows = parse(os.path.join(run_dir, "PER-SCENARIO.md"))
    with open(os.path.join(run_dir, "scenarios.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    from collections import Counter
    print("parsed %d scenarios" % len(rows))
    print(" by feature:", dict(Counter(r["feature"] for r in rows)))
    print(" by verdict:", dict(Counter(r["verdict"] for r in rows)))
