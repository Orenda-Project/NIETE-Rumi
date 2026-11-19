#!/usr/bin/env python3
"""PreToolUse hook: check a schema/migration file's PROSPECTIVE content — the
text it would have immediately after this Edit/Write is applied, not what's
already on disk — against the shared validator (../scripts/validate_schema.py),
so a NON-NEGOTIABLE violation is caught live, while the file is being written,
not first at commit time (that's schema-change-gate.sh's job, and stays in
place as the backstop for anything this hook misses — a human editing outside
Claude Code, a file this hook was never told about, etc.).

Fires on Edit and Write (matcher in ../hooks.json). MultiEdit is not handled —
this pack's Claude Code environment doesn't expose that tool at the time this
was written; if it's ever added, extend _prospective_content() rather than
silently missing it.

Deliberately strict, per an explicit decision: this BLOCKS the very Edit/Write
call that would introduce a confirmed violation, even mid-build — e.g. writing
a complete `CREATE TABLE ... );` with no primary key is blocked the instant
that statement is written, not just when someone later tries to commit it.
This is safe against "half-typed SQL" false positives only because the
validator's own table-block matcher (find_create_table_blocks) requires a
CLOSED, terminated statement — a closing paren followed by a semicolon — so
an in-progress, unclosed CREATE TABLE (still being built up across several
Edit calls) never matches at all and can never trip a finding. What DOES get
blocked is a *complete-looking* statement that's missing something
mandatory, written in one shot.

Exit codes (PreToolUse contract):
    0  no blocking violations (or nothing relevant to check, or a validated
       bypass) — the Edit/Write proceeds
    2  confirmed blocking violation(s) — the Edit/Write is refused

Bypass — same mechanism and same validated-reason requirement as the
commit-time gate (see schema-change-gate.sh and bypass_audit.py); this hook
does NOT invent a second bypass variable:
    export TALEEMABAD_DATA_STANDARDS_BYPASS="INC-4821: hotfix, D4 finding is a false positive on a UUID column, approved by data-eng lead"
A bypass here is recorded the same way (bypass_audit.py --record), against
the repo's current HEAD (there is no new commit yet at edit time — the
commit-time gate will independently record its own bypass, if any, against
the commit that actually results).

Slack notification: same notify.py path as the commit-time gate, same
fire-and-forget contract (never adds latency, never affects the block
decision, silently swallowed on any failure).

Governance reporting: every check of a schema-relevant file is reported to
data-gate-telemetry — PASS, FAIL and BYPASSED alike, same reasoning as the
commit-time gate (a board that only sees failures makes every repo look like
it fails constantly). Tagged report_ref "live-edit:<file>" so the board can
tell an edit-time check from a commit-time one. A file that isn't
schema-relevant was never checked, so it is not reported.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK_DIR = Path(__file__).resolve().parent
SKILL_DIR = HOOK_DIR.parent
SCRIPTS = SKILL_DIR / "scripts"
sys.path.insert(0, str(SCRIPTS))

DETECTOR = SCRIPTS / "detect_schema_changes.py"
BYPASS_AUDIT = SCRIPTS / "bypass_audit.py"
NOTIFY = SCRIPTS / "notify.py"


def _read_stdin_json() -> dict:
    try:
        return json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return {}


def _prospective_content(tool_name: str, tool_input: dict) -> tuple[str, str] | None:
    """Returns (file_path, prospective_text) for a tool call that would
    write a file's content, or None if this tool call doesn't (wrong tool,
    missing fields — fail OPEN, never guess at a shape we don't recognize)."""
    file_path = tool_input.get("file_path")
    if not file_path:
        return None

    if tool_name == "Write":
        content = tool_input.get("content")
        if content is None:
            return None
        return file_path, content

    if tool_name == "Edit":
        old_string = tool_input.get("old_string")
        new_string = tool_input.get("new_string")
        if old_string is None or new_string is None:
            return None
        try:
            current = Path(file_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            # A brand-new file: Edit requires old_string="" against an
            # existing file in normal use, but if the file genuinely isn't
            # on disk yet, there's nothing to prepend to new_string — treat
            # the prospective content as just the replacement text.
            current = ""
        if tool_input.get("replace_all"):
            prospective = current.replace(old_string, new_string)
        else:
            prospective = current.replace(old_string, new_string, 1)
        return file_path, prospective

    return None


def _is_schema_relevant(file_path: str) -> bool:
    try:
        proc = subprocess.run(
            [sys.executable, str(DETECTOR), "--files", file_path],
            capture_output=True, text=True, timeout=10,
        )
        result = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        # Detector itself is broken — fail OPEN. A live hook that can crash
        # every Edit/Write in the repo on a detector bug is worse than one
        # that occasionally misses a check; the commit-time gate is the
        # backstop that still runs the real detector before anything merges.
        return False
    return bool(result.get("relevant"))


def _actor() -> str:
    try:
        git_email = subprocess.run(
            ["git", "config", "user.email"], capture_output=True, text=True,
        ).stdout.strip()
    except OSError:
        git_email = ""
    return (os.environ.get("TALEEMABAD_USER_EMAIL")
            or git_email
            or os.environ.get("USER")
            or os.environ.get("USERNAME")
            or "unknown")


def _notify_slack(event: str, actor: str, result: str, file_path: str, summary: str = "") -> None:
    branch, commit = _live_edit_where()
    try:
        subprocess.Popen(
            [sys.executable, str(NOTIFY), "slack", "--event", event,
             "--repo", Path.cwd().name, "--branch", branch, "--commit", commit,
             "--changed-objects", file_path, "--actor", actor, "--result", result,
             *(["--summary", summary] if summary else [])],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def _system_message(text: str) -> None:
    """A message the PERSON sees, on exit 0. Claude Code shows a PreToolUse
    hook's stderr only when it blocks, so a pass would otherwise be invisible
    — and a gate you never see run is indistinguishable from one that isn't
    installed. json.dumps escapes non-ASCII, so no console codepage can break it."""
    print(json.dumps({"systemMessage": text}), flush=True)


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True,
                              timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def _live_edit_where() -> tuple[str, str]:
    """(branch, commit) for a live-edit report. Nothing is committed yet, so
    the commit is the one the edit sits ON TOP OF — labelled as such, never
    passed off as the commit that will contain it."""
    branch = _git("rev-parse", "--abbrev-ref", "HEAD") or "unknown"
    head = _git("rev-parse", "--short", "HEAD")
    return (f"{branch} (live edit, not yet committed)",
            f"on top of {head}" if head else "no commits yet")


def _notify_governance(result: str, actor: str, file_path: str,
                       findings: list[dict] | None = None, bypass_reason: str = "",
                       summary: str = "") -> None:
    """Fire-and-forget, same contract as _notify_slack: never adds latency,
    never affects the block decision."""
    toplevel = _git("rev-parse", "--show-toplevel")
    repo = Path(toplevel).name if toplevel else Path.cwd().name
    try:
        rel_path = os.path.relpath(file_path, toplevel) if toplevel else file_path
    except ValueError:
        rel_path = file_path
    rel_path = rel_path.replace(os.sep, "/")
    cmd = [sys.executable, str(NOTIFY), "governance",
           "--repo", repo,
           "--branch", _git("rev-parse", "--abbrev-ref", "HEAD") or "unknown",
           "--head-sha", _git("rev-parse", "HEAD") or "unknown",
           "--actor", actor, "--result", result,
           "--changed-files", rel_path,
           "--report-ref", f"live-edit:{rel_path}"]
    if findings:
        cmd += ["--issue-ids", ",".join(sorted({f["standard"] for f in findings}))]
    if summary:
        cmd += ["--summary", summary]
    if bypass_reason:
        cmd += ["--bypass-reason", bypass_reason]
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass


def _enter_file_repo(file_path: str) -> str:
    """Run the rest of this hook from the edited file's own repository and
    return the file's path relative to that repo's root.

    A hook runs in the Claude session's working directory, which is often a
    different repo from the file being edited (a workspace repo editing a
    product repo). Everything here that asks git or reads repo config — the
    repo name and branch in reports, the actor's git email, the default-branch
    "before" content, the table contracts — has to see the FILE's repo, or
    reports name the wrong repo and checks read the wrong contracts. Outside
    any git repo, nothing changes and the path is returned absolute."""
    path = Path(file_path)
    if os.name == "nt" and len(file_path) > 2 and file_path[0] == "/" and file_path[1].isalpha() and file_path[2] == "/":
        path = Path(f"{file_path[1].upper()}:{file_path[2:]}")  # Git Bash form /d/x -> D:/x
    if not path.is_absolute():
        path = Path.cwd() / path
    directory = path.parent
    while not directory.exists() and directory != directory.parent:
        directory = directory.parent
    try:
        toplevel = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=directory,
                                  capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        toplevel = ""
    if not toplevel:
        return str(path)
    os.chdir(toplevel)
    try:
        return os.path.relpath(path, toplevel).replace(os.sep, "/")
    except ValueError:
        return str(path)


def main() -> int:
    data = _read_stdin_json()
    tool_name = data.get("tool_name")
    if tool_name not in ("Edit", "Write"):
        return 0

    tool_input = data.get("tool_input") or {}
    parsed = _prospective_content(tool_name, tool_input)
    if parsed is None:
        return 0
    file_path, prospective_text = parsed
    file_path = _enter_file_repo(file_path)

    if not _is_schema_relevant(file_path):
        return 0

    import validate_schema  # local import: sys.path was set up above

    # Judged against the file as it is now, so only what this edit ADDS can
    # block; problems already in the file are reported as existing.
    on_disk = Path(file_path)
    try:
        before = on_disk.read_text(encoding="utf-8", errors="replace") if on_disk.is_file() else ""
    except OSError:
        before = ""
    folder = on_disk.parent if str(on_disk.parent) else Path(".")
    siblings = sorted({p.name for p in folder.iterdir()} | {on_disk.name}) if folder.is_dir() else [on_disk.name]
    judged = validate_schema.judge_change(file_path, before, prospective_text, siblings)
    findings, warnings = judged["findings"], judged["warnings"]
    summary = validate_schema.summary_text(judged)
    actor = _actor()
    if not findings:
        if warnings:
            _notify_governance("PASS WITH WARNINGS", actor, file_path, warnings, summary=summary)
            _notify_slack("warn", actor, "PASS with warnings (live edit)", file_path, summary)
            whys = {}
            for f in warnings:
                whys.setdefault(f["check"], f.get("why") or "")
            lines = [f"⚠ DATA STANDARDS: {file_path} — PASS with warnings (these do not block):"]
            lines += [f"  • {f['standard']}: {f['finding']}" for f in warnings]
            lines += [f"  why {c} only warns: {w}" for c, w in whys.items() if w]
            _system_message("\n".join(lines))
            return 0
        _notify_governance("PASS", actor, file_path, summary=summary if judged["existing"] else "")
        _notify_slack("pass", actor, "PASS (live edit)", file_path)
        _system_message(f"✓ DATA STANDARDS: {file_path} checked — PASS, no NON-NEGOTIABLE violations.")
        return 0

    bypass_reason = os.environ.get("TALEEMABAD_DATA_STANDARDS_BYPASS", "")

    if bypass_reason:
        check = subprocess.run(
            [sys.executable, str(BYPASS_AUDIT), "--check", bypass_reason],
            capture_output=True, text=True,
        )
        if check.returncode == 0:
            report_tmp = Path(tempfile.gettempdir()) / f".data-standards-live-{os.getpid()}.json"
            try:
                report_tmp.write_text(json.dumps({"findings": findings}), encoding="utf-8")
                subprocess.run(
                    [sys.executable, str(BYPASS_AUDIT), "--record", "--repo", ".",
                     "--reason", bypass_reason, "--actor", actor,
                     "--findings-json", str(report_tmp)],
                    capture_output=True, text=True,
                )
            finally:
                report_tmp.unlink(missing_ok=True)
            print("DATA STANDARDS (live edit): BYPASSED — a validated reason was provided and recorded.", file=sys.stderr)
            print(f"  file:   {file_path}", file=sys.stderr)
            print(f"  reason: {bypass_reason}", file=sys.stderr)
            print(f"  actor:  {actor}", file=sys.stderr)
            _notify_slack("bypass", actor, f"BYPASSED (live edit): {bypass_reason}", file_path, summary)
            _notify_governance("BYPASSED", actor, file_path, findings, bypass_reason, summary)
            _system_message(f"⚠ DATA STANDARDS: violations in {file_path} BYPASSED with a recorded reason — {bypass_reason}")
            return 0
        print(f"DATA STANDARDS (live edit): bypass REJECTED — {check.stdout.strip()}", file=sys.stderr)
        print("  TALEEMABAD_DATA_STANDARDS_BYPASS was set, but its reason did not pass validation,", file=sys.stderr)
        print("  so no bypass is in effect. Falling through to the normal check below.", file=sys.stderr)
        print("", file=sys.stderr)

    print(f"DATA STANDARDS (live edit): blocking — confirmed violation(s) in {file_path}.", file=sys.stderr)
    print("", file=sys.stderr)
    for f in findings:
        table = f.get("table")
        loc = f" table `{table}`" if table else ""
        print(f"  {f['standard']} ({f['confidence']}){loc}: {f['finding']}", file=sys.stderr)
    for f in warnings:
        print(f"  warning (does not block) {f['standard']}: {f['finding']}", file=sys.stderr)
    print("", file=sys.stderr)
    print("See skills/data-standards/reference/enforcement-policy.md for what blocks vs.", file=sys.stderr)
    print("what's advisory. Fix the finding(s) above, or bypass with an approved reason:", file=sys.stderr)
    print('export TALEEMABAD_DATA_STANDARDS_BYPASS="<a real reason — ticket, incident, or named approver>"', file=sys.stderr)
    _notify_slack("validation_failure", actor, "FAIL (live edit)", file_path, summary)
    _notify_governance("FAIL", actor, file_path, findings, summary=summary)
    return 2


if __name__ == "__main__":
    sys.exit(main())
