#!/usr/bin/env python3
"""spec_sync — assemble the BRIEF for the commit-triggered Gherkin sync.

    commit  →  select_e2e (which features)  →  spec_sync (what the agent needs)
            →  agent authors/edits .feature  →  validate_specs  →  /niete-e2e

This module is the DETERMINISTIC half. It makes no judgement about test design —
it gathers, per selected feature, exactly four things and stops:

    1. which changed files made that feature light up, and whether they are its
       OWN files or a shared fan-out
    2. the diff of those files, BOUNDED
    3. the scenarios the spec already has
    4. what to do with it: create · update · validate-only

The judgement half is the agent, following .claude/skills/gherkin-spec-sync.
Splitting it this way is the same reasoning as select_e2e: the part that can be
wrong in a checkable way is code with tests; the part that needs taste is a skill.

USAGE
    spec_sync.py --repo <dir> --committed [--json]   # the HEAD commit
    spec_sync.py --repo <dir> --pushed               # what a just-completed push sent
    spec_sync.py --repo <dir> --range A...B
    spec_sync.py --selection <file.json> --repo <dir>   # reuse a selection already made
    spec_sync.py --selection - --repo <dir> --committed  # ... read it from stdin

The `--selection -` form is what the hook uses. It has ALREADY computed the
selection to decide which `/niete-e2e` commands to arm, and recomputing here
would open the door to the two halves disagreeing about which features a commit
touched — arming a run for one set and authoring specs for another.

EXIT CODES  (advisory, like select_e2e — a briefer that blocks for its own
reasons gets switched off within a day)
    0  fine, whether or not anything needs syncing
    3  could not decide (no PyYAML, bad map, git range unresolvable)

WHY THE DIFF IS BOUNDED, always.
A 4,000-line refactor commit would otherwise put 4,000 lines of diff in front of
the agent for EACH of nine fan-out features. The cap is per feature and the brief
says when it bit, so the agent can go read the file itself rather than silently
working from a third of a change.

WHY `only_shared` EXISTS.
`bot/shared/services/whatsapp.service.js` maps to `"*"` — every feature. A logging
tweak there selects nine features, and without a flag saying "nothing of YOUR
surface changed, you were pulled in by a shared file" the honest response (leave
the spec alone) is indistinguishable from the wrong one (rewrite it).
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

CANNOT_DECIDE = 3
SPEC_DIR = os.path.join("tests", "features", "whatsapp", "niete")
DEFAULT_MAX_DIFF_LINES = 400

# Actions the agent can be handed for one feature.
CREATE = "create"                # selected, but no .feature exists — new surface
UPDATE = "update"                # source changed under an existing spec
VALIDATE_ONLY = "validate-only"  # nothing to author: the spec itself was the edit,
                                 # or this is a full-suite promotion


# ── diff bounding ────────────────────────────────────────────────────────────

def truncate(text, max_lines):
    """(text, was_truncated). Keeps the FIRST max_lines and names what it dropped."""
    if not text:
        return "", False
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text, False
    dropped = len(lines) - max_lines
    kept = lines[:max_lines]
    kept.append("... [%d more diff lines truncated — read the files directly if the "
                "change is bigger than it looks]" % dropped)
    return "\n".join(kept), True


# ── the spec inventory ───────────────────────────────────────────────────────

def read_spec(spec_dir, feature):
    """(exists, [{name, tags, line}]) for <feature>.feature."""
    path = os.path.join(spec_dir, feature + ".feature")
    if not os.path.isfile(path):
        return False, []
    try:
        import validate_specs
        doc = validate_specs.parse(path)
    except Exception:
        return True, []
    return True, [{"name": s["name"], "line": s["line"],
                   "tags": ["@" + t for t in s["tags"]]} for s in doc["scenarios"]]


# ── the brief ────────────────────────────────────────────────────────────────

def build_brief(selection, spec_dir, differ, max_diff_lines=DEFAULT_MAX_DIFF_LINES,
                repo="", rev_range="", commit_sha=""):
    """Turn a select_e2e Selection dict into the agent's working brief.

    `differ(paths) -> str` is injected so this stays pure and testable; the CLI
    passes a git-backed one.
    """
    reasons = selection.get("reasons") or {}
    features = list(selection.get("features") or [])
    full_suite = selection.get("full_suite")

    # A full-suite promotion asks a different question — "is the whole surface
    # still good" — and its diff is a merge, i.e. nothing of its own. So it
    # authors nothing and validates everything that exists.
    if full_suite and not features:
        features = sorted(
            os.path.basename(p)[:-len(".feature")]
            for p in os.listdir(spec_dir) if p.endswith(".feature")
        ) if os.path.isdir(spec_dir) else []

    out = []
    for feature in features:
        rs = reasons.get(feature) or []
        changed = [{"path": r.get("path"), "pattern": r.get("pattern"),
                    "shared": bool(r.get("shared")), "kind": r.get("kind")}
                   for r in rs]

        source_paths = [c["path"] for c in changed if c["kind"] != "spec"]
        spec_edits = [c["path"] for c in changed if c["kind"] == "spec"]

        exists, scenarios = read_spec(spec_dir, feature)

        if full_suite:
            action = VALIDATE_ONLY
        elif not exists:
            action = CREATE
        elif not source_paths and spec_edits:
            # The .feature file IS the change. Re-authoring it would churn a
            # human's edit; it still has to pass the gate.
            action = VALIDATE_ONLY
        else:
            action = UPDATE

        diff, truncated = truncate(differ(source_paths) if source_paths else "",
                                   max_diff_lines)

        out.append({
            "feature": feature,
            "spec_path": os.path.join(SPEC_DIR, feature + ".feature"),
            "spec_exists": exists,
            "action": action,
            "scenario_count": len(scenarios),
            "scenarios": scenarios,
            "changed_files": changed,
            "only_shared": bool(changed) and all(c["shared"] for c in changed),
            "diff": diff,
            "diff_truncated": truncated,
        })

    return {
        "version": 1,
        "repo": repo,
        "range": rev_range,
        # The commit this brief authors for, and whether phase 1 has RELEASED it.
        # The release gate (release/pending_release below) keys off these: a run
        # is held until a validated sync writes a per-commit stamp. Empty
        # commit_sha = a brief built before the gate existed → never held.
        "commit_sha": commit_sha,
        "released": False,
        "spec_dir": SPEC_DIR,
        "full_suite": full_suite,
        "sync_needed": bool(out),
        "features": out,
        # In-scope files the map claims nothing about. The sync is the only step
        # that reads both the code and the map, so it is where the drift shows.
        "map_gaps": list(selection.get("unmapped") or []),
        "fallback": bool(selection.get("fallback")),
        "fallback_reason": selection.get("fallback_reason") or "",
    }


# ── git-backed differ ────────────────────────────────────────────────────────

def diff_command(repo_dir, paths, committed=False, rev_range=""):
    """The git command for a diff. Pure, so the choice below is testable.

    A COMMIT uses `git show HEAD`, not `git diff HEAD~1..HEAD`, for the same
    reason `select_e2e.committed_files` does: `HEAD~1` explodes on a root commit,
    and `show` handles it. Getting this wrong produces an empty diff and a brief
    that looks like "nothing changed" — the silent under-selection this whole
    pipeline is built to avoid.
    """
    base = ["git", "-C", repo_dir]
    if committed:
        return base + ["show", "--format=", "--unified=3", "HEAD", "--"] + list(paths)
    cmd = base + ["diff", "--unified=3"]
    if rev_range:
        cmd.append(rev_range)
    return cmd + ["--"] + list(paths)


def git_differ(repo_dir, committed=False, rev_range=""):
    """FAILS SILENT. A diff we could not read is not evidence of anything, and the
    brief is still useful without it — the file list alone tells the agent where
    to look."""
    def differ(paths):
        if not paths:
            return ""
        try:
            r = subprocess.run(diff_command(repo_dir, paths, committed, rev_range),
                               capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return ""
        return r.stdout or ""
    return differ


def render(brief):
    """Human-readable summary. The JSON is what the hook writes; this is for eyes."""
    if not brief["sync_needed"]:
        return "spec-sync: nothing selected — no Gherkin work for this change."
    lines = ["spec-sync brief — %s %s" % (brief["repo"] or "?", brief["range"] or "")]
    for f in brief["features"]:
        note = " (pulled in only by SHARED files)" if f["only_shared"] else ""
        lines.append("  %-14s %-13s %2d scenario(s), %d changed file(s)%s"
                     % (f["feature"], f["action"], f["scenario_count"],
                        len(f["changed_files"]), note))
    if brief["map_gaps"]:
        lines.append("  map gaps (feature-map.yaml is behind the code):")
        lines += ["    " + p for p in brief["map_gaps"]]
    return "\n".join(lines)


# ── the release gate ─────────────────────────────────────────────────────────
#
# select_e2e/spec_sync/validate_specs all only ADVISE; nothing mechanically stood
# between an unsynced spec and a driven suite. The release is that joint, and it
# is deliberately minimal: /sync-specs ends by calling `--release <brief>`, which
# re-runs the validator and, ONLY on exit 0, writes a per-commit stamp
# (`released-<sha>.json`). The two runners (commit-e2e.sh, run-suite.sh) call
# `--pending` first and refuse (exit 4) while a stamp is missing.
#
# WHY A STAMP AND NOT JUST THE BRIEF'S `released` FLAG. commit-e2e.sh deletes and
# REBUILDS its brief on every run, so the flag is always False by the time the
# runner looks. The stamp is keyed by commit, survives the rebuild, and is what
# the gate actually trusts. The flag is for humans reading the brief.

RELEASE_HELD = 4   # a runner's exit code: phase 1 has not released this commit


def range_end(rev_range):
    """The commit a range points AT — `A...B` -> B, `A..B` -> B, `HEAD` -> HEAD."""
    if not rev_range:
        return ""
    for sep in ("...", ".."):
        if sep in rev_range:
            return rev_range.split(sep)[-1]
    return rev_range


def _sha_match(a, b):
    """Short/full tolerant: either sha is a prefix of the other. Empty never matches."""
    if not a or not b:
        return False
    return a.startswith(b) or b.startswith(a)


def _stamp_path(pend_dir, commit_sha):
    return os.path.join(pend_dir, "released-%s.json" % (commit_sha or "nosha"))


def _load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _authoring_features(brief):
    """Features this brief actually asks an author to touch — create/update, never
    validate-only (a spec-only edit or a full-suite promotion authors nothing)."""
    return {f["feature"] for f in (brief.get("features") or [])
            if f.get("action") in (CREATE, UPDATE)}


def _briefs(pend_dir):
    import glob as _glob
    return sorted(_glob.glob(os.path.join(pend_dir, "*.sync.json")))


def _stamps(pend_dir):
    import glob as _glob
    out = []
    for f in _glob.glob(os.path.join(pend_dir, "released-*.json")):
        st = _load(f)
        if st:
            out.append(st)
    return out


def release_stamp(pend_dir, commit_sha):
    """The release stamp covering `commit_sha`, or None."""
    for st in _stamps(pend_dir):
        if _sha_match(st.get("commit_sha") or "", commit_sha):
            return st
    return None


def release(brief_path, validator_exit, pend_dir=None):
    """Release phase 2 for a brief's commit — but ONLY if the validator passed.

    Returns 0 on release, 1 when the validator failed (nothing is written). Writes
    a per-commit stamp and marks every sibling brief for the same commit released,
    so the hook's `<session>.sync.json` and the mock lane's `mock-<sha>.sync.json`
    release together.
    """
    pend_dir = pend_dir or os.path.dirname(os.path.abspath(brief_path))
    brief = _load(brief_path) or {}
    sha = brief.get("commit_sha") or ""

    if validator_exit != 0:
        return 1

    feats = set(_authoring_features(brief))
    siblings = []
    for bp in _briefs(pend_dir):
        sb = _load(bp)
        if sb and sha and _sha_match(sb.get("commit_sha") or "", sha):
            siblings.append(bp)
            feats |= _authoring_features(sb)

    import datetime
    stamp = {
        "commit_sha": sha,
        "features": sorted(feats),
        "validator_exit": validator_exit,
        "released_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        with open(_stamp_path(pend_dir, sha), "w", encoding="utf-8") as fh:
            json.dump(stamp, fh, indent=1)
    except OSError:
        return 1

    for bp in (siblings or [brief_path]):
        sb = _load(bp)
        if sb is not None:
            sb["released"] = True
            try:
                with open(bp, "w", encoding="utf-8") as fh:
                    json.dump(sb, fh, indent=1)
            except OSError:
                pass
    return 0


def pending_release(pend_dir, features, commit_sha=None, is_relevant=None):
    """Briefs that HOLD a run for the requested `features` — unreleased, still
    needing authoring, with no covering stamp.

    Scope of which commits count:
      · commit_sha given  → only briefs for that commit (the mock lane knows its sha)
      · is_relevant given → only briefs whose sha it accepts (the chrome lane asks
        "is this sha in my history?")
      · neither            → every brief carrying a commit_sha
    A brief with no commit_sha predates the gate and is never this gate's business.
    """
    want = set(features or [])
    stamps = _stamps(pend_dir)

    def stamped(sha, feats):
        for st in stamps:
            if _sha_match(st.get("commit_sha") or "", sha) and (set(st.get("features") or []) & feats):
                return True
        return False

    held = []
    for bp in _briefs(pend_dir):
        b = _load(bp)
        if not b:
            continue
        sha = b.get("commit_sha")
        if not sha:
            continue
        if b.get("released"):
            continue
        overlap = _authoring_features(b) & want
        if not overlap:
            continue
        if commit_sha is not None:
            if not _sha_match(sha, commit_sha):
                continue
        elif is_relevant is not None:
            if not is_relevant(sha):
                continue
        if stamped(sha, overlap):
            continue
        held.append(bp)
    return held


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--repo", default="")
    ap.add_argument("--range", dest="rev_range", default="")
    ap.add_argument("--committed", action="store_true")
    ap.add_argument("--pushed", action="store_true")
    ap.add_argument("--selection", default="", help="a select_e2e --json file to reuse")
    ap.add_argument("--spec-dir", default="")
    ap.add_argument("--max-diff-lines", type=int, default=DEFAULT_MAX_DIFF_LINES)
    ap.add_argument("--json", action="store_true")
    # ── the release gate (subcommands) ──
    ap.add_argument("--release", default="",
                    help="release phase 2 for BRIEF's commit — runs the validator, "
                         "stamps only on exit 0")
    ap.add_argument("--pending", action="store_true",
                    help="print briefs still HOLDING a run for --features; exit 4 if any")
    ap.add_argument("--pend-dir", default="")
    ap.add_argument("--features", default="")
    ap.add_argument("--commit", default="")
    a = ap.parse_args(argv[1:])

    root = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
    pend_default = os.path.join(root, ".claude", ".e2e-pending")

    # ── --release BRIEF: re-validate, then stamp iff green ──
    if a.release:
        brief = _load(a.release)
        if brief is None:
            print("[spec-sync] cannot release: no brief at %s" % a.release, file=sys.stderr)
            return CANNOT_DECIDE
        feats = sorted(_authoring_features(brief))
        vexit = 0
        if feats:
            spec_dir = a.spec_dir or os.path.join(root, SPEC_DIR)
            agents_dir = os.path.join(root, ".claude", "qa", "agents")
            vexit = subprocess.call(
                [sys.executable, os.path.join(HERE, "validate_specs.py"),
                 "--spec-dir", spec_dir, "--agents-dir", agents_dir,
                 "--only", ",".join(feats)])
        rc = release(a.release, vexit, pend_dir=a.pend_dir or None)
        if rc == 0:
            print("released: %s (%s)" % (brief.get("commit_sha", "")[:12], ",".join(feats) or "validate-only"))
        else:
            print("NOT released — validator exit %d; fix the spec and re-run --release" % vexit,
                  file=sys.stderr)
        return rc

    # ── --pending: which briefs still hold a run for these features ──
    if a.pending:
        pend = a.pend_dir or pend_default
        feats = [x.strip() for x in a.features.split(",") if x.strip()]
        if a.commit:
            held = pending_release(pend, feats, commit_sha=a.commit)
        elif a.repo:
            def _rel(sha, repo=a.repo):
                import subprocess as _sp
                return _sp.call(["git", "-C", repo, "cat-file", "-e", sha + "^{commit}"],
                                stdout=_sp.DEVNULL, stderr=_sp.DEVNULL) == 0
            held = pending_release(pend, feats, is_relevant=_rel)
        else:
            held = pending_release(pend, feats)
        for h in held:
            print(h)
        return RELEASE_HELD if held else 0
    spec_dir = a.spec_dir or os.path.join(root, SPEC_DIR)

    try:
        import select_e2e
    except ImportError as e:
        print("[spec-sync] cannot decide: %s" % e, file=sys.stderr)
        return CANNOT_DECIDE

    rev_range = a.rev_range
    if a.selection:
        try:
            if a.selection == "-":
                sel = json.load(sys.stdin)
            else:
                with open(a.selection, encoding="utf-8") as fh:
                    sel = json.load(fh)
        except (OSError, ValueError) as e:
            print("[spec-sync] cannot decide: %s" % e, file=sys.stderr)
            return CANNOT_DECIDE
    else:
        if not a.repo:
            print("[spec-sync] cannot decide: --repo or --selection required", file=sys.stderr)
            return CANNOT_DECIDE
        qa = os.path.dirname(HERE)
        map_path = (os.environ.get("E2E_SELECT_MAP") or "").strip() \
            or os.path.join(qa, "config", "feature-map.yaml")
        agents_dir = os.path.join(qa, "agents")
        try:
            if a.committed:
                paths = select_e2e.committed_files(a.repo)
                rev_range = rev_range or "HEAD"
            else:
                paths = select_e2e.changed_files(a.repo, a.rev_range, pushed=a.pushed)
            fmap = select_e2e.load_map(map_path, agents_dir)
            order = select_e2e.load_feature_order(agents_dir)
            selection = select_e2e.select(paths, fmap, order)
            sel = selection.to_dict()
        except select_e2e.RangeUnknown as e:
            print("[spec-sync] %s" % e, file=sys.stderr)
            fmap = select_e2e.load_map(map_path, agents_dir)
            sel = select_e2e.select([], fmap, select_e2e.load_feature_order(agents_dir),
                                    range_unknown=True).to_dict()
        except (select_e2e.MapError, OSError) as e:
            print("[spec-sync] cannot decide: %s" % e, file=sys.stderr)
            return CANNOT_DECIDE

    differ = (git_differ(a.repo, committed=a.committed, rev_range=rev_range)
              if a.repo else (lambda paths: ""))

    # The commit this brief authors for — the release gate keys off it. `--range`
    # points AT its end (A...B -> B); `--committed` with no range means HEAD.
    commit_sha = ""
    if a.repo:
        end = range_end(rev_range) or ("HEAD" if a.committed else "")
        if end:
            r = subprocess.run(["git", "-C", a.repo, "rev-parse", "--verify", end + "^{commit}"],
                               capture_output=True, text=True)
            commit_sha = r.stdout.strip()

    brief = build_brief(sel, spec_dir, differ,
                        max_diff_lines=a.max_diff_lines,
                        repo=os.path.basename(os.path.abspath(a.repo)) if a.repo else "",
                        rev_range=rev_range, commit_sha=commit_sha)

    print(json.dumps(brief, indent=2) if a.json else render(brief))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
