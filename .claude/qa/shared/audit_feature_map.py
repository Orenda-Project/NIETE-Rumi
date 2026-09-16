#!/usr/bin/env python3
"""audit_feature_map — check feature-map.yaml against the bot's real import graph.

    python3 audit_feature_map.py --repo <NIETE-Rumi> [--json] [--fix-hints]

WHY THIS EXISTS

`feature-map.yaml` is hand-written, and its correctness rested on whether a
filename *looked* like a feature. That is not evidence. `lesson-plan-classifier.js`
sits under `services/coaching/` and belongs to coaching; `toc-loading.service.js`
gives no clue at all.

This resolves it from the thing that actually determines impact: who requires whom.
Each feature has entry points whose ownership is not in doubt — a route, a handler,
a feature-named directory. Everything those transitively pull in is code the
feature depends on, so a change there can break it.

    feature entry points --require()--> transitive closure = that feature's real surface

Four findings, in the order they matter:

  UNDER-SELECT  map assigns FEWER features than the graph reaches. A change here
                breaks a feature no E2E gets armed for. The dangerous one.
  UNMAPPED      reachable from a feature, claimed by no rule. Pulls the SAFE
                subset today — correct but blunt, and someone forgot.
  OVER-BROAD    map assigns MORE than the graph reaches. Wastes WhatsApp drive
                time; requirement 4 says don't run features a change can't affect.
  ORPHAN        mapped to a feature no entry point reaches. Usually a rename.

WHAT A STATIC SCAN CANNOT SEE, which is why nothing here is auto-applied:
  · runtime `require(variable)` and dispatch tables
  · coupling through the DATABASE rather than through imports
  · a shared string catalog every surface reads at runtime
It is a lens on the map, not a replacement for judgement.
"""
import json
import os
import re
import sys

REQUIRE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
PRUNE = ("node_modules", "__mocks__", "tests", "docs", "fonts", "assets",
         "temp", "logs", "test-assets", "marketing", "scripts", "dashboard")


def bot_files(repo):
    out, root = [], os.path.join(repo, "bot")
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in PRUNE]
        for fn in filenames:
            if fn.endswith(".js"):
                out.append(os.path.relpath(os.path.join(dirpath, fn), repo))
    return sorted(out)


def resolve(importer, spec, known):
    if not spec.startswith("."):
        return None
    cand = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    for probe in (cand, cand + ".js", os.path.join(cand, "index.js")):
        if probe in known:
            return probe
    return None


def build_graph(repo, files):
    known, graph = set(files), {f: set() for f in files}
    for f in files:
        try:
            src = open(os.path.join(repo, f), errors="ignore").read()
        except OSError:
            continue
        for m in REQUIRE.finditer(src):
            t = resolve(f, m.group(1), known)
            if t and t != f:
                graph[f].add(t)
    return graph


def closure(graph, seeds):
    seen, stack = set(), list(seeds)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(graph.get(n, ()))
    return seen


def main(argv):
    args = argv[1:]
    as_json, hints, repo = "--json" in args, "--fix-hints" in args, None
    for i, a in enumerate(args):
        if a == "--repo" and i + 1 < len(args):
            repo = args[i + 1]
    if not repo or not os.path.isdir(os.path.join(repo, "bot")):
        print("usage: audit_feature_map.py --repo <NIETE-Rumi> [--json] [--fix-hints]",
              file=sys.stderr)
        return 2

    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    import select_e2e as se
    qa = os.path.dirname(here)
    fmap = se.load_map(os.path.join(qa, "config", "feature-map.yaml"),
                       os.path.join(qa, "agents"))

    files = bot_files(repo)
    graph = build_graph(repo, files)

    # Entry points = files a feature owns via a NON-shared rule. Those are the
    # confident assignments; the closure is what turns them into evidence.
    entries = {f: set() for f in fmap.features}
    for rule in fmap.rules:
        if rule.shared:
            continue
        for f in files:
            if se.glob_match(rule.pattern, f):
                for feat in rule.features:
                    entries[feat].add(f)
    reach = {feat: closure(graph, s) for feat, s in entries.items()}

    # DIRECTION MATTERS, and getting it wrong produced 21 permanent false findings.
    #
    # "Which features reach X" is the right question for a LEAF — a framework, a
    # config, a template that features pull in. It is the WRONG question for a
    # DISPATCHER: `text-message.handler.js` requires menu.service.js, so menu's
    # closure never contains the handler. The handler contains menu.
    #
    # So classify by forward reach. A file that reaches two or more features' own
    # files is upstream of them, and is judged on what it reaches instead.
    owned = {feat: set(seeds) for feat, seeds in entries.items()}
    reaches = {}
    for f in files:
        fwd = closure(graph, [f]) - {f}
        hit = {feat for feat, own in owned.items() if fwd & own}
        if len(hit) >= 2:
            reaches[f] = hit

    under, over, unmapped, orphan, dispatch = [], [], [], [], []
    for f in files:
        if not fmap.in_scope(f) or fmap.is_ignored(f) or fmap.uncovered_reason(f):
            continue
        mapped = set(fmap.match(f))

        actual = {feat for feat, rs in reach.items() if f in rs}

        # Use the forward test ONLY for files no feature can reach at all.
        #
        # First cut keyed on "reaches 2+ features" and that was wrong: plenty of
        # mid-level services legitimately pull in something a feature owns, and
        # demanding they map to everything downstream ballooned the selection to
        # 83 under-selects — the opposite of requirement 4. A file that IS
        # reachable from a feature is a leaf: "who reaches me" answers it. Only
        # a file nothing reaches is upstream, and only then does "what do I
        # reach" become the right question.
        if not actual and f in reaches:
            need = reaches[f]
            if need - mapped:
                under.append((f, sorted(mapped), sorted(need - mapped)))
            else:
                dispatch.append((f, sorted(mapped), len(need)))
            continue

        if not mapped and actual:
            unmapped.append((f, sorted(actual)))
        elif mapped and actual - mapped:
            under.append((f, sorted(mapped), sorted(actual - mapped)))
        elif mapped and actual and mapped - actual:
            over.append((f, sorted(mapped), sorted(mapped - actual)))
        elif mapped and not actual:
            orphan.append((f, sorted(mapped)))

    if as_json:
        print(json.dumps({"under_select": under, "unmapped": unmapped,
                          "over_broad": over, "orphan": orphan,
                          "dispatchers_ok": dispatch,
                          "files_scanned": len(files)}, indent=2))
        return 0

    print("audit_feature_map — %d runtime files, %d import edges\n"
          % (len(files), sum(len(v) for v in graph.values())))

    def sec(title, rows, fmt, why):
        print("%s  (%d)\n  %s" % (title, len(rows), why))
        for r in rows[:45]:
            print("    " + fmt(r))
        if len(rows) > 45:
            print("    ... %d more" % (len(rows) - 45))
        print()

    short = lambda p: p.replace("bot/shared/", "").replace("bot/", "")
    sec("UNDER-SELECT", under,
        lambda r: "%-50s map=%-20s also reaches: %s" % (short(r[0]), ",".join(r[1]), ",".join(r[2])),
        "a change here breaks a feature no E2E gets armed for -- fix first")
    sec("UNMAPPED", unmapped,
        lambda r: "%-50s reachable from: %s" % (short(r[0]), ",".join(r[1])),
        "pulls the SAFE subset today; correct but blunt")
    sec("OVER-BROAD", over,
        lambda r: "%-50s map=%-26s cannot reach: %s" % (short(r[0]), ",".join(r[1]), ",".join(r[2])),
        "wastes drive time -- requirement 4")
    sec("DISPATCHER (ok)", dispatch,
        lambda r: "%-50s maps to %-24s covers the %d features it reaches" % (short(r[0]), ",".join(r[1]), r[2]),
        "upstream of features -- judged on what it reaches; these are correct")
    sec("ORPHAN", orphan,
        lambda r: "%-50s map=%s" % (short(r[0]), ",".join(r[1])),
        "no entry point reaches these -- a rename, or a runtime-only edge")

    if hints:
        print("-- suggested additions (review each; a static scan misses runtime edges) --")
        by = {}
        for f, actual in unmapped:
            by.setdefault(",".join(actual), []).append(f)
        for feats, fs in sorted(by.items()):
            print("  # -> %s" % feats)
            for f in sorted(fs):
                print("      - %s" % f)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
