#!/usr/bin/env python3
"""select_scenarios — a commit's changed files → the SCENARIOS (by id) each selected feature must drive.

select_e2e.py answers "which features did this commit touch". This answers the next question:
"which scenarios inside those features". A commit that changes the coaching in-flight guard should
drive the scenarios about the in-flight guard, not all 70+ coaching scenarios.

    commit → select_e2e (features + the paths behind each) → select_scenarios → {feature: ids | all | none}

HOW A SCENARIO IS SELECTED, per feature, per changed path:
  1. the feature's own .feature file changed → the scenarios whose lines the diff touched
     (added or edited). A scenario that was only DELETED drives nothing — it no longer exists.
  2. an explicit `scenarios:` entry in feature-map.yaml matches the path → exactly those ids.
     This is the precise, hand-pinned mapping; it wins over name matching for that path.
  3. otherwise, the scenarios whose text NAMES the changed file. The specs already ground scenarios
     in code ("coaching-inflight-guard.js shouldDeferNewClassroomAudio (bd-2376)"), so a scenario
     that mentions `coaching-inflight-guard.js`, `coaching-inflight-guard` or
     `coaching-inflight-guard.service`-style stems is about that file.

NEVER UNDER-SELECT SILENTLY. A path that selected the feature but maps to NO scenario by any of the
three rules makes the whole feature run, and the output says which path forced it — the same rule
select_e2e applies to an unmapped file. Pin such a path in `scenarios:` to narrow it next time.

    select_scenarios.py --selection <json|-> --repo <dir> --range A...B [--json]
    select_scenarios.py --repo <dir> --range A...B [--json]          # runs select_e2e itself

OUTPUT (--json):
    {"features": {"coaching": {"scope": "subset", "ids": ["COA09", "COA20"],
                               "why": {"COA09": ["…coaching-inflight-guard.js names it"]},
                               "whole_feature_because": []},
                  "menu":     {"scope": "all", "ids": [], "why": {},
                               "whole_feature_because": ["bot/…/app-redirect.service.js: no menu scenario names it"]}},
     "only": "coaching=COA09,COA20"}
    `only` is what run-suite.sh --only takes: one `feature=ID,ID` per subset feature, `;`-joined.
    A feature whose scope is "all" is absent from `only` (no filter); scope "none" means nothing to drive.

Exit 0 always when it could decide; 3 when it could not (callers then run whole features, as before).
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import select_e2e  # noqa: E402

SPEC_DIR = "tests/features/whatsapp/niete"
ID_RE = re.compile(r"^@([A-Z]{1,5}\d{1,3})$")
PRIORITY_TAGS = frozenset({"P0", "P1", "P2", "P3"})   # @P1 is a priority, not an id (check-scenario-coverage agrees)
CANNOT_DECIDE = 3
# suffixes that make a file's "core" name: coaching-inflight-guard.service.js → coaching-inflight-guard
CORE_SUFFIXES = (".service", ".handler", ".worker", ".routes", ".route", ".config", ".template",
                 ".flow", ".rules", ".store", ".sweeper", ".processor", ".router", ".utils", ".util")
MIN_CORE = 8   # shorter cores ("audio", "menu") are words, not names — too broad to match on


def spec_scenarios(spec_text):
    """[{id, start, end, text, obsolete}] — 1-based inclusive line ranges, @e2e scenarios with an id tag.

    A scenario's block runs from its first tag line to the line before the next scenario's first tag
    line, so the comment lines under a scenario (where the code groundings live) belong to it."""
    lines = spec_text.split("\n")
    heads = []   # (first_tag_line_idx, scenario_line_idx, tags)
    pending = None
    for i, ln in enumerate(lines):
        t = ln.strip()
        if t.startswith("@"):
            if pending is None:
                pending = [i, []]
            pending[1].extend(t.split())
        elif t.startswith("Scenario:") or t.startswith("Scenario Outline:"):
            first = pending[0] if pending else i
            heads.append((first, i, pending[1] if pending else []))
            pending = None
        elif t and not t.startswith("#"):
            pending = None
    out = []
    for n, (first, _sc, tags) in enumerate(heads):
        end = heads[n + 1][0] - 1 if n + 1 < len(heads) else len(lines) - 1
        ids = [ID_RE.match(x).group(1) for x in tags if ID_RE.match(x) and ID_RE.match(x).group(1) not in PRIORITY_TAGS]
        if not ids or "@e2e" not in tags:
            continue
        out.append({"id": ids[0], "start": first + 1, "end": end + 1,
                    "text": "\n".join(lines[first:end + 1]), "obsolete": "@obsolete" in tags})
    return out


def changed_new_lines(repo, rev_range, path):
    """Line numbers (new side) the diff added or edited in `path`. Pure deletions add none."""
    try:
        out = subprocess.run(["git", "-C", repo, "diff", "-U0", rev_range, "--", path],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return None
    nums = set()
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", out, re.M):
        start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
        nums.update(range(start, start + count))
    return nums


def name_tokens(path):
    """The names a spec would use for this file: basename, stem, and a distinctive core."""
    base = os.path.basename(path)
    stem = re.sub(r"\.(js|cjs|mjs|ts|py|sql|json)$", "", base)
    toks = {base, stem}
    core = stem
    for suf in CORE_SUFFIXES:
        if core.endswith(suf):
            core = core[: -len(suf)]
            break
    if len(core) >= MIN_CORE:
        toks.add(core)
    return sorted(t for t in toks if t)


def mentions(text, token):
    # bounded so `menu.service` does not hit inside `lp-menu.service`; dots and hyphens are part of names
    return re.search(r"(?<![\w./-])" + re.escape(token) + r"(?![\w-])", text) is not None


def load_scenario_pins(map_path):
    """feature-map.yaml `scenarios:` → {feature: [(glob, [ids])]}. Absent section → {}."""
    try:
        import yaml
    except ImportError:
        import yaml_lite as yaml
    with open(map_path) as fh:
        raw = yaml.safe_load(fh) or {}
    pins = {}
    for feature, entries in (raw.get("scenarios") or {}).items():
        for glob, ids in (entries or {}).items():
            pins.setdefault(feature, []).append((glob, [str(i) for i in (ids or [])]))
    return pins


def select(selection, repo, rev_range, pins, spec_reader=None):
    """selection = select_e2e's JSON dict. Returns the output dict described in the module doc."""
    spec_reader = spec_reader or (lambda f: open(os.path.join(repo, SPEC_DIR, f + ".feature"), encoding="utf-8").read())
    result = {}
    for feature in selection.get("features") or []:
        try:
            scen = [s for s in spec_scenarios(spec_reader(feature)) if not s["obsolete"]]
        except (IOError, OSError):
            result[feature] = {"scope": "all", "ids": [], "why": {},
                               "whole_feature_because": ["no spec file to map scenarios from"]}
            continue
        known = {s["id"] for s in scen}
        chosen, why, whole = [], {}, []

        def pick(sid, reason):
            if sid not in known:
                return
            if sid not in chosen:
                chosen.append(sid)
            why.setdefault(sid, []).append(reason)

        spec_rel = "%s/%s.feature" % (SPEC_DIR, feature)
        for r in (selection.get("reasons") or {}).get(feature, []):
            path = r.get("path") or ""
            hit_before = len(chosen)
            if path == spec_rel:
                lines = changed_new_lines(repo, rev_range, path) if rev_range else None
                if lines is None:
                    whole.append("%s: spec changed but the diff could not be read" % path)
                    continue
                for s in scen:
                    if any(s["start"] <= n <= s["end"] for n in lines):
                        pick(s["id"], "spec lines %d-%d edited" % (s["start"], s["end"]))
                continue   # a spec edit that touches no live scenario (header, a deletion) drives nothing
            pinned = [ids for glob, ids in pins.get(feature, []) if select_e2e.glob_match(glob, path)]
            if pinned:
                for ids in pinned:
                    for sid in ids:
                        pick(sid, "%s pinned in feature-map.yaml scenarios:" % path)
                if len(chosen) == hit_before:
                    whole.append("%s: its scenarios: pin names no live %s scenario" % (path, feature))
                continue
            toks = name_tokens(path)
            for s in scen:
                hits = [t for t in toks if mentions(s["text"], t)]
                if hits:
                    pick(s["id"], "%s named (%s)" % (path, hits[0]))
            if len(chosen) == hit_before:
                whole.append("%s: no %s scenario names it — pin it under scenarios: to narrow" % (path, feature))
        order = [s["id"] for s in scen]
        chosen.sort(key=lambda x: order.index(x))
        if whole:
            result[feature] = {"scope": "all", "ids": [], "why": {}, "whole_feature_because": whole,
                               "would_have_picked": chosen}
        elif chosen:
            result[feature] = {"scope": "subset", "ids": chosen, "why": why, "whole_feature_because": [],
                               "of": len(scen)}
        else:
            result[feature] = {"scope": "none", "ids": [], "why": {}, "whole_feature_because": [],
                               "note": "only spec lines outside any live scenario changed"}
    only = ";".join("%s=%s" % (f, ",".join(v["ids"])) for f, v in result.items() if v["scope"] == "subset")
    return {"features": result, "only": only}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--selection", help="select_e2e --json output (a file, or - for stdin)")
    ap.add_argument("--repo", default=os.path.abspath(os.path.join(HERE, "..", "..", "..")))
    ap.add_argument("--range", dest="rev_range")
    ap.add_argument("--map", default=os.environ.get("E2E_SELECT_MAP")
                    or os.path.join(HERE, "..", "config", "feature-map.yaml"))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.selection:
            raw = sys.stdin.read() if a.selection == "-" else open(a.selection).read()
            selection = json.loads(raw or "{}")
        else:
            out = subprocess.run([sys.executable, os.path.join(HERE, "select_e2e.py"), "--repo", a.repo,
                                  "--range", a.rev_range or "HEAD~1...HEAD", "--json"],
                                 capture_output=True, text=True, timeout=60).stdout
            selection = json.loads(out or "{}")
        pins = load_scenario_pins(a.map) if os.path.isfile(a.map) else {}
        res = select(selection, a.repo, a.rev_range, pins)
    except Exception as e:  # never block a commit for its own reasons
        sys.stderr.write("select_scenarios: could not decide (%s) — run whole features\n" % e)
        return CANNOT_DECIDE
    if a.json:
        print(json.dumps(res, indent=1))
    else:
        for f, v in res["features"].items():
            if v["scope"] == "subset":
                print("%s: %d of %d — %s" % (f, len(v["ids"]), v.get("of", 0), ", ".join(v["ids"])))
            elif v["scope"] == "none":
                print("%s: nothing to drive (%s)" % (f, v.get("note", "")))
            else:
                print("%s: ALL — %s" % (f, "; ".join(v["whole_feature_because"])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
