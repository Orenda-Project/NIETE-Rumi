#!/usr/bin/env python3
"""check-scenario-coverage.py — does every Gherkin scenario have executable driver code, and vice versa?

WHY THIS EXISTS (bd-bufzl). Writing a scenario does not make it run. `feature-runner.cjs` loads
`.claude/qa/shared/features/<feature>.cjs` and collects whatever its `rec()` calls report; it never
opens the `.feature` file. Nothing anywhere holds both numbers at once, so a PR can add prose,
satisfy the spec-freshness check in qa-impact.yml, go green, and ship a test that executes nothing.
Measured on 2026-09-22: coaching had 33 @e2e scenarios and 15 implemented, with no signal anywhere.

BOTH DIRECTIONS, because both drift:
  E-NODRIVER    a spec scenario whose id no driver records — the gap this was written for
  E-NOSCENARIO  a driver id with no scenario — an id that outlived a deleted or renamed scenario

ENROLMENT IS IMPLICIT. A feature is checked once its spec carries id tags. An untagged spec reports
I-NOTENROLLED and cannot fail. Backfilling nine specs in one commit would make this red on arrival
everywhere, and a gate that is red on arrival is one somebody switches off by Friday —
validate_specs.py already reasons this way about unknown tags, and it is right.

THE ESCAPE HATCH. `@no-mock-driver` on a scenario excuses it, because some scenarios genuinely
cannot run on this lane: Flow screens are emulated rather than rendered, and COA14 needs a file
larger than WhatsApp's own upload ceiling. Excused is not the same as absent — it is declared,
listed on every run, and reviewable in the diff. Mirrors `Spec-Sync: <feature>=none-needed (<why>)`.

    python3 check-scenario-coverage.py [--root <repo>] [--only coaching,menu] [--json]

Exit 0 when nothing is missing (including "nothing is enrolled"); 1 on any E-.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

SPEC_DIR = os.path.join("tests", "features", "whatsapp", "niete")
DRIVER_DIR = os.path.join(".claude", "qa", "shared", "features")

# Mirrors SCENARIO_ID_RE in validate_specs.py and ID_TAG_RE in scaffold-driver.py: letters then digits.
ID_TAG_RE = re.compile(r"^[A-Za-z]{1,5}\d{1,3}$")
PRIORITY_TAGS = frozenset({"p0", "p1", "p2", "p3"})
# Any call whose FIRST argument is a scenario-id string literal. Not just `rec(` — coaching.cjs
# records 8 of its 17 scenarios through a `deepOnly(id, name, …)` wrapper, and a checker blind to
# wrappers reports all eight as missing on the day it lands. The id shape does the discriminating,
# so a future wrapper needs no change here.
# Uppercase prefix on purpose: getAttribute('aria-label') and ('data-id') match the same shape
# otherwise, and would surface as phantom scenarios the driver 'records'.
RECORDED_ID_RE = re.compile(r"\b[A-Za-z_$][\w$]*\(\s*'([A-Z]{1,5}(?:\d{1,3}|-[a-z]+))'")
NO_DRIVER_TAG = "no-mock-driver"


def _finding(code, feature, sid, msg):
    return {"code": code, "feature": feature, "id": sid, "msg": msg}


def spec_scenarios(path, prefix_hint=""):
    """[(id, name, excused)] for every @e2e scenario carrying an id tag."""
    out, tags = [], []
    for ln in open(path, encoding="utf-8").read().splitlines():
        t = ln.strip()
        if t.startswith("@"):
            tags = t.split()
        elif t.startswith("Scenario:") and "@e2e" in tags:
            bare = [x[1:] for x in tags]
            cands = [c for c in bare if ID_TAG_RE.match(c) and c.lower() not in PRIORITY_TAGS]
            sid = next((c for c in cands if c.lower().startswith(prefix_hint.lower())), None) \
                or next(iter(cands), None)
            if sid:
                out.append((sid, t[len("Scenario:"):].strip(), NO_DRIVER_TAG in bare))
            tags = []
        elif t and not t.startswith("#"):
            tags = []
    return out


def driver_ids(path):
    if not os.path.isfile(path):
        return set()
    return set(RECORDED_ID_RE.findall(open(path, encoding="utf-8").read()))


def check_feature(root, feature):
    spec = os.path.join(root, SPEC_DIR, feature + ".feature")
    driver = os.path.join(root, DRIVER_DIR, feature + ".cjs")
    if not os.path.isfile(spec):
        return [_finding("I-NOSPEC", feature, None, "no .feature file")]

    # The prefix to SUGGEST comes from the driver's own ids where there are any: menu's driver uses
    # M09, not MEN09, so guessing from the feature name would hand someone the wrong instruction.
    existing = driver_ids(driver)
    px = next((re.match(r"^([A-Za-z]{1,5})\d", i).group(1) for i in sorted(existing)
               if re.match(r"^([A-Za-z]{1,5})\d", i)), feature[:3].upper())

    scen = spec_scenarios(spec, px)
    if not scen:
        return [_finding("I-NOTENROLLED", feature, None,
                         "no scenario carries an id tag — not enrolled in the coverage gate. "
                         "Tag them (@%s01 …, matching the ids the driver already records) to enrol "
                         "this feature." % px.upper())]

    have, out = existing, []
    if not os.path.isfile(driver):
        return [_finding("E-NODRIVERFILE", feature, None,
                         "%d tagged scenario(s) but no driver at %s. Create one: "
                         "python3 .claude/qa/shared/scaffold-driver.py %s"
                         % (len(scen), os.path.relpath(driver, root), feature))]

    for sid, name, excused in scen:
        if sid in have:
            continue
        if excused:
            out.append(_finding("I-EXCUSED", feature, sid,
                                "@%s: %r is declared unrunnable on this lane" % (NO_DRIVER_TAG, name)))
        else:
            out.append(_finding("E-NODRIVER", feature, sid,
                                "%r has no driver — it can never pass, fail or block, so it is "
                                "absent from every run. Append a stub: "
                                "python3 .claude/qa/shared/scaffold-driver.py %s --sync"
                                % (name, feature)))

    spec_ids = {sid for sid, _, _ in scen}
    for sid in sorted(have - spec_ids):
        # Harness-level ids (COA-preflight) are not scenarios and carry a dash.
        if "-" in sid:
            continue
        out.append(_finding("E-NOSCENARIO", feature, sid,
                            "the driver records %s but no @e2e scenario carries that id — it "
                            "outlived a deleted or renamed scenario" % sid))
    return out


def features(root, only=None):
    d = os.path.join(root, SPEC_DIR)
    names = sorted(f[:-len(".feature")] for f in os.listdir(d) if f.endswith(".feature")) \
        if os.path.isdir(d) else []
    return [n for n in names if not only or n in only]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--only", default="", help="comma-separated feature names")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    only = {x.strip() for x in a.only.split(",") if x.strip()}
    found = []
    for f in features(a.root, only):
        found.extend(check_feature(a.root, f))

    if a.json:
        print(json.dumps(found, indent=1))
    else:
        for f in sorted(found, key=lambda x: (not x["code"].startswith("E-"), x["feature"], x["id"] or "")):
            print("  %-15s %-12s %s" % (f["code"], f["feature"], f["msg"]))
        errs = [f for f in found if f["code"].startswith("E-")]
        print("\n%d problem(s)%s" % (len(errs), "" if errs else " — every enrolled scenario has driver code"))
    return 1 if any(f["code"].startswith("E-") for f in found) else 0


if __name__ == "__main__":
    sys.exit(main())
