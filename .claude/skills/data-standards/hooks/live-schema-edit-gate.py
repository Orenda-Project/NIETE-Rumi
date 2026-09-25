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


def _notify_slack(event: str, actor: str, result: str, file_path: str) -> None:
    try:
        subprocess.Popen(
            [sys.executable, str(NOTIFY), "slack", "--event", event,
             "--repo", Path.cwd().name, "--branch", "(live edit, not yet committed)",
             "--changed-objects", file_path, "--actor", actor, "--result", result],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except OSError:
        pass


def _emit(result: str, findings: list) -> None:
    """Record this firing. The local append is synchronous; only the network
    send (when an endpoint is configured) is detached inside gate_telemetry.
    Never raises — telemetry must never change the verdict."""
    try:
        from gate_telemetry import emit  # sys.path has SCRIPTS
        emit("live-edit", "data-standards", result,
             standards=[f.get("standard") for f in findings if f.get("standard")],
             findings=len(findings), files=1)
    except Exception:  # noqa: BLE001
        pass


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

    if not _is_schema_relevant(file_path):
        return 0

    from validate_schema import validate_text  # local import: sys.path was set up above

    findings = validate_text(file_path, prospective_text)
    if not findings:
        _emit("pass", [])
        return 0

    actor = _actor()
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
            _notify_slack("bypass", actor, f"BYPASSED (live edit): {bypass_reason}", file_path)
            _emit("bypass", findings)
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
    print("", file=sys.stderr)
    print("See skills/data-standards/reference/enforcement-policy.md for what blocks vs.", file=sys.stderr)
    print("what's advisory. Fix the finding(s) above, or bypass with an approved reason:", file=sys.stderr)
    print('export TALEEMABAD_DATA_STANDARDS_BYPASS="<a real reason — ticket, incident, or named approver>"', file=sys.stderr)
    _notify_slack("validation_failure", actor, "FAIL (live edit)", file_path)
    _emit("block", findings)
    return 2


if __name__ == "__main__":
    sys.exit(main())
