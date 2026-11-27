#!/usr/bin/env python3
"""hook_notes — why a PR's E2E run is missing, in words, from what its authors' hooks recorded (bd-9157r.13.7).

Every clone with the QA hooks writes what they did to each commit (armed, declared, cleared, switched off, refused)
as a git note in refs/notes/qa-hooks, and pushes it to origin as refs/qa-hooks/<clone id> (hooks/lib/qa-ledger.sh).
qa-impact.yml fetches those into refs/notes/qa-remote/*; on a laptop the clone's own refs/notes/qa-hooks is read
too. impact.py puts the result in the PR comment's "E2E run recorded" cell, which used to say only "missing".

    events_by_commit(repo, shas)  -> {full sha: [event, …]}   from every notes ref above
    commits_in(repo, rng)         -> [full sha, …]              the commits a PR range brings
    why_no_run(by_commit, feature) -> one short line for the table cell

The commonest answer is no note at all: the author's machine never reported, so its hooks are not installed or not
linked. That is said plainly, with the command that tells the author which link is broken.
"""
import json
import re
import subprocess

LOCAL_REF = "refs/notes/qa-hooks"
REMOTE_PREFIX = "refs/notes/qa-remote/"
MAX_LEN = 260
DOCTOR = "`bash .claude/qa/engine/bin/e2e-doctor.sh <clone> --publish`"


def _git(repo, *a, stdin=None):
    return subprocess.run(["git", "-C", repo, *a], input=stdin, capture_output=True, text=True)


def _note_refs(repo):
    refs = _git(repo, "for-each-ref", "--format=%(refname)", REMOTE_PREFIX).stdout.split()
    if _git(repo, "rev-parse", "--verify", "-q", LOCAL_REF).returncode == 0:
        refs.append(LOCAL_REF)
    return refs


def events_by_commit(repo, shas):
    """{sha: [event dicts]} for the given commits, from every published clone and this clone's own notes."""
    want = set(shas)
    out = {}
    for ref in _note_refs(repo):
        pairs = [l.split() for l in _git(repo, "notes", "--ref=" + ref, "list").stdout.splitlines() if l.strip()]
        pairs = [(blob, c) for blob, c in pairs if c in want]
        for blob, commit in pairs:
            body = _git(repo, "cat-file", "-p", blob).stdout
            for line in body.splitlines():
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if isinstance(e, dict):
                    out.setdefault(commit, []).append(e)
    return out


def commits_in(repo, rng):
    """The commits a range brings: base...head means those on the head side only, as a PR shows them."""
    args = ["rev-list"] + (["--right-only"] if "..." in rng else []) + [rng]
    r = _git(repo, *args)
    return r.stdout.split() if r.returncode == 0 else []


def _features(e):
    m = re.search(r"features=([\w,-]*)", e.get("detail") or "")
    return {x for x in m.group(1).split(",") if x} if m else set()


def _declared(e):
    """(features or {'*'}, why) of a `declared` event: '<f,g>=none-needed (<why>)' or '*=none-needed (<why>)'."""
    d = e.get("detail") or ""
    head, _, rest = d.partition("none-needed")
    names = {x.strip() for x in head.rstrip("= ").split(",") if x.strip()} or {"*"}
    return names, rest.strip().strip("()").strip()


def _clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("|", "/")).strip()


def _cap(s):
    s = _clean(s)
    return s if len(s) <= MAX_LEN else s[:MAX_LEN - 1].rstrip() + "…"


def why_no_run(by_commit, feature):
    """One line: why no E2E run was recorded for `feature`, from the PR commits' hook events."""
    events = [e for evs in (by_commit or {}).values() for e in evs]
    if not events:
        return _cap("no hook record: the author's machine never reported (hooks not installed or not linked). "
                    "Check: %s" % DOCTOR)

    def first(name):
        return next((e for e in events if e.get("event") == name), None)

    e = first("switch-off")
    if e:
        return _cap("QA hooks were switched off on the author's machine (%s)" % (e.get("switch") or "a QA switch"))
    if first("spec-stale"):
        return _cap("the run was refused: the scenarios for this change were not written first (SPEC FIRST)")
    if first("driver-missing"):
        return _cap("the run was refused: a new scenario has no driver code yet (DRIVER FIRST)")
    for e in events:
        if e.get("event") == "declared":
            names, why = _declared(e)
            if "*" in names or feature in names:
                return _cap("skipped: marked no new scenarios needed on the author's laptop, not in the PR: %s"
                            % (why or "no reason given"))
    if first("gave-up"):
        return _cap("a run was set up, the session hook asked, then gave up; nothing was driven")
    if first("force-cleared"):
        return _cap("the pending run was cleared by hand (--force) without driving it")
    armed = [e for e in events if e.get("event") == "armed" and (not _features(e) or feature in _features(e))]
    if armed:
        if first("cleared"):
            return _cap("a run was set up, then cleared without driving it")
        if all(e.get("hook") == "post-commit" for e in armed):
            return _cap("committed from a terminal: a run was set up, but no run was recorded on this branch")
        return _cap("a run was set up in a Claude session, but no run was recorded on this branch")
    return _cap("the author's hooks ran on these commits but never set up a run for %s" % feature)
