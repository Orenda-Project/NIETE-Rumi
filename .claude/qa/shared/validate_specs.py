#!/usr/bin/env python3
"""validate_specs — the gate between a machine-written .feature file and the E2E run.

    sync writes/edits specs  →  validate_specs  →  /niete-e2e <feature>

Run:
    python3 .claude/qa/shared/validate_specs.py                    # every niete spec
    python3 .claude/qa/shared/validate_specs.py --only menu,status # just these
    python3 .claude/qa/shared/validate_specs.py --json

EXIT CODES
    0  no errors (warnings may still have printed)
    1  at least one error — do NOT run the suite on these specs
    3  could not decide (spec dir or agents dir missing)

WHAT IT IS FOR, and the line it will not cross.

This is a STRUCTURAL gate, not a review. It cannot tell you a scenario is wrong
about the product; it tells you the file will behave the way it reads. Every check
below is a way a spec can look correct and run incorrectly:

  · a duplicated scenario name → two scenarios, one reported result
  · a scenario with no Then    → a test that can never fail
  · @e2ee instead of @e2e      → reads as covered, is never selected, forever
  · @e2e + @smoke together     → nobody can say whether the default run takes it
  · a spec with no agent       → a file nothing will ever execute

THE WARN/ERROR SPLIT IS THE WHOLE DESIGN.

`tests/features/whatsapp/niete/` carries ~40 distinct tags while config/tags.md
documents ~30 — the vocabulary genuinely grows faster than its doc. A validator
that ERRORED on undocumented tags would fail all nine live files the day it
landed, and a gate that fires on everything is one somebody disables by Friday.

So unknown tags WARN. The only tag errors are near-misses of the eleven tags that
actually decide what runs, and even then only for tags that are not themselves
known vocabulary — without that second condition `@flow` (45 uses) is one edit
from `@slow` and every file fails. That exact false positive is why the check is
written as "unknown AND close", never "close".
"""
import argparse
import glob
import json
import os
import re
import sys

CANNOT_DECIDE = 3

SPEC_DIR = os.path.join("tests", "features", "whatsapp", "niete")
AGENT_TEMPLATE = "niete-%s-agent.md"

# ── the tags that DECIDE WHAT RUNS ───────────────────────────────────────────
# A typo in one of these is silent: the scenario is still valid Gherkin, still
# reads as covered, and is simply never selected (or worse, selected when it
# should have been excluded). Everything else is reporting metadata.
#
# Source: .claude/qa/config/tags.md, "Layer" and "Status" axes.
GATING_TAGS = frozenset([
    "e2e", "smoke",                       # layer — decides selection
    "wip", "draft", "slow", "destructive",  # exclusions from the default run
    "first-use", "config-gated",
    "known-fail", "known-issue",          # expected-failure bookkeeping
    "obsolete",                           # the sync's deletion proposal
])

LAYER_TAGS = frozenset(["e2e", "smoke"])

# Documented vocabulary (tags.md) plus what the nine live specs actually use.
# Being absent here is only ever a WARNING, so an omission costs a line of noise,
# never a false failure.
KNOWN_TAGS = frozenset(GATING_TAGS | {
    # feature / surface
    "menu", "training", "ask", "portal", "language", "register", "registration",
    "coaching", "observe", "attendance", "status", "lesson-plan", "quiz",
    # scope + slice
    "menu-feature", "out-of-region", "copy", "flow", "negative", "edge",
    "certificates", "data", "vendor", "content-driven", "defensive",
    "role-fork", "debrief", "voice", "audio", "acceptance", "scheduling",
    "excel", "harm-gate", "seeded", "out-of-band", "i18n", "coverage", "new",
    # priority
    "p1", "p2", "p3",
    # backend
    "chunk",
    # environment
    "whatsapp", "ict",
})

# `@profile:niete`, `@persona:teacher`, `@feature:menu` — the namespaced axes.
KNOWN_PREFIXES = ("profile:", "persona:", "feature:")

# An @obsolete scenario must say why, on a comment line inside it. The sync never
# deletes; it proposes. An unexplained proposal is indistinguishable from a bug
# by the time anyone reads it.
OBSOLETE_REASON_RE = re.compile(r"#\s*OBSOLETE\b", re.I)

_BLOCK_RE = re.compile(r"^(Scenario Outline|Scenario Template|Scenario|Example|Background|Rule)\s*:", re.I)
_STEP_RE = re.compile(r"^(Given|When|Then|And|But|\*)\s+")


class Problem(dict):
    def __init__(self, level, code, path, line, msg):
        dict.__init__(self, level=level, code=code, path=path, line=line, msg=msg)


# ── parsing ──────────────────────────────────────────────────────────────────

def parse(path):
    """Parse a .feature into {feature_tags, feature_line, scenarios[]}.

    Deliberately hand-rolled and forgiving — this must report on a MALFORMED file,
    so it cannot be a parser that raises on one. `parse-gherkin.py` is the runner's
    tag filter and drops the line numbers a diagnostic needs; the shapes are close
    but the jobs are not the same.
    """
    feature_tags, feature_lines, scenarios = [], [], []
    pending, cur = [], None
    in_examples = False

    with open(path, encoding="utf-8") as fh:
        for n, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line:
                continue

            if line.startswith("@"):
                pending += [t for t in line.split() if t.startswith("@") and len(t) > 1]
                in_examples = False
                continue

            if line.lower().startswith("feature:"):
                feature_lines.append(n)
                if not feature_tags:
                    feature_tags = pending[:]
                pending = []
                in_examples = False
                continue

            m = _BLOCK_RE.match(line)
            if m:
                kind = m.group(1).lower()
                if cur:
                    scenarios.append(cur)
                    cur = None
                in_examples = False
                # Background and Rule are not scenarios: they carry no result and
                # must not be held to the When/Then contract. Their tags are
                # dropped with them.
                if kind in ("background", "rule"):
                    pending = []
                    continue
                cur = {"name": line.split(":", 1)[1].strip(), "line": n,
                       "tags": [t[1:].lower() for t in feature_tags + pending],
                       "own_tags": [t[1:].lower() for t in pending],
                       "steps": [], "comments": []}
                pending = []
                continue

            if line.lower().startswith("examples:") or line.lower().startswith("scenarios:"):
                in_examples = True
                continue

            if cur is None:
                continue
            if line.startswith("#"):
                cur["comments"].append(line)
                continue
            # Example-table rows are data, not steps.
            if in_examples or line.startswith("|"):
                continue
            sm = _STEP_RE.match(line)
            if sm:
                cur["steps"].append((sm.group(1).title(), line))

    if cur:
        scenarios.append(cur)
    return {"feature_tags": [t[1:].lower() for t in feature_tags],
            "feature_lines": feature_lines, "scenarios": scenarios}


# ── tag checking ─────────────────────────────────────────────────────────────

def _within_one_edit(a, b):
    """True when `a` and `b` are at Levenshtein distance <= 1.

    Length-gapped pairs are rejected up front, so the loop below only ever runs
    on candidates that could possibly be one edit apart.
    """
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    shorter, longer = (a, b) if la < lb else (b, a)
    for i in range(len(longer)):
        if longer[:i] + longer[i + 1:] == shorter:
            return True
    return False


def tag_problems(tag, path, line):
    """A tag is fine, a typo of something that gates the run, or just new."""
    if tag in KNOWN_TAGS:
        return []
    if any(tag.startswith(p) for p in KNOWN_PREFIXES):
        return []
    # UNKNOWN **and** close. Both halves are load-bearing: `@flow` is a real tag
    # one edit from `@slow`, and dropping the "unknown" half fails every file.
    for gate in sorted(GATING_TAGS):
        if _within_one_edit(tag, gate):
            return [Problem("error", "E-TAGTYPO", path, line,
                            "@%s is one edit from the run-gating tag @%s. A mistyped "
                            "gating tag changes what the suite runs and never says so."
                            % (tag, gate))]
    return [Problem("warn", "W-UNKNOWNTAG", path, line,
                    "@%s is not in the documented vocabulary (.claude/qa/config/tags.md). "
                    "Fine if deliberate — add it there." % tag)]


# ── the checks ───────────────────────────────────────────────────────────────

def validate_file(path, agents):
    """Return a list of Problems for one .feature file.

    `agents` is a directory of `niete-<feature>-agent.md` files, or a set/list of
    bare feature names (the tests pass a directory).
    """
    problems = []
    name = os.path.basename(path)[:-len(".feature")]

    if isinstance(agents, str):
        have_agent = os.path.isfile(os.path.join(agents, AGENT_TEMPLATE % name))
    else:
        have_agent = name in set(agents)
    if not have_agent:
        problems.append(Problem("error", "E-NOAGENT", path, 1,
                                "no .claude/qa/agents/%s — nothing will ever run this "
                                "spec. Add the agent, or the file is dead weight."
                                % (AGENT_TEMPLATE % name)))

    doc = parse(path)

    if not doc["feature_lines"]:
        problems.append(Problem("error", "E-NOFEATURE", path, 1,
                                "no `Feature:` line — this is not a parseable feature file."))
    elif len(doc["feature_lines"]) > 1:
        problems.append(Problem("error", "E-MULTIFEATURE", path, doc["feature_lines"][1],
                                "%d `Feature:` lines; a .feature file holds exactly one."
                                % len(doc["feature_lines"])))

    for tag in doc["feature_tags"]:
        problems += tag_problems(tag, path, doc["feature_lines"][0] if doc["feature_lines"] else 1)

    scenarios = doc["scenarios"]
    if not scenarios:
        problems.append(Problem("warn", "W-EMPTY", path, 1,
                                "no scenarios — this feature has no coverage at all."))

    seen = {}
    for sc in scenarios:
        line, nm = sc["line"], sc["name"]

        low = nm.strip().lower()
        if low in seen:
            problems.append(Problem("error", "E-DUPNAME", path, line,
                                    "duplicate scenario name %r (first at line %d). Two "
                                    "scenarios, one reported result — the second hides "
                                    "the first." % (nm, seen[low])))
        else:
            seen[low] = line

        kinds = set(k for k, _ in sc["steps"])
        if "Then" not in kinds:
            problems.append(Problem("error", "E-NOTHEN", path, line,
                                    "%r has no Then step — it asserts nothing and can "
                                    "never fail." % nm))
        if "When" not in kinds:
            # WARN, not error. `Given ... And ... Then ...` is deliberate style in
            # 14 scenarios across 6 of the nine live specs — sometimes with the
            # reason written in ("Non-destructive to view; do NOT submit on the
            # shared driver"). A missing THEN is a defect; a missing When is a
            # dialect. Erroring here failed the shipped suite on the first run.
            problems.append(Problem("warn", "W-NOWHEN", path, line,
                                    "%r has no When step — the action is folded into "
                                    "the Given. Fine, but a reader cannot see the "
                                    "trigger at a glance." % nm))

        # TWO layer tags is an error; ZERO is a warning, and the asymmetry is the
        # point. Two is unanswerable — the runner cannot say whether the default
        # run takes the scenario. Zero has a legitimate meaning that the suite
        # actually uses: coaching.feature:82 is `@known-issue` with no @e2e on
        # purpose ("Documented, not asserted in the default run"). Erroring there
        # would force a fake @e2e onto a scenario nobody intends to run.
        layers = [t for t in sc["tags"] if t in LAYER_TAGS]
        if len(layers) > 1:
            problems.append(Problem("error", "E-LAYER", path, line,
                                    "%r carries %d layer tags (%s); exactly one of @e2e / "
                                    "@smoke is allowed or the runner cannot say whether "
                                    "this is in the suite."
                                    % (nm, len(layers), ", ".join("@" + l for l in layers))))
        elif not layers:
            problems.append(Problem("warn", "W-NOLAYER", path, line,
                                    "%r has no @e2e / @smoke tag, so nothing will ever "
                                    "run it. Deliberate (documentation-only) is fine — "
                                    "otherwise it is silently uncovered." % nm))

        if "obsolete" in sc["tags"]:
            if not any(OBSOLETE_REASON_RE.search(c) for c in sc["comments"]):
                problems.append(Problem("error", "E-OBSOLETE-NOREASON", path, line,
                                        "%r is @obsolete with no `# OBSOLETE <date> "
                                        "(<bead>): <why>` comment. The sync proposes "
                                        "deletions and never makes them — an unexplained "
                                        "proposal is unreviewable." % nm))

        for tag in sc["own_tags"]:
            problems += tag_problems(tag, path, line)

    return problems


def validate_dir(spec_dir, agents, only=None):
    """Validate every <name>.feature in spec_dir, or just `only` if given."""
    problems = []
    for path in sorted(glob.glob(os.path.join(spec_dir, "*.feature"))):
        name = os.path.basename(path)[:-len(".feature")]
        if only and name not in set(only):
            continue
        problems += validate_file(path, agents)
    return problems


# ── reporting ────────────────────────────────────────────────────────────────

def render(problems, spec_dir):
    errors = [p for p in problems if p["level"] == "error"]
    warns = [p for p in problems if p["level"] == "warn"]
    out = []
    for p in errors + warns:
        rel = os.path.relpath(p["path"], spec_dir) if spec_dir else p["path"]
        out.append("%-5s %-22s %s:%d  %s"
                   % (p["level"].upper(), p["code"], rel, p["line"], p["msg"]))
    if errors:
        out.append("")
        out.append("%d error(s), %d warning(s) — DO NOT run the suite on these specs."
                   % (len(errors), len(warns)))
    else:
        out.append("specs OK (%d warning(s))." % len(warns))
    return "\n".join(out)


def run(spec_dir, agents, only=None, as_json=False, stream=None):
    stream = stream or sys.stdout
    problems = validate_dir(spec_dir, agents, only=only)
    if as_json:
        print(json.dumps({"problems": problems,
                          "errors": sum(1 for p in problems if p["level"] == "error"),
                          "warnings": sum(1 for p in problems if p["level"] == "warn")},
                         indent=2), file=stream)
    else:
        print(render(problems, spec_dir), file=stream)
    return 1 if any(p["level"] == "error" for p in problems) else 0


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", "..", ".."))

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spec-dir", default=os.path.join(root, SPEC_DIR))
    ap.add_argument("--agents-dir", default=os.path.join(root, ".claude", "qa", "agents"))
    ap.add_argument("--only", default="", help="comma-separated feature names")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv[1:])

    if not os.path.isdir(a.spec_dir):
        print("[validate-specs] cannot decide: no spec dir %s" % a.spec_dir, file=sys.stderr)
        return CANNOT_DECIDE
    if not os.path.isdir(a.agents_dir):
        print("[validate-specs] cannot decide: no agents dir %s" % a.agents_dir, file=sys.stderr)
        return CANNOT_DECIDE

    only = [x.strip() for x in a.only.split(",") if x.strip()]
    return run(a.spec_dir, a.agents_dir, only=only or None, as_json=a.json)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
