#!/usr/bin/env python3
"""Controlled bypass auditing — records WHO bypassed a data-standards gate,
WHEN, on WHAT commit, WHICH findings were bypassed, and WHY. The bypass
itself (setting an env var) is enforced by the gate scripts
(hooks/schema-change-gate.sh, install_repo_hooks.py's hooks); THIS script is
what turns "someone set an env var" into an auditable, reviewable record
instead of a silent, untracked escape hatch.

Local (Claude session / terminal) bypass:
    export TALEEMABAD_DATA_STANDARDS_BYPASS="INC-4821: hotfix for prod outage, D4 finding is a false positive on a UUID column, ticket has approval from data-eng lead"

The value must be a real reason, not a placeholder — see REJECTED_VALUES
below. A generic or empty value is rejected outright, and — as of 2026-08-19
— hooks/schema-change-gate.sh actually enforces this: it calls this script's
validate_bypass_reason() (via --check) before honoring
TALEEMABAD_DATA_STANDARDS_BYPASS, and if the reason doesn't pass, the bypass
does NOT take effect — the gate falls through to its normal check as if no
bypass had been attempted. The OLD boolean escape hatch,
CLAUDE_DATA_STANDARDS_GATE_OFF=1, no longer bypasses anything at all; the
gate hook prints a one-time notice if it's still set, pointing at this
variable instead.

Usage:
    python3 bypass_audit.py --check "INC-4821: ..."
        # exits 0 if the reason is acceptable, 1 if rejected (with why)

    python3 bypass_audit.py --record --repo . --reason "INC-4821: ..." \
        --actor "abdul.rehman@taleemabad.com" --findings-json report.json
        # validates the reason, writes an audit record, generates the full
        # report even though the bypass is in effect, and prints a summary

Audit trail (.data-standards-bypass-log.jsonl at the repo root):
    Append-only JSONL, one record per bypass, gitignored by convention (same
    as the baseline-audit cache — this is local machine-audit state, not
    something to commit; a real deployment wires this into the
    data-governance event, see CHANGELOG for that stage's status). Each
    record: timestamp, actor, repo, commit_sha, reason, bypassed_finding_ids
    (or a count if issue IDs aren't available), and whether the underlying
    audit report was successfully generated despite the bypass.

How this wires into the gates:
    hooks/schema-change-gate.sh calls --check on TALEEMABAD_DATA_STANDARDS_
    BYPASS before treating a violation as bypassed; on a passing reason, it
    then calls --record (this same script) with the actor, the real `git
    rev-parse HEAD` commit SHA, and the standards the current run found —
    BEFORE letting the commit through — so every successful bypass leaves a
    trail, not just a silently-honored env var. Verified end-to-end against
    real scratch git repos: an unvalidated old-style bypass no longer works,
    a rejected new-style reason still blocks with no record written, and an
    accepted reason both passes the commit through AND writes a real record
    with the correct commit SHA (see evals/evals.json C36+).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

BYPASS_LOG_FILENAME = ".data-standards-bypass-log.jsonl"

# Values that LOOK like a reason but aren't one — the brief says "reject
# empty or generic values." A bypass reason must reference something
# specific (a ticket ID, an incident number, a named person's approval) —
# these generic placeholders get rejected outright.
REJECTED_VALUES = {
    "1", "true", "yes", "y", "ok", "bypass", "skip", "override",
    "fix later", "todo", "n/a", "na", "none", "test", "testing",
}

MIN_REASON_LENGTH = 15  # "1" and "bypass" are too short to be a real reason regardless


def validate_bypass_reason(reason: str) -> tuple[bool, str]:
    """Returns (is_valid, explanation). A valid reason must be non-empty,
    long enough to plausibly contain real content, and not one of the known
    generic placeholders (case-insensitive, whitespace-normalized)."""
    if reason is None:
        return False, "no reason provided (env var unset or empty)"
    normalized = reason.strip()
    if not normalized:
        return False, "reason is empty or whitespace-only"
    if normalized.lower() in REJECTED_VALUES:
        return False, f"reason '{normalized}' is a generic placeholder, not an actual justification"
    if len(normalized) < MIN_REASON_LENGTH:
        return False, (f"reason is only {len(normalized)} characters — too short to be a real "
                        f"justification (need at least {MIN_REASON_LENGTH}); reference a ticket, "
                        "incident, or named approver")
    return True, "ok"


def git_head_sha(repo: Path) -> str | None:
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                                 capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else None
    except FileNotFoundError:
        return None


def extract_issue_ids(findings_path: Path | None) -> list[str]:
    """Best-effort: pull standard IDs (D1, D4, ...) out of a findings JSON
    file (the shape scripts/validate_schema.py emits) for the audit record.
    Not a hard requirement — a bypass is still recorded even if this can't
    be determined, per the brief: 'Record actor, time, repository, commit,
    issue IDs, and reason' — issue IDs are recorded WHEN AVAILABLE, a
    missing findings file must never block the bypass record itself from
    being written."""
    if not findings_path or not findings_path.exists():
        return []
    try:
        data = json.loads(findings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    findings = data.get("findings", []) if isinstance(data, dict) else []
    return sorted({f.get("standard") for f in findings if f.get("standard")})


def append_bypass_record(repo: Path, record: dict) -> bool:
    log_path = repo / BYPASS_LOG_FILENAME
    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
        return True
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", metavar="REASON", help="validate a reason string and exit (0=ok, 1=rejected)")
    ap.add_argument("--record", action="store_true", help="write an audit record for a bypass")
    ap.add_argument("--repo", type=Path, help="repo root (required with --record)")
    ap.add_argument("--reason", help="the bypass reason (required with --record)")
    ap.add_argument("--actor", help="who is bypassing (required with --record)")
    ap.add_argument("--findings-json", type=Path, help="a validate_schema.py report to pull issue IDs from")
    args = ap.parse_args()

    if args.check is not None:
        ok, why = validate_bypass_reason(args.check)
        print(why)
        return 0 if ok else 1

    if args.record:
        if not args.repo or not args.reason or not args.actor:
            ap.error("--record requires --repo, --reason, and --actor")
        ok, why = validate_bypass_reason(args.reason)
        if not ok:
            print(f"REJECTED: {why}", file=sys.stderr)
            return 1

        repo = args.repo.resolve()
        issue_ids = extract_issue_ids(args.findings_json)
        record = {
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "actor": args.actor,
            "repo": str(repo),
            "commit_sha": git_head_sha(repo),
            "reason": args.reason,
            "bypassed_finding_standards": issue_ids,
            "findings_source": str(args.findings_json) if args.findings_json else None,
        }
        written = append_bypass_record(repo, record)
        print(json.dumps({**record, "audit_log_written": written}, indent=2))
        if not written:
            print("WARNING: could not write the audit log file — the bypass is still honored "
                  "(a broken audit log must never itself block a legitimate bypass), but this "
                  "should be investigated.", file=sys.stderr)
        return 0

    ap.error("specify --check <reason> or --record (with --repo/--reason/--actor)")


if __name__ == "__main__":
    sys.exit(main())
