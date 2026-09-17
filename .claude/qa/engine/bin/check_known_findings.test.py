#!/usr/bin/env python3
"""Tests for check_known_findings.classify — the mock-lane regression gate."""
import os, sys, json, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_known_findings as chk


def _run(tmp, feature, results):
    json.dump({"feature": feature, "results": results}, open(os.path.join(tmp, feature + ".json"), "w"))


def main():
    fails = 0
    def ok(cond, msg):
        nonlocal fails
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            fails = 1

    with tempfile.TemporaryDirectory() as tmp:
        # menu: M01 PASS, M09 FAIL (known), M05 FAIL (NOT known → regression)
        _run(tmp, "menu", [
            {"id": "M01", "verdict": "PASS"},
            {"id": "M09", "verdict": "FAIL"},
            {"id": "M05", "verdict": "FAIL"},
        ])
        # coaching: COA04 BLOCKED (listed), COA99 BLOCKED (NOT listed), COA-pipeline SKIP
        _run(tmp, "coaching", [
            {"id": "COA04", "verdict": "BLOCKED"},
            {"id": "COA99", "verdict": "BLOCKED"},
            {"id": "COA-pipeline", "verdict": "SKIP"},
        ])
        # a listed finding that now PASSES → fixed, not a regression
        _run(tmp, "language", [{"id": "LANG07", "verdict": "PASS"}])
        # noise files that must be ignored
        json.dump({"x": 1}, open(os.path.join(tmp, "run.json"), "w"))
        open(os.path.join(tmp, "menu.stdout.json"), "w").write("[]")

        known = {"menu": {"M09": "why"}, "coaching": {"COA04": "why"}, "language": {"LANG07": "why"}}
        reg, exp, fixed = chk.classify(tmp, known)

        ok(("menu", "M05", "FAIL") in reg, "M05 (FAIL, not listed) is a REGRESSION")
        ok(("menu", "M09", "FAIL") not in reg, "M09 (FAIL, listed) is NOT a regression")
        ok(("menu", "M09", "FAIL") in exp, "M09 counts as an expected known finding")
        ok(not any(i == "COA04" for _, i, _ in reg + exp), "BLOCKED (listed) is ignored — never flags")
        ok(not any(i == "COA99" for _, i, _ in reg), "BLOCKED (not listed) is NOT a regression")
        ok(not any(i == "COA-pipeline" for _, i, _ in reg), "SKIP is never a regression")
        ok(("language", "LANG07", "PASS") in fixed, "a listed finding that now PASSES is reported as FIXED")
        ok(len(reg) == 1, "exactly one regression detected (M05)")

    print("PASS check_known_findings" if not fails else "FAILED check_known_findings")
    sys.exit(fails)


if __name__ == "__main__":
    main()
