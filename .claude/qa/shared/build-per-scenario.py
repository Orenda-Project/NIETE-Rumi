#!/usr/bin/env python3
"""Build PER-SCENARIO.md from the per-feature JSONs feature-runner.cjs writes (2026-09-02).

One `## <n>. <feature> (<count>)` section per feature in feature-order, one table row per result —
the shape parse-per-scenario.py / build-run-artifact.py already consume. <count> is the live @e2e
count from the .feature file (parse-gherkin), NOT the number of JSON rows; when the driver has no
row for a spec scenario the gap is called out under the table so it cannot pass as coverage.

  python3 build-per-scenario.py <run-dir>
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SPECS = os.path.join(REPO, "tests", "features", "whatsapp", "niete")


def order():
    out = subprocess.run([sys.executable, os.path.join(HERE, "feature-order.py")], capture_output=True, text=True).stdout
    return [l.split()[1] for l in out.splitlines() if l.split() and l.split()[0].rstrip(".").isdigit()]


def spec_count(feature):
    p = os.path.join(SPECS, feature + ".feature")
    if not os.path.exists(p): return None
    out = subprocess.run([sys.executable, os.path.join(HERE, "parse-gherkin.py"), p, "--tag", "@e2e"], capture_output=True, text=True).stdout
    try: return json.loads(out)["count"]
    except Exception: return None


def main():
    run_dir = sys.argv[1]
    lines = ["# Per-scenario log — %s" % os.path.basename(run_dir.rstrip("/")),
             "", "Built from `<feature>.json` by build-per-scenario.py. Verdicts are the runner's; a harness "
             "fault is `ERROR`/`BLOCKED` with its reason, never a product FAIL.", ""]
    n = 0
    for f in order():
        jp = os.path.join(run_dir, f + ".json")
        if not os.path.exists(jp): continue
        d = json.load(open(jp, encoding="utf-8"))
        n += 1
        cnt = spec_count(f)
        lines.append("## %d. %s (%s)" % (n, f, cnt if cnt is not None else len(d["results"])))
        lines.append("_%s PASS · %s FAIL · %s other · %s min · %ss/scenario_" % (d["pass"], d["fail"], d["other"], d["wallMin"], d["perScenarioSec"]))
        lines.append("")
        lines.append("| id | scenario | tags | verdict | waited | evidence |")
        lines.append("|----|----------|------|---------|--------|----------|")
        for r in d["results"]:
            ev = r.get("evidence")
            if isinstance(ev, dict):
                ev = "; ".join("%s=%s" % (k, json.dumps(v, ensure_ascii=False)) for k, v in ev.items() if v not in (None, "", [], {}))
            ev = str(ev or "").replace("|", "/").replace("\n", " ")[:220]
            waited = ""
            if isinstance(r.get("evidence"), dict):
                w = r["evidence"].get("botWaitMs") or r["evidence"].get("waitedMs")
                waited = "%sms" % w if w else ""
            lines.append("| %s | %s | | %s | %s | %s |" % (r["id"], (r.get("name") or "").replace("|", "/"), r["verdict"], waited, ev))
        if cnt is not None and len([r for r in d["results"] if not r["id"].startswith(("RUNNER", "COA-", "LANG-", "STA-", "T-", "T09-", "R13-", "RESET"))]) < cnt:
            lines.append("")
            lines.append("> ⚠️ driver rows < spec `@e2e` count (%d): spec scenarios without a row are NOT DRIVEN, not passed." % cnt)
        lines.append("")
    out = os.path.join(run_dir, "PER-SCENARIO.md")
    open(out, "w", encoding="utf-8").write("\n".join(lines))
    print("wrote %s (%d features)" % (out, n))


if __name__ == "__main__":
    main()
