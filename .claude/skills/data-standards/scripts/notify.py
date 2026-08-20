#!/usr/bin/env python3
"""Slack notification + data-governance ingestion event for data-standards
enforcement — the two remaining pieces from the original brief (§10 Slack,
§11 data-governance notification).

SLACK PATH: verified end-to-end (2026-08-18) — a real bot token authenticated
(auth.test), channel membership was confirmed (conversations.info), and a
real chat.postMessage call returned a genuine Slack `ts`. The send_slack()
path is live-verified, not just unit-tested.

GOVERNANCE PATH: still unverified end-to-end, and this is the CURRENT,
INTENDED default — not a temporary gap waiting on a config value. Checked
(2026-08-18) whether the org's existing `taleemabad-data` MCP server could
serve as this endpoint: it exposes only query/reporting tools (execute_query,
get_rules, describe_data, list_datasets, check_table_freshness, preview_table,
get_version) plus report_ticket/update_ticket for the MCP SERVER'S OWN
internal problem detection (query/system loop failures) — there is no
schema-change ingestion tool, and repurposing report_ticket would be both
semantically wrong (it's scoped to the server's own detected problems, not
external schema-change events) and mechanically wrong for most of this
script's callers (MCP tools are only reachable from an active Claude session
— a Git pre-commit hook or a CI job has no MCP client to call through, which
is exactly the limitation the original brief flagged for the MCP option).

Until a real HTTPS ingestion endpoint exists somewhere, TALEEMABAD_GOVERNANCE_
ENDPOINT stays unset by design, and send_governance_event()'s local-file
fallback (.data-standards-governance-events.jsonl) IS the shipped behavior —
not a stub. It's unit-tested in isolation (event construction, idempotency-
key determinism, sanitization, retry/backoff against a genuinely unreachable
domain — see evals/evals.json C33-C35), but an actual "did a governance
service accept this" round-trip has never been run, because no such service
exists yet to run it against. Say so plainly if you rely on this path.

Reuses skills/storytime/scripts/slack_send.py's Slack primitives directly
(load_token, post_message, open_dm_channel) rather than re-implementing
them — same .env-walking, same SLACK_BOT_TOKEN convention, one authoritative
Slack client in this pack, not two that could drift apart.

Slack events sent on:
  - schema-changing PR update       (--event pr_update)
  - validation failure               (--event validation_failure)
  - pass after failure               (--event pass_after_failure)
  - bypass use                       (--event bypass)
  - schema-changing merge            (--event merge)
  - standards-version change         (--event standards_version_change)

Data-governance event: a single ingestion payload (see build_governance_event)
sent via HTTPS POST to TALEEMABAD_GOVERNANCE_ENDPOINT (env var, optional —
if unset, the event is written to a local file instead and this is reported,
never silently dropped). Idempotency key included so a retried delivery
doesn't double-count. Bounded retries with backoff; a delivery failure is
logged and surfaced, and NEVER blocks the calling git hook / CI job / Claude
session — this script's own exit code reflects whether the notification
attempt itself crashed unexpectedly, not whether the remote side accepted it
(that distinction is in the JSON output, not the exit code).

Usage:
    # Slack
    python3 notify.py slack --event validation_failure --channel C0123456 \
        --repo my-repo --branch feature/x --commit abc123 --result FAIL \
        --severity-counts '{"CRITICAL":1,"HIGH":2}' --issue-ids D4-users-001,D3-users-001 \
        --report-url https://example.invalid/reports/abc123

    # Governance event
    python3 notify.py governance --repo my-repo --branch main \
        --base-sha abc --head-sha def --actor "abdul.rehman@taleemabad.com" \
        --result PASS --changed-files migrations/001.sql \
        --report-ref https://example.invalid/reports/def456

Both subcommands print a JSON result describing what was actually attempted
and what the outcome was — including "not configured, nothing sent" as an
explicit, distinguishable outcome from "sent successfully" or "send failed."
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
PACK_ROOT = SKILL_DIR.parent.parent  # skills/data-standards -> skills -> repo root
STORYTIME_SCRIPTS = PACK_ROOT / "skills" / "storytime" / "scripts"

# --------------------------------------------------------------- sanitization

# Fields that must NEVER appear in a Slack message or governance event, per
# the brief: no credentials, no environment values, no production rows, no
# PII, no absolute local paths, no full prompts, no complete unredacted
# schemas. This is a denylist of substrings/patterns to strip if somehow
# present in a caller-supplied string field (defense in depth — the fields
# this script actually accepts are already structured/scalar, not free-form
# prompt dumps, but a caller could still pass something it shouldn't).
_LOCAL_PATH_PATTERN = re.compile(r"[A-Za-z]:\\[^\s\"']+|/(?:Users|home)/[^/\s\"']+/[^\s\"']*")
_SECRET_PATTERN = re.compile(
    r"sk-[A-Za-z0-9]+|xoxb-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|"
    r"ntn_[A-Za-z0-9]+|AKIA[A-Z0-9]+|-----BEGIN [A-Z ]*PRIVATE KEY-----"
)


def sanitize(value: str) -> str:
    """Redact anything that looks like a local path or a credential before it
    ever reaches a Slack message or a governance event payload. This is a
    safety net, not the primary control — callers should not be passing raw
    prompts or schema dumps into these fields in the first place (see the
    module docstring's list of what must never appear)."""
    if not isinstance(value, str):
        return value
    value = _LOCAL_PATH_PATTERN.sub("[local-path-redacted]", value)
    value = _SECRET_PATTERN.sub("[credential-redacted]", value)
    return value


def sanitize_deep(obj):
    if isinstance(obj, str):
        return sanitize(obj)
    if isinstance(obj, dict):
        return {k: sanitize_deep(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_deep(v) for v in obj]
    return obj


# --------------------------------------------------------------- Slack

SLACK_EVENT_TEMPLATES = {
    "pr_update": ("📋", "Data Standards — schema-changing PR updated"),
    "validation_failure": ("❌", "Data Standards — validation FAILED"),
    "pass_after_failure": ("✅", "Data Standards — now passing (previously failed)"),
    "bypass": ("⚠️", "Data Standards — gate BYPASSED"),
    "merge": ("🔀", "Data Standards — schema-changing merge"),
    "standards_version_change": ("📐", "Data Standards — standards version changed"),
}


def build_slack_message(event: str, fields: dict) -> str:
    if event not in SLACK_EVENT_TEMPLATES:
        raise ValueError(f"unknown event type: {event}  (expected one of {list(SLACK_EVENT_TEMPLATES)})")
    emoji, title = SLACK_EVENT_TEMPLATES[event]
    fields = sanitize_deep(fields)

    lines = [f"{emoji} *{title}*"]
    order = ["repo", "branch", "commit", "pr", "actor", "standards_version", "result",
             "changed_objects", "severity_counts", "issue_ids", "bypass_reason", "report_url"]
    labels = {
        "repo": "Repo", "branch": "Branch", "commit": "Commit", "pr": "PR", "actor": "Actor",
        "standards_version": "Standards version", "result": "Result",
        "changed_objects": "Changed objects", "severity_counts": "Severity counts",
        "issue_ids": "Issue IDs", "bypass_reason": "Bypass reason", "report_url": "Report",
    }
    for key in order:
        if key in fields and fields[key] not in (None, "", []):
            val = fields[key]
            if isinstance(val, (list, dict)):
                val = json.dumps(val)
            lines.append(f"• *{labels[key]}:* {val}")
    return "\n".join(lines)


def send_slack(event: str, channel: str | None, fields: dict) -> dict:
    """Returns a result dict describing what happened — never raises for a
    missing/misconfigured destination, since Slack delivery must never be
    what blocks a git hook / CI job / Claude session (per the brief:
    'Never block a valid local commit solely because delivery is
    unavailable')."""
    if not channel:
        return {"sent": False, "reason": "no channel configured — set --channel or "
                 "TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL"}

    try:
        sys.path.insert(0, str(STORYTIME_SCRIPTS))
        import slack_send  # noqa: E402
    except ImportError as e:
        return {"sent": False, "reason": f"couldn't import the pack's Slack helper: {e}"}

    try:
        text = build_slack_message(event, fields)
    except ValueError as e:
        return {"sent": False, "reason": str(e)}

    try:
        result = slack_send.post_message(channel_id=channel, text=text)
        return {"sent": True, "ts": result.get("ts"), "channel": channel}
    except SystemExit as e:
        # slack_send.load_token() raises SystemExit (not a plain exception)
        # when SLACK_BOT_TOKEN is missing from .env — correct for a human
        # running that script directly, but here it must be caught and
        # turned into a normal "not sent" result, same as any other Slack
        # failure. SystemExit does NOT inherit from Exception, so the
        # broader except below would never have caught it — this needs its
        # own clause.
        return {"sent": False, "reason": f"Slack token unavailable: {e}"}
    except Exception as e:  # noqa: BLE001 — deliberately broad: a Slack failure must
        # never propagate as an unhandled exception that could look like a
        # blocking error to whatever called this script.
        return {"sent": False, "reason": f"send failed: {e}"}


# --------------------------------------------------------------- governance event

GOVERNANCE_EVENT_SCHEMA_VERSION = "1"


def build_governance_event(args: argparse.Namespace) -> dict:
    """A versioned, idempotent event. Idempotency key is a hash of the
    fields that make an event unique (repo + head_sha + result) — a retried
    delivery of the SAME event produces the SAME key, so the receiving side
    can de-duplicate rather than double-counting a retried POST."""
    changed_files = sanitize_deep(args.changed_files or [])
    idempotency_source = f"{args.repo}|{args.head_sha}|{args.result}"
    idempotency_key = hashlib.sha256(idempotency_source.encode()).hexdigest()

    return {
        "schema_version": GOVERNANCE_EVENT_SCHEMA_VERSION,
        "idempotency_key": idempotency_key,
        "repository": sanitize(args.repo),
        "branch": sanitize(args.branch),
        "base_sha": args.base_sha,
        "head_sha": args.head_sha,
        "pr": args.pr,
        "actor": sanitize(args.actor) if args.actor else None,
        "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "standards_version": args.standards_version,
        "validator_version": args.validator_version,
        "before_fingerprint": args.before_fingerprint,
        "after_fingerprint": args.after_fingerprint,
        "result": args.result,
        "bypass": bool(args.bypass_reason),
        "bypass_reason": sanitize(args.bypass_reason) if args.bypass_reason else None,
        "changed_relative_paths": changed_files,
        "changed_objects": sanitize_deep(args.changed_objects or []),
        "severity_counts": args.severity_counts or {},
        "issue_ids": args.issue_ids or [],
        "report_ref": sanitize(args.report_ref) if args.report_ref else None,
    }


def send_governance_event(event: dict, endpoint: str | None, retries: int = 3) -> dict:
    """POSTs the event with bounded retries + exponential backoff. If no
    endpoint is configured, writes the event to a local fallback file
    instead of silently discarding it — 'full context, no secrets' per the
    brief, and a locally-preserved event is recoverable later; a discarded
    one is not."""
    if not endpoint:
        fallback = Path(".data-standards-governance-events.jsonl")
        try:
            with fallback.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, separators=(",", ":")) + "\n")
            return {"sent": False, "reason": "no endpoint configured — event appended to "
                    f"{fallback} instead of being discarded", "fallback_file": str(fallback)}
        except OSError as e:
            return {"sent": False, "reason": f"no endpoint configured AND fallback write "
                    f"failed: {e} — event was NOT preserved anywhere"}

    payload = json.dumps(event).encode("utf-8")
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                endpoint, data=payload, method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                return {"sent": True, "status": resp.status, "attempt": attempt}
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            last_error = str(e)
            if attempt < retries:
                time.sleep(2 ** attempt)  # 2s, 4s, ... bounded backoff
    return {"sent": False, "reason": f"all {retries} attempts failed: {last_error}"}


# --------------------------------------------------------------- CLI

def main() -> int:
    # Load the pack's own .env BEFORE any argparse default reads os.environ —
    # otherwise --channel/--endpoint's default=os.environ.get(...) resolves
    # at parse time, before slack_send's _load_env() would otherwise populate
    # these from .env deep inside send_slack(). Without this, a caller that
    # only configured TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL in the pack's
    # .env (not their own shell) silently gets "no channel configured" even
    # though the value is right there in .env — defeating the whole point of
    # "configure once in .env, works from any invoking shell/repo."
    try:
        sys.path.insert(0, str(STORYTIME_SCRIPTS))
        import slack_send
        slack_send._load_env()
    except ImportError:
        pass

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    slack = sub.add_parser("slack", help="send a Slack notification")
    slack.add_argument("--event", required=True, choices=list(SLACK_EVENT_TEMPLATES))
    slack.add_argument("--channel", default=os.environ.get("TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL"))
    slack.add_argument("--repo")
    slack.add_argument("--branch")
    slack.add_argument("--commit")
    slack.add_argument("--pr")
    slack.add_argument("--actor")
    slack.add_argument("--standards-version")
    slack.add_argument("--result")
    slack.add_argument("--changed-objects", help="comma-separated")
    slack.add_argument("--severity-counts", help="JSON object string, e.g. '{\"CRITICAL\":1}'")
    slack.add_argument("--issue-ids", help="comma-separated")
    slack.add_argument("--bypass-reason")
    slack.add_argument("--report-url")

    gov = sub.add_parser("governance", help="send/queue a data-governance ingestion event")
    gov.add_argument("--endpoint", default=os.environ.get("TALEEMABAD_GOVERNANCE_ENDPOINT"))
    gov.add_argument("--repo", required=True)
    gov.add_argument("--branch", required=True)
    gov.add_argument("--base-sha")
    gov.add_argument("--head-sha", required=True)
    gov.add_argument("--pr")
    gov.add_argument("--actor")
    gov.add_argument("--standards-version")
    gov.add_argument("--validator-version")
    gov.add_argument("--before-fingerprint")
    gov.add_argument("--after-fingerprint")
    gov.add_argument("--result", required=True)
    gov.add_argument("--bypass-reason")
    gov.add_argument("--changed-files", help="comma-separated relative paths")
    gov.add_argument("--changed-objects", help="comma-separated")
    gov.add_argument("--severity-counts", help="JSON object string")
    gov.add_argument("--issue-ids", help="comma-separated")
    gov.add_argument("--report-ref")

    args = ap.parse_args()

    if args.command == "slack":
        fields = {
            "repo": args.repo, "branch": args.branch, "commit": args.commit, "pr": args.pr,
            "actor": args.actor, "standards_version": args.standards_version, "result": args.result,
            "changed_objects": args.changed_objects.split(",") if args.changed_objects else None,
            "severity_counts": json.loads(args.severity_counts) if args.severity_counts else None,
            "issue_ids": args.issue_ids.split(",") if args.issue_ids else None,
            "bypass_reason": args.bypass_reason, "report_url": args.report_url,
        }
        result = send_slack(args.event, args.channel, fields)
        print(json.dumps(result, indent=2))
        return 0  # never fail the calling process over a notification outcome

    if args.command == "governance":
        args.changed_files = args.changed_files.split(",") if args.changed_files else []
        args.changed_objects = args.changed_objects.split(",") if args.changed_objects else []
        args.severity_counts = json.loads(args.severity_counts) if args.severity_counts else {}
        args.issue_ids = args.issue_ids.split(",") if args.issue_ids else []
        event = build_governance_event(args)
        result = send_governance_event(event, args.endpoint)
        print(json.dumps({"event": event, "delivery": result}, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
