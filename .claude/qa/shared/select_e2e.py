#!/usr/bin/env python3
"""select_e2e — changed files → affected NIETE feature(s) → `/niete-e2e` commands.

    push  →  changed files  →  feature map  →  selected features  →  printed commands

That is the whole pipeline. There is no queue, no drainer, no SHA tracking, no
ledger write, and no browser execution: this module decides WHAT to run and prints
it. A human (or the agent) runs it, after the deploy is live.

Why it can't run the suite itself, in one place so nobody re-litigates it:
  · the Chrome DevTools MCP tools are callable by the agent, not by a subprocess;
  · the hook runs in-band with the Bash call, and a coaching scenario is ~10 min;
  · `whatsapp-targets.yaml` sets `test_driver: prompt` — the driver number is asked
    for at runtime, on purpose (bd-2748);
  · the default target is STAGING, which at pre-push time is still running the OLD
    code. Driving it then would green-light a change that never actually ran.

USAGE
    select_e2e.py <path> [<path> ...]        # classify explicit paths
    select_e2e.py --stdin                    # one path per line on stdin
    select_e2e.py --repo <dir> [--range A...B]   # ask git for the diff
    select_e2e.py --repo <dir> --pushed          # what a JUST-COMPLETED push sent
    select_e2e.py --repo <dir> --committed       # what the HEAD commit changed
    ... [--json] [--repo-name NAME]

ENV
    E2E_SELECT_MAP   alternate feature-map.yaml (tests / manual runs)

EXIT CODES  (advisory by design — see .claude/hooks/pre-push-qa-check.sh)
    0  ran fine (whether or not anything was selected)
    3  could not decide (bad/missing map, no PyYAML, git failed). Callers MUST
       treat 3 as "no opinion" and carry on; a selector that blocks a push for
       its own reasons gets switched off within a day.
"""
import json
import os
import re
import subprocess
import sys

SPEC_DIR = "tests/features/whatsapp/niete"
SPEC_SUFFIX = ".feature"

# Features whose scenarios are drafts: `/niete-e2e` never picks them up by default
# and `all` excludes them — they run only when named. Selecting one is still right
# (the code changed), but the output has to say so or the operator will report a
# phantom empty run.
DRAFT_FEATURES = ("observe", "attendance")

CANNOT_DECIDE = 3


class MapError(Exception):
    """The map or the agent frontmatter is inconsistent — refuse to guess."""


class RangeUnknown(Exception):
    """Could not work out which commits a push sent.

    Deliberately NOT the same as "nothing changed". Conflating the two is silent
    under-selection — the exact failure this design exists to prevent — so the
    caller turns this into an explicit SAFE-subset fallback instead.
    """


# ─────────────────────────────────────────────────────────────── glob matching ──

_GLOB_CACHE = {}


def _translate(pattern):
    """Glob → anchored regex.

    Hand-rolled rather than `fnmatch` because fnmatch's `*` crosses `/`: under it
    `bot/*.js` matches `bot/shared/services/menu.service.js`, so a single top-level
    rule would swallow the entire tree and every push would select every feature.

    `**` crosses separators, `*` and `?` do not, everything else is literal.
    """
    out = ["^"]
    i, n = 0, len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if pattern.startswith("**", i):
                i += 2
                # `foo/**` should also match `foo` itself, and `**/x` should match
                # a bare `x` — swallow the adjoining slash rather than requiring it.
                if pattern.startswith("/", i):
                    i += 1
                    out.append("(?:.*/)?")
                else:
                    out.append(".*")
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(c))
        i += 1
    out.append("$")
    return "".join(out)


def glob_match(pattern, path):
    """True when `path` matches the glob `pattern`. See `_translate`."""
    rx = _GLOB_CACHE.get(pattern)
    if rx is None:
        rx = _GLOB_CACHE[pattern] = re.compile(_translate(pattern))
    return rx.match(path) is not None


def normalise(path):
    """`./bot/x.js` and `bot//x.js` are the same file as `bot/x.js`."""
    p = path.strip().replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return re.sub(r"/{2,}", "/", p).lstrip("/")


# ──────────────────────────────────────────────── feature order (from agents) ──

_FRONTMATTER_ORDER = re.compile(r"^order:\s*(\d+)\s*$", re.M)
_FRONTMATTER_FEATURE = re.compile(r"^feature:\s*(\S+)\s*$", re.M)


def load_feature_order(agents_dir):
    """Feature names in run order, read from each agent's `order:` frontmatter.

    The `/niete-e2e` command is explicit that the frontmatter — not a list in a doc
    — is the single source of truth for order, and that two agents sharing an
    `order:` is a divergence to fail on. This mirrors `feature-order.py`, which
    can't be imported (its filename is hyphenated).
    """
    seen = {}
    for fname in sorted(os.listdir(agents_dir)):
        if not fname.endswith(".md"):
            continue
        with open(os.path.join(agents_dir, fname)) as fh:
            head = fh.read(4000)
        m_order, m_feat = _FRONTMATTER_ORDER.search(head), _FRONTMATTER_FEATURE.search(head)
        if not (m_order and m_feat):
            continue
        order = int(m_order.group(1))
        name = os.path.basename(m_feat.group(1))
        if name.endswith(SPEC_SUFFIX):
            name = name[: -len(SPEC_SUFFIX)]
        if order in seen:
            raise MapError(
                "two agents share order: %d (%s and %s) — fix the frontmatter; "
                "run order must be unambiguous" % (order, seen[order], name))
        seen[order] = name
    if not seen:
        raise MapError("no agent frontmatter with both order: and feature: in %s" % agents_dir)
    return [seen[k] for k in sorted(seen)]


# ───────────────────────────────────────────────────────────────── the map ──

class Rule(object):
    """One glob and the features it selects. `shared` drives the output label."""

    __slots__ = ("pattern", "features", "shared")

    def __init__(self, pattern, features, shared):
        self.pattern = pattern
        self.features = features
        self.shared = shared


class FeatureMap(object):
    def __init__(self, features, rules, ignore, scope, not_covered, full_suite_on=None):
        self.features = features          # canonical name list (from the agents)
        self.rules = rules                # [Rule]
        self.ignore = ignore              # [glob]
        self.scope = scope                # [glob] — everything else has no bearing
        self.not_covered = not_covered    # [(glob, reason)] — real, but no E2E
        self.full_suite_on = full_suite_on or []   # [{repo_match, branches, command}]

    def match(self, path):
        """Every feature selected by `path`, deduped. [] when nothing matches."""
        hits = []
        for rule in self.rules:
            if glob_match(rule.pattern, path):
                for f in rule.features:
                    if f not in hits:
                        hits.append(f)
        return hits

    def matching_rules(self, path):
        return [r for r in self.rules if glob_match(r.pattern, path)]

    def is_ignored(self, path):
        return any(glob_match(g, path) for g in self.ignore)

    def in_scope(self, path):
        return any(glob_match(g, path) for g in self.scope)

    def uncovered_reason(self, path):
        """The documented reason this path has no E2E, or None."""
        for pattern, reason in self.not_covered:
            if glob_match(pattern, path):
                return reason
        return None


def load_map(map_path, agents_dir):
    # PyYAML when present; otherwise the zero-dependency reader that ships beside
    # this file. The tooling has to work from a fresh clone on any machine, and a
    # fresh machine has no PyYAML — that made the whole pipeline silently inert
    # until scripts/qa/verify-clean-clone.sh caught it (2026-09-07).
    try:
        import yaml
    except ImportError:
        import yaml_lite as yaml

    with open(map_path) as fh:
        try:
            raw = yaml.safe_load(fh) or {}
        except ValueError as e:
            raise MapError("cannot read %s: %s" % (map_path, e))

    known = load_feature_order(agents_dir)
    rules = []

    def check(names, where):
        for n in names:
            if n not in known:
                raise MapError(
                    "%s references feature %r, which has no agent in %s (known: %s)"
                    % (where, n, agents_dir, ", ".join(known)))

    for feature, globs in (raw.get("features") or {}).items():
        check([feature], "features:")
        for g in globs or []:
            rules.append(Rule(g, [feature], shared=False))

    for pattern, names in (raw.get("shared") or {}).items():
        names = list(known) if names == "*" else list(names or [])
        check(names, "shared: %s" % pattern)
        rules.append(Rule(pattern, names, shared=True))

    not_covered = list((raw.get("not_covered") or {}).items())
    for pattern, reason in not_covered:
        if not (reason or "").strip():
            raise MapError("not_covered: %s has no reason — an unexplained entry "
                           "is just a silent ignore" % pattern)

    scope = list(raw.get("scope") or [])
    if not scope:
        raise MapError("%s declares no scope: — refusing to treat the whole "
                       "monorepo as E2E-relevant" % map_path)

    full_suite = []
    for rule in (raw.get("full_suite_on") or []):
        for k in ("repo_match", "branches", "command"):
            if not rule.get(k):
                raise MapError("full_suite_on entry is missing %r: %r" % (k, rule))
        full_suite.append(rule)

    return FeatureMap(known, rules, list(raw.get("ignore") or []), scope,
                      not_covered, full_suite)


def wants_full_suite(fmap, repo_remote, branch):
    """The full-suite command for this repo+branch, or None.

    Matched on the ORIGIN REMOTE URL rather than the directory name, so a clone
    sitting in a differently-named folder still resolves. Returns None on any
    missing input — an unknown remote or a detached HEAD must never escalate a
    targeted run into a 3-5 hour one.
    """
    if not repo_remote or not branch:
        return None
    for rule in fmap.full_suite_on:
        if rule["repo_match"] in repo_remote and branch in rule["branches"]:
            return rule["command"]
    return None


# ─────────────────────────────────────────────────────────────── selection ──

class Reason(object):
    """Why one feature got selected — the audit line behind a printed command."""

    __slots__ = ("path", "pattern", "shared", "kind")

    def __init__(self, path, pattern, shared, kind):
        self.path = path
        self.pattern = pattern
        self.shared = shared
        self.kind = kind              # "map" | "spec"

    def to_dict(self):
        return {"path": self.path, "pattern": self.pattern,
                "shared": self.shared, "kind": self.kind}


class Selection(object):
    def __init__(self, features, reasons, unmapped, ignored, out_of_scope,
                 not_covered, fallback, fallback_reason, draft, considered):
        self.features = features                # selected, in agent run order
        self.reasons = reasons                  # {feature: [Reason]}
        self.unmapped = unmapped                # in-scope files matching nothing
        self.ignored = ignored                  # in-scope but inert
        self.out_of_scope = out_of_scope        # portal / dashboard / infra / ...
        self.not_covered = not_covered          # [(path, reason)] — real, no E2E
        self.fallback = fallback                # SAFE subset pulled in?
        self.fallback_reason = fallback_reason
        self.draft = draft                      # selected ∩ DRAFT_FEATURES
        self.considered = considered            # every path we looked at
        self.full_suite = None                  # set to override with the whole suite

    @property
    def by_path(self):
        """[(path, [features], label)] in the order the paths were considered.

        `reasons` is keyed by feature because that's what drives the commands;
        the operator reads by CHANGED FILE. Same data, transposed once here so
        the renderer doesn't print a fan-out path eight times.
        """
        acc, labels = {}, {}
        for feature in self.features:
            for r in self.reasons[feature]:
                acc.setdefault(r.path, []).append(feature)
                labels.setdefault(r.path, "spec" if r.kind == "spec"
                                  else ("shared" if r.shared else ""))
        return [(p, acc[p], labels[p]) for p in self.considered if p in acc]

    @property
    def commands(self):
        """SAFE subset FIRST when it applies, then the narrowed features.

        Order matters: the fallback is additive. Printing `/niete-e2e` instead of
        the specific features would hide the mapped signal behind the broad run.
        """
        if self.full_suite:
            return [self.full_suite]
        cmds = ["/niete-e2e"] if self.fallback else []
        return cmds + ["/niete-e2e %s" % f for f in self.features]

    def to_dict(self):
        return {
            "features": list(self.features),
            "commands": list(self.commands),
            "full_suite": self.full_suite,
            "fallback": self.fallback,
            "fallback_reason": self.fallback_reason,
            "unmapped": list(self.unmapped),
            "ignored": list(self.ignored),
            "out_of_scope": list(self.out_of_scope),
            "not_covered": [list(x) for x in self.not_covered],
            "draft": list(self.draft),
            "considered": list(self.considered),
            "reasons": {f: [r.to_dict() for r in rs] for f, rs in self.reasons.items()},
        }


def select(paths, fmap, order, range_unknown=False):
    """Classify `paths`. Pure — no git, no filesystem beyond what's already loaded.

    Precedence per path:
        out of scope → spec file → mapped → ignored → not_covered → unmapped.
    An explicit mapping wins over `ignore:` so a teacher-facing artifact under an
    otherwise-inert directory (`bot/docs/flows/*.json`) still selects.
    """
    reasons, unmapped, ignored, out_of_scope, considered = {}, [], [], [], []
    not_covered = []
    seen = set()

    for raw in paths:
        path = normalise(raw)
        if not path or path in seen:
            continue
        seen.add(path)
        considered.append(path)

        # 0. outside the suite's remit entirely (portal, dashboard, infra). NOT
        #    unmapped — these must never pull the SAFE subset.
        if not fmap.in_scope(path):
            out_of_scope.append(path)
            continue

        # 1. a spec change selects its own feature, directly
        if path.startswith(SPEC_DIR + "/") and path.endswith(SPEC_SUFFIX):
            name = os.path.basename(path)[: -len(SPEC_SUFFIX)]
            if name in fmap.features:
                reasons.setdefault(name, []).append(
                    Reason(path, SPEC_DIR + "/" + name + SPEC_SUFFIX, False, "spec"))
            else:
                # A spec with no agent is a real inconsistency, not a doc edit.
                unmapped.append(path)
            continue

        # 2. mapped (explicit mapping beats `ignore:`)
        hits = fmap.matching_rules(path)
        if hits:
            for rule in hits:
                for feature in rule.features:
                    bucket = reasons.setdefault(feature, [])
                    if not any(r.path == path for r in bucket):
                        bucket.append(Reason(path, rule.pattern, rule.shared, "map"))
            continue

        # 3. inert
        if fmap.is_ignored(path):
            ignored.append(path)
            continue

        # 4. a real surface we knowingly do not cover
        reason = fmap.uncovered_reason(path)
        if reason:
            not_covered.append((path, reason))
            continue

        # 5. nothing knows about it
        unmapped.append(path)

    features = [f for f in order if f in reasons]
    fallback = bool(unmapped) or range_unknown
    fallback_reason = ""
    if range_unknown:
        fallback_reason = (
            "could not determine which commits this push sent, so which surfaces "
            "it touched is unknown. The SAFE subset was selected rather than "
            "nothing — an unreadable range is not evidence that nothing changed.")
    elif fallback:
        n = len(unmapped)
        fallback_reason = (
            "%d changed %s unmapped — no rule in feature-map.yaml claims %s, so "
            "which surface %s affect is unknown. The SAFE subset was selected in "
            "addition to any narrowed feature."
            % (n, "file is" if n == 1 else "files are",
               "it" if n == 1 else "them", "it may" if n == 1 else "they may"))

    return Selection(features, reasons, unmapped, ignored, out_of_scope, not_covered,
                     fallback, fallback_reason,
                     [f for f in features if f in DRAFT_FEATURES], considered)


# ───────────────────────────────────────────────────────────────── rendering ──

def render_text(sel, repo="", map_rel=".claude/qa/config/feature-map.yaml"):
    """Operator-facing block. Empty string when there is nothing to say.

    Silence is the point when a push is docs-only: a gate that prints on every
    push is a gate people learn to scroll past.
    """
    if not (sel.commands or sel.not_covered):
        return ""

    L = []
    where = " in %s" % repo if repo else ""
    L.append("[e2e-select] %d changed file(s)%s" % (len(sel.considered), where))
    L.append("")

    rows = sel.by_path
    if rows:
        L.append("  MAPPED")
        width = min(max(len(p) for p, _, _ in rows), 58)
        for path, feats, label in rows:
            tag = {"spec": "   (spec)",
                   "shared": "   (shared — fans out)"}.get(label, "")
            L.append("    %-*s -> %s%s" % (width, path, ", ".join(feats), tag))
        L.append("")

    # Keyed on `fallback`, not on `unmapped` — an unreadable push range sets the
    # former with none of the latter, and that case MUST still explain itself.
    if sel.fallback:
        if sel.unmapped:
            L.append("  UNMAPPED  (no rule claims these)")
            for p in sel.unmapped:
                L.append("    %s" % p)
            L.append("")
        L.append("  FALLBACK: %s" % sel.fallback_reason)
        if sel.unmapped:
            L.append("  Add them to %s to narrow this next time." % map_rel)
        L.append("")

    if sel.not_covered:
        L.append("  NOT COVERED  (real surface, no E2E — see feature-map.yaml `not_covered:`)")
        for path, reason in sel.not_covered:
            L.append("    %-58s %s" % (path, reason))
        L.append("")

    skipped = []
    if sel.ignored:
        skipped.append("%d inert (%s)" % (len(sel.ignored), ", ".join(sel.ignored[:3])
                                          + (", ..." if len(sel.ignored) > 3 else "")))
    if sel.out_of_scope:
        skipped.append("%d outside the bot runtime" % len(sel.out_of_scope))
    if skipped:
        L.append("  SKIPPED: %s" % "; ".join(skipped))
        L.append("")

    if not sel.commands:
        L.append("  SELECTED: nothing to run.")
        return "\n".join(L)

    L.append("  SELECTED: %s" % (", ".join(sel.features) if sel.features
                                 else "(none — SAFE subset only)"))
    if sel.draft:
        L.append("  NOTE: %s %s draft (@wip) — scenarios may report BLOCKED until promoted."
                 % (", ".join(sel.draft), "is" if len(sel.draft) == 1 else "are"))
    L.append("")
    L.append("  RUN THESE ONCE THE DEPLOY IS LIVE (not before — staging still has the old code):")
    for c in sel.commands:
        note = ""
        if c == "/niete-e2e":
            note = "   # SAFE subset — fallback, see UNMAPPED above"
        L.append("    %s%s" % (c, note))
    return "\n".join(L)


# ────────────────────────────────────────────────────────────────────── CLI ──

def committed_files(repo_dir):
    """Files in the HEAD commit — the range for a COMMIT trigger (bd-43513).

    Far simpler than the push ranges: no upstream, no reflog, no tracking ref.
    `git show --name-only --format=` handles a root commit (no parent) without
    the `HEAD~1` explosion, and returns EMPTY for a merge commit — deliberately.
    A merge introduces no new work of its own; arming on it would re-run the E2E
    for changes that were already armed when their real commits landed.

    NOTE ON WHAT THIS DOES NOT MEAN. A commit is not a deploy. The bot under test
    is whatever is currently live, so an E2E driven off a commit exercises the
    DEPLOYED build, not the committed one. That caveat belongs in front of the
    person acting on it, so the hook's instruction carries it — not this function.
    """
    r = subprocess.run(["git", "-C", repo_dir, "show", "--name-only", "--format=", "HEAD"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RangeUnknown("could not read the HEAD commit in %s" % repo_dir)
    return [l for l in r.stdout.splitlines() if l.strip()]


def changed_files(repo_dir, rev_range=None, pushed=False):
    """`git diff --name-only` for the push.

    TWO MODES, and picking the wrong one silently returns nothing:

    `pushed=False` (default, PRE-push) — `@{upstream}...HEAD`: the commits this
    push is *about to* send.

    `pushed=True` (POST-push) — the tracking ref's reflog, `<ref>@{1}...<ref>`.
    After the push completes the tracking ref has already advanced to the pushed
    commit, so `@{upstream}...HEAD` is EMPTY. The arming hook runs at exactly that
    moment. This cost a real bug: every synthetic test passed while the auto-run
    never armed on an actual push, because the tests fed paths in directly and
    never went near git. The reflog is the only place the pre-push position of the
    ref survives.
    """
    def git(*args):
        return subprocess.run(["git", "-C", repo_dir] + list(args),
                              capture_output=True, text=True)

    if pushed and not rev_range:
        ref = git("rev-parse", "--abbrev-ref", "@{upstream}").stdout.strip()
        if not ref:
            raise RangeUnknown("no upstream tracking ref in %s" % repo_dir)
        # `@{1}` is where the ref sat before this push. Absent on a first-ever
        # push of the branch — which is unknown, not empty.
        prev = git("rev-parse", "%s@{1}" % ref)
        if prev.returncode != 0 or not prev.stdout.strip():
            raise RangeUnknown(
                "%s has no previous reflog entry — cannot tell what this push sent" % ref)
        r = git("diff", "--name-only", "%s...%s" % (prev.stdout.strip(), ref))
        if r.returncode != 0:
            raise RangeUnknown("could not diff the pushed range in %s" % repo_dir)
        return [l for l in r.stdout.splitlines() if l.strip()]

    ranges = [rev_range] if rev_range else ["@{upstream}...HEAD",
                                            "origin/develop...HEAD",
                                            "origin/main...HEAD"]
    for rng in ranges:
        r = git("diff", "--name-only", rng)
        if r.returncode == 0:
            return [l for l in r.stdout.splitlines() if l.strip()]
    raise MapError("could not compute a diff range in %s" % repo_dir)


def main(argv):
    args = list(argv[1:])
    as_json = "--json" in args
    use_stdin = "--stdin" in args
    pushed = "--pushed" in args
    committed = "--committed" in args
    args = [a for a in args if a not in ("--json", "--stdin", "--pushed", "--committed")]

    repo_dir, rev_range, repo_name, branch = None, None, "", ""
    rest = []
    i = 0
    while i < len(args):
        if args[i] == "--repo" and i + 1 < len(args):
            repo_dir = args[i + 1]; i += 2
        elif args[i] == "--range" and i + 1 < len(args):
            rev_range = args[i + 1]; i += 2
        elif args[i] == "--repo-name" and i + 1 < len(args):
            repo_name = args[i + 1]; i += 2
        elif args[i] == "--branch" and i + 1 < len(args):
            branch = args[i + 1]; i += 2
        else:
            rest.append(args[i]); i += 1

    here = os.path.dirname(os.path.abspath(__file__))
    qa = os.path.dirname(here)
    # E2E_SELECT_MAP is a test/manual override; an empty value means "unset", so
    # a caller can pass it through unconditionally without special-casing.
    map_path = (os.environ.get("E2E_SELECT_MAP") or "").strip() \
        or os.path.join(qa, "config", "feature-map.yaml")
    agents_dir = os.path.join(qa, "agents")

    try:
        if use_stdin:
            paths = [l for l in sys.stdin.read().splitlines() if l.strip()]
        elif repo_dir and committed:
            paths = committed_files(repo_dir)
        elif repo_dir:
            paths = changed_files(repo_dir, rev_range, pushed=pushed)
            repo_name = repo_name or os.path.basename(os.path.abspath(repo_dir))
        else:
            paths = rest

        fmap = load_map(map_path, agents_dir)

        # FULL-SUITE PROMOTION short-circuits the diff entirely. On a
        # develop -> main promotion the question is not "what did this merge
        # touch" (a merge touches nothing of its own) but "is the whole surface
        # still good before prod" — so the map's answer replaces the selection
        # rather than being merged with it.
        full = None
        if repo_dir:
            remote = subprocess.run(
                ["git", "-C", repo_dir, "remote", "get-url", "origin"],
                capture_output=True, text=True).stdout.strip()
            br = branch or subprocess.run(
                ["git", "-C", repo_dir, "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True).stdout.strip()
            full = wants_full_suite(fmap, remote, br)
        if full:
            sel = select([], fmap, load_feature_order(agents_dir))
            sel.full_suite = full
        else:
            sel = select(paths, fmap, load_feature_order(agents_dir))
    except RangeUnknown as e:
        # Unknown is not empty. Fall back to the SAFE subset and say why.
        print("[e2e-select] %s" % e, file=sys.stderr)
        fmap = load_map(map_path, agents_dir)
        sel = select([], fmap, load_feature_order(agents_dir), range_unknown=True)
    except MapError as e:
        print("[e2e-select] cannot decide: %s" % e, file=sys.stderr)
        return CANNOT_DECIDE
    except OSError as e:
        print("[e2e-select] cannot decide: %s" % e, file=sys.stderr)
        return CANNOT_DECIDE

    if as_json:
        print(json.dumps(sel.to_dict(), indent=2))
    else:
        out = render_text(sel, repo=repo_name)
        if out:
            print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
