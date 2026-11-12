#!/usr/bin/env python3
"""check-scenario-coverage.py — does every Gherkin scenario have executable driver code, and vice versa?

WHY THIS EXISTS (bd-bufzl). Writing a scenario does not make it run. `feature-runner.cjs` loads
`<drivers_dir>/<feature>.cjs` and collects whatever its `rec()` calls report; it never
opens the `.feature` file. Nothing anywhere holds both numbers at once, so a PR can add prose,
satisfy the spec-freshness check in qa-impact.yml, go green, and ship a test that executes nothing.
Measured on 2026-09-22: coaching had 33 @e2e scenarios and 15 implemented, with no signal anywhere.

BOTH DIRECTIONS, because both drift:
  E-NODRIVER    a spec scenario whose id no driver records — the gap this was written for
  E-NOSCENARIO  a driver id with no scenario — an id that outlived a deleted or renamed scenario
  E-DUPID       two scenarios carrying one id — the driver records one result for the id, so the
                other scenario vanishes from every run (bd-7g913e: @COA72 and @COA84, twice each)

ENROLMENT IS IMPLICIT. A feature is checked once its spec carries id tags. An untagged spec reports
I-NOTENROLLED and cannot fail. Backfilling nine specs in one commit would make this red on arrival
everywhere, and a gate that is red on arrival is one somebody switches off by Friday —
validate_specs.py already reasons this way about unknown tags, and it is right.

THE ESCAPE HATCH. `@no-mock-driver` on a scenario excuses it, because some scenarios genuinely
cannot run on this lane: Flow screens are emulated rather than rendered, and COA14 needs a file
larger than WhatsApp's own upload ceiling. Excused is not the same as absent — it is declared,
listed on every run, and reviewable in the diff. Mirrors `Spec-Sync: <feature>=none-needed (<why>)`.

    python3 check-scenario-coverage.py [--root <repo>] [--only coaching,menu] [--json] [--base <rev> [--head <rev>]]

Exit 0 when nothing is missing (including "nothing is enrolled"); 1 on any E-.

THE RATCHET (--base, bd-jbj2w9). commit-e2e.sh and pre-push run this on every commit and every push, where a
whole-repo verdict is the wrong question: NIETE sandbox carried 23 gaps on 2026-11-11 (child-test, registration)
that nobody making a menu change can fix, and a gate that holds every run on them gets switched off. With --base
only a finding the change ADDS (code, feature, id not present at <rev>) is an error; one already there is printed
as `known` and does not fail. --head <rev> judges that commit (what a push sends); without it the working tree
(what a run drives).
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tenants_lite as _tl  # noqa: E402


def _dirs(root):
    """(spec_dir, driver_dir) of the repo at `root`, from its tenants.yaml (bd-9157r.3). No manifest → no spec dir,
    so there is nothing to check (never a guessed path)."""
    try:
        m = _tl.load(root)
        return m.spec_dir, m.drivers_dir
    except _tl.ManifestError:
        return None, os.path.join(".claude", "qa", "shared", "features")


def _default_root():
    try:
        return _tl.repo_root()
    except _tl.ManifestError:
        return os.getcwd()

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


def _reader(root, rev=None):
    """read(relpath) -> text, or None when the file is not there: the working tree, or the tree of <rev>."""
    if not rev:
        def read(rel):
            p = os.path.join(root, rel)
            if not os.path.isfile(p):
                return None
            try:
                return open(p, encoding="utf-8").read()
            except OSError:
                return None
        return read

    def read_rev(rel):
        r = subprocess.run(["git", "-C", root, "show", "%s:./%s" % (rev, rel.replace(os.sep, "/"))],
                           capture_output=True)
        return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else None
    return read_rev


def spec_scenarios(path, prefix_hint=""):
    """[(id, name, excused)] for every @e2e scenario carrying an id tag."""
    return _spec_scenarios_text(open(path, encoding="utf-8").read(), prefix_hint)


def _spec_scenarios_text(text, prefix_hint=""):
    out, tags = [], []
    for ln in text.splitlines():
        t = ln.strip()
        if t.startswith("@"):
            tags = t.split()
        elif (t.startswith("Scenario:") or t.startswith("Scenario Outline:")) and "@e2e" in tags:
            bare = [x[1:] for x in tags]
            cands = [c for c in bare if ID_TAG_RE.match(c) and c.lower() not in PRIORITY_TAGS]
            sid = next((c for c in cands if c.lower().startswith(prefix_hint.lower())), None) \
                or next(iter(cands), None)
            if sid:
                out.append((sid, t.split(":", 1)[1].strip(), NO_DRIVER_TAG in bare))
            tags = []
        elif t and not t.startswith("#"):
            tags = []
    return out


def driver_ids(path):
    if not os.path.isfile(path):
        return set()
    return set(RECORDED_ID_RE.findall(open(path, encoding="utf-8").read()))


def check_feature(root, feature, read=None):
    """Findings for one feature. `read` (from _reader) picks the tree: the working tree by default."""
    read = read or _reader(root)
    spec_dir, driver_dir = _dirs(root)
    spec_rel = os.path.join(spec_dir, feature + ".feature")
    driver_rel = os.path.join(driver_dir, feature + ".cjs")
    driver = os.path.join(root, driver_rel)
    spec_text = read(spec_rel)
    if spec_text is None:
        return [_finding("I-NOSPEC", feature, None, "no .feature file")]
    driver_text = read(driver_rel)

    # The prefix to SUGGEST comes from the driver's own ids where there are any: menu's driver uses
    # M09, not MEN09, so guessing from the feature name would hand someone the wrong instruction.
    existing = set(RECORDED_ID_RE.findall(driver_text)) if driver_text is not None else set()
    px = next((re.match(r"^([A-Za-z]{1,5})\d", i).group(1) for i in sorted(existing)
               if re.match(r"^([A-Za-z]{1,5})\d", i)), feature[:3].upper())

    scen = _spec_scenarios_text(spec_text, px)
    if not scen:
        return [_finding("I-NOTENROLLED", feature, None,
                         "no scenario carries an id tag — not enrolled in the coverage gate. "
                         "Tag them (@%s01 …, matching the ids the driver already records) to enrol "
                         "this feature." % px.upper())]

    have, out = existing, []
    by_id = {}
    for sid, name, _ in scen:
        by_id.setdefault(sid, []).append(name)
    for sid, names in sorted(by_id.items()):
        if len(names) > 1:
            out.append(_finding("E-DUPID", feature, sid,
                                "%d scenarios carry @%s (%s) — a run records one result for the id, "
                                "so the others are absent. Give each its own unused id."
                                % (len(names), sid, "; ".join(repr(n) for n in names))))
    if driver_text is None:
        return [_finding("E-NODRIVERFILE", feature, None,
                         "%d tagged scenario(s) but no driver at %s. Create one: "
                         "python3 .claude/qa/engine/bin/scaffold-driver.py %s"
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
                                "python3 .claude/qa/engine/bin/scaffold-driver.py %s --sync"
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


def features(root, only=None, rev=None):
    spec_dir, _ = _dirs(root)
    if not spec_dir:
        return []
    if rev:
        r = subprocess.run(["git", "-C", root, "ls-tree", "--name-only", rev, "./" + spec_dir.replace(os.sep, "/") + "/"],
                           capture_output=True, text=True)
        files = [os.path.basename(x) for x in r.stdout.split()] if r.returncode == 0 else []
    else:
        d = os.path.join(root, spec_dir)
        files = os.listdir(d) if os.path.isdir(d) else []
    names = sorted(f[:-len(".feature")] for f in files if f.endswith(".feature"))
    return [n for n in names if not only or n in only]


def _key(f):
    return (f["code"], f["feature"], f["id"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=None, help="repo root (default: the guarded repo this runs in)")
    ap.add_argument("--only", default="", help="comma-separated feature names")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--base", default=None,
                    help="only a finding not already present at this rev fails (the ratchet); the rest print as known")
    ap.add_argument("--head", default=None, help="judge this rev's tree instead of the working tree (needs --base)")
    a = ap.parse_args(argv)
    if a.head and not a.base:
        ap.error("--head needs --base")

    only = {x.strip() for x in a.only.split(",") if x.strip()}
    found = []
    a.root = a.root or _default_root()
    head_read = _reader(a.root, a.head)
    for f in features(a.root, only, a.head):
        found.extend(check_feature(a.root, f, head_read))
    if a.base:
        base_read = _reader(a.root, a.base)
        names = sorted({f["feature"] for f in found})
        known = {_key(f) for n in names for f in check_feature(a.root, n, base_read) if f["code"].startswith("E-")}
        for f in found:
            if f["code"].startswith("E-") and _key(f) in known:
                f["known"] = True

    def new_err(f):
        return f["code"].startswith("E-") and not f.get("known")

    if a.json:
        print(json.dumps(found, indent=1))
    else:
        for f in sorted(found, key=lambda x: (not new_err(x), not x["code"].startswith("E-"), x["feature"], x["id"] or "")):
            if f.get("known"):
                print("  known %-15s %-12s %s" % (f["code"], f["feature"], f["msg"]))
            else:
                print("  %-15s %-12s %s" % (f["code"], f["feature"], f["msg"]))
        errs = [f for f in found if new_err(f)]
        nk = sum(1 for f in found if f.get("known"))
        tail = " (%d known — already on %s, not this change's)" % (nk, a.base) if a.base and nk else ""
        print("\n%d problem(s)%s%s" % (len(errs), "" if errs or nk else " — every enrolled scenario has driver code", tail))
    return 1 if any(new_err(f) for f in found) else 0


if __name__ == "__main__":
    sys.exit(main())
