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
import tenants_lite as _tl


def _spec_rel(spec_dir):
    """The spec dir RELATIVE to the repo root, for the brief's `spec_path`/`spec_dir` fields.

    From tenants.yaml when a manifest resolves (CLAUDE_PROJECT_DIR or the cwd's ancestors); otherwise the
    conventional tests/features/whatsapp/<basename of spec_dir> — the unit tests hand this module a temp
    directory and no repo (bd-9157r)."""
    try:
        return _tl.load(_tl.repo_root()).spec_dir
    except _tl.ManifestError:
        return os.path.join("tests", "features", "whatsapp", os.path.basename(os.path.normpath(spec_dir)))
DEFAULT_MAX_DIFF_LINES = 400

# Actions the agent can be handed for one feature.
CREATE = "create"                # selected, but no .feature exists — new surface
UPDATE = "update"                # source changed under an existing spec
VALIDATE_ONLY = "validate-only"  # nothing to author: the spec itself was the edit,
                                 # or this is a full-suite promotion

# ...and the one that is handed per FILE rather than per feature.
MAP_GAP = "map-gap"              # in-scope code no rule claims — attribute it,
                                 # then author into the spec that ends up owning it


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
                repo="", rev_range=""):
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
            "spec_path": os.path.join(_spec_rel(spec_dir), feature + ".feature"),
            "spec_exists": exists,
            "action": action,
            "scenario_count": len(scenarios),
            "scenarios": scenarios,
            "changed_files": changed,
            "only_shared": bool(changed) and all(c["shared"] for c in changed),
            "diff": diff,
            "diff_truncated": truncated,
        })

    # ── map gaps ─────────────────────────────────────────────────────────────
    #
    # In-scope files the map claims nothing about. The sync is the only step that
    # reads both the code and the map, so it is where the drift shows.
    #
    # These used to be a flat list of strings on `map_gaps` and nothing else, and
    # `sync_needed` was `bool(out)` — features only. A commit whose diff was
    # ENTIRELY unmapped therefore produced no features, `sync_needed: false`, no
    # brief from the hook, and `/sync-specs` printing "nothing selected — no
    # Gherkin work for this change". The worked example that forced this fix was a
    # change to `bot/vendor/lp-v9/**` — the lesson-plan render engine, behind the
    # busiest teacher-facing surface in the deployment — which sailed through with
    # no spec because its files were hard to attribute, not unimportant.
    #
    # That is backwards. Being unclaimed by the map is not evidence a change is
    # inert; it is the absence of evidence either way, and the only honest
    # response is to make somebody look. So a gap is now WORK — it carries its
    # own bounded diff, it names the action, and it makes the sync needed on its
    # own, with no feature selected at all.
    #
    # What it deliberately does NOT do is decide the answer. `MAP_GAP` means
    # "attribute this", and the agent follows gherkin-spec-sync §5: inspect the
    # behaviour, and if an existing surface owns it, add the map entry and author
    # into that spec; only a genuinely new surface earns a new .feature (plus its
    # agent, or validate_specs raises E-NOAGENT). Guessing that here — from a
    # path and a diff, with no view of the nine specs' contents — is exactly the
    # judgement this module exists not to make.
    gaps = []
    for path in (selection.get("unmapped") or []):
        gap_diff, gap_truncated = truncate(differ([path]), max_diff_lines)
        gaps.append({
            "path": path,
            "action": MAP_GAP,
            "diff": gap_diff,
            "diff_truncated": gap_truncated,
        })

    return {
        "version": 1,
        "repo": repo,
        "range": rev_range,
        "spec_dir": _spec_rel(spec_dir),
        "full_suite": full_suite,
        "sync_needed": bool(out) or bool(gaps),
        "features": out,
        "gaps": gaps,
        # Every feature that HAS a spec today. Step 1 of attributing a gap is
        # "does an appropriate .feature already exist?", and the agent should not
        # have to list a directory to answer it.
        "existing_features": sorted(
            os.path.basename(p)[:-len(".feature")]
            for p in os.listdir(spec_dir) if p.endswith(".feature")
        ) if os.path.isdir(spec_dir) else [],
        # The flat list stays: the hook and the skill already read it.
        "map_gaps": [g["path"] for g in gaps],
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
    if brief.get("gaps"):
        # Named as work, with the verb in it. "map gaps:" read as a footnote and
        # was treated as one; a gap is the one item here that can still end in a
        # brand-new .feature file.
        lines.append("  MAP GAPS — attribute each, then author into whichever spec "
                     "ends up owning it (gherkin-spec-sync §5):")
        for g in brief["gaps"]:
            lines.append("    %-13s %s%s" % (g["action"], g["path"],
                                             "  [diff truncated]" if g["diff_truncated"] else ""))
        if brief.get("existing_features"):
            lines.append("    existing specs: " + ", ".join(brief["existing_features"]))
    return "\n".join(lines)


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
    a = ap.parse_args(argv[1:])

    # The repo is the one carrying tenants.yaml (--repo, CLAUDE_PROJECT_DIR, or the cwd's ancestors),
    # never this vendored file's own location.
    try:
        _m = _tl.load(_tl.repo_root(a.repo or None))
    except _tl.ManifestError as e:
        print("[spec-sync] cannot decide: %s" % e, file=sys.stderr)
        return 1
    root = _m.root
    spec_dir = a.spec_dir or os.path.join(root, _m.spec_dir)

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
        qa = os.path.join(root, ".claude", "qa")
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
    brief = build_brief(sel, spec_dir, differ,
                        max_diff_lines=a.max_diff_lines,
                        repo=os.path.basename(os.path.abspath(a.repo)) if a.repo else "",
                        rev_range=rev_range)

    print(json.dumps(brief, indent=2) if a.json else render(brief))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
