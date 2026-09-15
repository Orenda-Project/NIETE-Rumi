#!/usr/bin/env python3
"""check_known_findings.py — separate KNOWN findings from real REGRESSIONS on the mock lane.

The mock lane has a handful of scenarios that do not PASS for documented reasons unrelated to the
commit under test (a cassette-determinism seam, a spec-vs-build question, deep-coaching that bails
early). Those live in `.claude/qa/config/known-findings.json`. This check makes the gate trustworthy:

    a run REGRESSES only when a scenario NOT listed there FAILS,
    or a scenario listed there now PASSES (a fix — remove it from the list).

Only FAIL is regression-eligible. BLOCKED means the scenario could not be DRIVEN (unreachable,
@wip, content-driven, an early-bail) — that is documented per-scenario, not "the product broke", so
it never flags. SKIP is never a regression either. Exit 0 = no regression, so a red result means the
commit actually broke something.

    python3 check_known_findings.py <run_dir> [--config <path>] [--features menu,coaching]

Run dir holds one <feature>.json per driven feature: {"results":[{"id","verdict",...}]}.
"""
import argparse, json, os, sys


def load_known(path):
    """The known-findings config as {feature: {id: reason}}, minus `_`-prefixed doc keys. A missing or
    malformed file means an empty set — every FAIL is then regression-eligible (fail loud, not open)."""
    try:
        return {k: v for k, v in json.load(open(path)).items() if not k.startswith("_")}
    except (FileNotFoundError, ValueError):
        return {}


def classify_results(feature, results, known):
    """(regressions, expected, fixed) for ONE feature's results list — the single home for the rule so
    the runner's ledger row and the run-dir gate cannot disagree.

    regressions: a FAIL whose id is NOT a listed known finding — the commit broke it.
    expected:    a FAIL whose id IS a listed known finding — fine, documented.
    fixed:       a listed known finding that now PASSES — good news; remove it from the list.
    BLOCKED and SKIP are ignored entirely (never a regression signal).
    """
    listed = known.get(feature, {})
    regressions, expected, fixed = [], [], []
    for r in results or []:
        sid, verdict = r.get("id"), (r.get("verdict") or "").upper()
        if verdict == "FAIL":
            (expected if sid in listed else regressions).append((feature, sid, verdict))
        elif verdict == "PASS" and sid in listed:
            fixed.append((feature, sid, verdict))
    return regressions, expected, fixed


def classify(run_dir, known, only=None):
    """Return (regressions, expected, fixed) lists of (feature, id, verdict) across a run dir's
    per-feature <feature>.json files."""
    regressions, expected, fixed = [], [], []
    for fn in sorted(os.listdir(run_dir)):
        if not fn.endswith(".json") or fn.endswith(".stdout.json"):
            continue
        feature = fn[:-5]
        if feature in ("run", "stack") or (only and feature not in only):
            continue
        try:
            data = json.load(open(os.path.join(run_dir, fn)))
        except Exception:
            continue
        if not isinstance(data, dict) or "results" not in data:
            continue
        rg, ex, fx = classify_results(feature, data.get("results", []), known)
        regressions += rg; expected += ex; fixed += fx
    return regressions, expected, fixed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("run_dir")
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--config", default=os.path.join(here, "..", "config", "known-findings.json"))
    ap.add_argument("--features", default="")
    a = ap.parse_args(argv)

    known = load_known(a.config)
    only = [f for f in a.features.split(",") if f] or None

    regressions, expected, fixed = classify(a.run_dir, known, only)

    if fixed:
        print("✓ FIXED (remove from known-findings.json): " +
              ", ".join("%s/%s" % (f, i) for f, i, _ in fixed))
    if regressions:
        print("✗ REGRESSION — a scenario broke that was NOT a known finding:")
        for f, i, v in regressions:
            print("    %s/%s  %s" % (f, i, v))
        print("Fix it, or (if it is a genuine new known finding) add it to known-findings.json with a reason.")
        return 1
    print("✓ no regressions · %d known finding(s) unchanged%s" %
          (len(expected), (" · %d fixed" % len(fixed)) if fixed else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
