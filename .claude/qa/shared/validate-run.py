#!/usr/bin/env python3
"""Gate a NIETE E2E run directory before it is reported or published.

The artifact pipeline reads PER-SCENARIO.md. If a runner writes that file in a
slightly different shape the parser yields FEWER rows and the published page
quietly under-reports — a silent failure, and the worst kind for a QA surface.
This turns that into a loud one.

Checks, in order of how badly they bite:
  1. every feature logged as many scenarios as its .feature file actually has
     (cross-checked live against parse-gherkin, never a hardcoded number)
  2. no duplicate scenario ids inside a feature
  3. every verdict classifies to a known bucket
  4. run.json carries the fields the artifact masthead prints
  5. findings.json (if present) has the right shape

Usage: validate-run.py <run_dir> [--features registration,menu,...]
Exit 0 clean, 1 on any failure.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALL_MODE = ["registration","menu","training","lesson-plan","coaching","language","status"]

def spec_count(feature):
    spec = os.path.join(REPO, "tests/features/whatsapp/niete/%s.feature" % feature)
    out = subprocess.run([sys.executable, os.path.join(HERE, "parse-gherkin.py"), spec, "--tag", "@e2e"],
                         capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)["count"]

def main():
    run_dir = sys.argv[1]
    feats = ALL_MODE
    if "--features" in sys.argv:
        feats = sys.argv[sys.argv.index("--features")+1].split(",")

    sys.path.insert(0, HERE)
    from importlib import import_module
    parser = import_module("parse-per-scenario".replace("-", "_")) if False else None
    # parse-per-scenario.py has a dash in its name; exec it directly
    ns = {}
    exec(open(os.path.join(HERE, "parse-per-scenario.py"), encoding="utf-8").read()
         .replace('if __name__ == "__main__":', 'if False:'), ns)
    # A run that stopped early — QR screen, crash, parked mid-flight — never writes
    # PER-SCENARIO.md, and that is 66 of the 72 run dirs on disk. This used to raise a raw
    # FileNotFoundError, which tells the reader the TOOL broke rather than that the RUN
    # produced nothing. SCHEDULE.md guard 3 exists for exactly this class of failure.
    ps = os.path.join(run_dir, "PER-SCENARIO.md")
    if not os.path.isfile(ps):
        print("NOT VALIDATED — %s has no PER-SCENARIO.md.\n"
              "The run produced no per-scenario log, so there is nothing to check. That means\n"
              "it stopped before reporting (QR screen, crash, or parked mid-flight); it does NOT\n"
              "mean the run was clean. See the scheduler log or REPORT.md in that directory."
              % run_dir)
        return 1
    if os.path.getsize(ps) == 0:
        print("NOT VALIDATED — %s is empty." % ps)
        return 1
    rows = ns["parse"](ps)
    if not rows:
        print("NOT VALIDATED — %s parsed to zero scenario rows.\n"
              "Either the run logged nothing, or the table shape drifted from what\n"
              "parse-per-scenario.py expects. Both are silent under-reporting." % ps)
        return 1

    fails, warns = [], []

    # 1 — coverage per feature, against the live spec
    by = {}
    for r in rows: by.setdefault(r["feature"], []).append(r)
    print("coverage")
    for f in feats:
        want = spec_count(f)
        got = len(by.get(f, []))
        if want is None:
            warns.append("could not read the spec for %s" % f); mark = "??"
        elif got == want: mark = "ok"
        else:
            fails.append("%s: logged %d scenarios but the .feature file has %d @e2e" % (f, got, want)); mark = "FAIL"
        print("  %-13s logged %3s / spec %-3s  %s" % (f, got, want if want is not None else "?", mark))

    extra = set(by) - set(feats)
    if extra: warns.append("rows logged for features outside the requested set: %s" % sorted(extra))

    # 2 — duplicate ids
    for f, rs in by.items():
        seen = {}
        for r in rs: seen.setdefault(r["id"], 0); seen[r["id"]] += 1
        dupes = [k for k, v in seen.items() if v > 1]
        if dupes: fails.append("%s: duplicate scenario ids %s" % (f, dupes))

    # 3 — unclassified verdicts
    unknown = [(r["feature"], r["id"], r["verdict_raw"]) for r in rows if r["verdict"] == "other"]
    for f, i, v in unknown:
        fails.append("%s/%s: verdict %r does not classify — use PASS/FAIL/BLOCKED/SKIP/PARTIAL/DEFERRED/NOT DRIVEN" % (f, i, v[:40]))

    # 4 — run.json
    rj = os.path.join(run_dir, "run.json")
    if not os.path.exists(rj):
        fails.append("run.json missing — the artifact masthead needs it")
    else:
        meta = json.load(open(rj, encoding="utf-8"))
        for k in ("run","target","driver","env"):
            if not meta.get(k): fails.append("run.json is missing %r" % k)

    # 5 — findings.json shape
    fj = os.path.join(run_dir, "findings.json")
    if not os.path.exists(fj):
        warns.append("no findings.json — the artifact will publish with empty finding sections")
    else:
        F = json.load(open(fj, encoding="utf-8"))
        for key in ("critical","new","fixed","unverified"):
            for i, item in enumerate(F.get(key, [])):
                if not item.get("title") or not item.get("body"):
                    fails.append("findings.json %s[%d] needs both title and body" % (key, i))
        if not isinstance(F.get("harness", []), list):
            fails.append("findings.json harness must be a list of strings")

    # 6 — efficiency. Deliberately WARNINGS, not failures (bd-44102): a run that found
    #     real bugs must still publish even if it was slow. run_efficiency.py exits 1 on
    #     its own, so cost stays visible without letting a cost problem suppress a
    #     correctness result. Run it from preflight.py --finish, or directly.
    try:
        import run_efficiency as eff
        rec = eff.load_run(run_dir)
        if not rec.get("scenarios"):
            rec["scenarios"] = len(rows)          # PER-SCENARIO.md is the better count here
        ev, ew = eff.evaluate(rec)
        print()
        print(eff.render(rec, ev, ew, fail_label="cost", warn_label="cost"))
        warns.extend("efficiency: %s" % x for x in ev + ew)
    except Exception as e:                        # never let the cost gate break the shape gate
        warns.append("efficiency check did not run: %s" % e)

    print()
    for w in warns: print("  warn  %s" % w)
    for f in fails: print("  FAIL  %s" % f)
    print()
    if fails:
        print("%d problem(s) — fix before reporting or publishing." % len(fails)); return 1
    print("run %s is complete and consistent (%d scenarios)." % (os.path.basename(run_dir.rstrip('/')), len(rows)))
    return 0

if __name__ == "__main__":
    sys.exit(main())
