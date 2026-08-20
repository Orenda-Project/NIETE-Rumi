#!/bin/bash
# PreToolUse hook: gate Claude-initiated git commit / git push / gh pr create /
# gh pr merge against the shared validator (scripts/validate_schema.py), so a
# schema change with a confirmed NON-NEGOTIABLE violation is blocked before it
# leaves this session — not just warned about after the fact.
#
# This REPLACES the older data-standards-gate.sh, which ran its own inline
# keyword heuristics directly in the hook. That duplicated logic the shared
# validator now owns; this hook's only job is "is this command git/gh-shaped
# AND schema-relevant, and if so, what does the ONE shared validator say" —
# see reference/enforcement-policy.md for what the validator can and cannot
# block on, and reference/detection-guidance.md for what counts as
# schema-relevant in the first place.
#
# Fires ONLY on Bash commands matching git commit / git push / gh pr create /
# gh pr merge (word-boundary matched, not a substring check — "git commitment"
# in a log message must not trip this). Everything else exits 0 immediately,
# so this hook is cheap on every OTHER Bash call, per Anthropic's hook-hygiene
# guidance: don't run expensive checks before every tool call.
#
# Exit codes (mirrors the validator's contract):
#   0  no blocking violations (or nothing relevant to check, or a validated bypass)
#   2  confirmed blocking violation(s) — PreToolUse exit 2 blocks the tool call
#
# Bypass — requires a REAL reason, not a boolean (changed 2026-08-19; see
# below for what used to be here):
#   export TALEEMABAD_DATA_STANDARDS_BYPASS="INC-4821: hotfix for prod outage, D4 finding is a false positive on a UUID column, approved by data-eng lead"
# The reason is validated by scripts/bypass_audit.py's validate_bypass_reason()
# — empty, generic ("bypass", "fix later", "1", …), or too-short values are
# REJECTED, and a rejected bypass does NOT take effect: the gate falls through
# to its normal check as if no bypass had been attempted at all. A reason that
# passes validation is recorded via bypass_audit.py --record (actor, the real
# git commit SHA, which standards were bypassed, the reason itself) BEFORE the
# commit is allowed through — so every successful bypass leaves an auditable
# trail in .data-standards-bypass-log.jsonl, not just a silently-honored env
# var. (Inline `VAR=value` before the command does NOT work — the hook reads
# env at PreToolUse time, before any inline assignment in the blocked command
# takes effect. Use `export` in the parent shell.)
#
# REMOVED: CLAUDE_DATA_STANDARDS_GATE_OFF=1 no longer bypasses anything. That
# was a boolean escape hatch with zero accountability — anyone could silence
# any finding with no reason, no record, no way to answer "who bypassed what,
# and why" after the fact. TALEEMABAD_DATA_STANDARDS_BYPASS replaces it
# entirely; setting the old variable now does nothing (a warning-only notice
# is printed the first time this hook actually blocks something, so anyone
# still relying on the old variable finds out immediately rather than being
# quietly let through, or quietly blocked with no explanation of why the old
# bypass stopped working).
#
# Strict vs warn: this hook BLOCKS (exit 2) on a confirmed finding by default.
# The shared validator only ever reports things reference/enforcement-policy.md
# classifies as blocking (deterministic, structural) — advisory/manual-review
# findings never reach this hook as a "fail" result at all, so there's no
# warn-only middle ground needed here.
#
# Slack notification (added 2026-08-19): on a confirmed block, and on a
# validated bypass, this hook ALSO fires a best-effort Slack notification via
# scripts/notify.py — the org's Data Team channel finds out about a real
# violation or a bypass without anyone having to remember to tell them.
# Requires TALEEMABAD_DATA_STANDARDS_SLACK_CHANNEL + SLACK_BOT_TOKEN to be set
# in THIS PACK's own .env (notify.py resolves .env relative to its own script
# location, not the target repo's cwd, so this works from any repo without
# per-repo configuration). If either is unset, or the Slack API call fails
# for any reason, the notification attempt is silently swallowed — per
# notify.py's own design and the original brief, notification delivery must
# NEVER affect whether the commit is blocked. This hook backgrounds the call
# and discards its output specifically so a slow/failed network call can
# never add latency or noise to the block message the user actually needs to
# see and act on.
#
# Actor identity (fixed 2026-08-20): the notification and the bypass audit
# record both need a real, identifiable person, not just whatever the OS
# happens to report. Priority order: TALEEMABAD_USER_EMAIL (an explicit
# manual override, if someone sets it) -> `git config user.email` (already
# set in any repo where a commit is possible at all, so this resolves
# automatically with zero setup almost everywhere) -> the OS username as a
# last resort, only when neither of the above is available. Previously this
# fell straight to the OS username whenever TALEEMABAD_USER_EMAIL wasn't set
# — meaning Slack/audit-log attribution showed a bare login name (e.g.
# "abdul") instead of an actual email, in the overwhelmingly common case
# where git itself already had the real identity on file.

set -uo pipefail

INPUT_JSON=$(cat)
export INPUT_JSON
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$SKILL_DIR/scripts/validate_schema.py"
BYPASS_AUDIT="$SKILL_DIR/scripts/bypass_audit.py"
NOTIFY="$SKILL_DIR/scripts/notify.py"

COMMAND=$(python3 - <<'PY'
import json, os, sys
raw = os.environ.get('INPUT_JSON', '') or ''
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)
if data.get('tool_name') != 'Bash':
    sys.exit(0)
print((data.get('tool_input') or {}).get('command', '') or '')
PY
)

if [ -z "$COMMAND" ]; then
    exit 0
fi

# Word-boundary match for the four gated operations. A command string like
# "echo 'about to git commit soon'" must NOT trip this — only an actual
# invocation of the subcommand does.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]|\s)(git\s+commit|git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge)(\s|$)'; then
    exit 0
fi

# Staged changes are what a `git commit` is about to record; an outgoing
# `git push` / `gh pr create|merge` is presumed to already be covered by an
# earlier commit's gate, but re-checking staged is cheap and catches the case
# where staging changed between commit and push in the same session.
VALIDATE_OUTPUT=$(python3 "$VALIDATOR" --mode staged 2>&1)
VALIDATE_EXIT=$?

if [ "$VALIDATE_EXIT" -eq 3 ]; then
    # No schema-relevant staged change — nothing for this gate to say, and no
    # bypass decision to make either.
    exit 0
fi

if [ "$VALIDATE_EXIT" -eq 0 ]; then
    exit 0
fi

# Best-effort, fire-and-forget Slack notification. Backgrounded (&) and fully
# redirected so a slow or failing network call can never add latency or
# stray output to what the user sees — the notify.py call's own exit code is
# never inspected here on purpose, matching notify.py's contract that a
# notification outcome must never influence the standards result.
notify_slack() {
    ( python3 "$NOTIFY" slack --event "$1" --repo "$REPO_NAME" \
        --branch "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)" \
        --commit "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
        --actor "$2" --result "$3" > /dev/null 2>&1 & )
}

# The repo's own top-level directory name — resolved via git, not just the
# cwd's basename, so this stays correct even if the hook fires from a
# subdirectory of the repo rather than its root.
REPO_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
REPO_NAME=$(basename "${REPO_TOPLEVEL:-$(pwd)}")

# From here, VALIDATE_EXIT is 1 (confirmed violation) or 2 (validator error) —
# both blocking by default. Check whether a validated bypass applies before
# deciding what to do with either.
BYPASS_REASON="${TALEEMABAD_DATA_STANDARDS_BYPASS:-}"
GIT_USER_EMAIL=$(git config user.email 2>/dev/null || echo "")
ACTOR="${TALEEMABAD_USER_EMAIL:-${GIT_USER_EMAIL:-${USER:-${USERNAME:-unknown}}}}"

if [ -n "${CLAUDE_DATA_STANDARDS_GATE_OFF:-}" ]; then
    echo "NOTICE: CLAUDE_DATA_STANDARDS_GATE_OFF no longer bypasses this gate." >&2
    echo "Use: export TALEEMABAD_DATA_STANDARDS_BYPASS=\"<a real reason — ticket, incident, or named approver>\"" >&2
fi

if [ -n "$BYPASS_REASON" ]; then
    CHECK_OUTPUT=$(python3 "$BYPASS_AUDIT" --check "$BYPASS_REASON" 2>&1)
    CHECK_EXIT=$?
    if [ "$CHECK_EXIT" -eq 0 ]; then
        # Reason accepted — record the bypass (actor/commit/standards/reason)
        # BEFORE letting the commit through. A findings file is needed for
        # bypass_audit.py to pull the bypassed standard IDs into the record;
        # write the validator's own stdout to a temp file for that purpose.
        REPORT_TMP=$(mktemp)
        printf '%s' "$VALIDATE_OUTPUT" > "$REPORT_TMP"
        RECORD_OUTPUT=$(python3 "$BYPASS_AUDIT" --record --repo . --reason "$BYPASS_REASON" \
            --actor "$ACTOR" --findings-json "$REPORT_TMP" 2>&1)
        RECORD_EXIT=$?
        rm -f "$REPORT_TMP"
        echo "DATA STANDARDS: BYPASSED — a validated reason was provided and recorded." >&2
        echo "  reason: $BYPASS_REASON" >&2
        echo "  actor:  $ACTOR" >&2
        if [ "$RECORD_EXIT" -ne 0 ]; then
            echo "  WARNING: the audit record itself failed to write — bypass still honored" >&2
            echo "  (a broken audit log must never block a legitimate bypass), but this should" >&2
            echo "  be investigated: $RECORD_OUTPUT" >&2
        fi
        notify_slack "bypass" "$ACTOR" "BYPASSED: $BYPASS_REASON"
        exit 0
    fi
    echo "DATA STANDARDS: bypass REJECTED — $CHECK_OUTPUT" >&2
    echo "  TALEEMABAD_DATA_STANDARDS_BYPASS was set, but its reason did not pass validation," >&2
    echo "  so no bypass is in effect. Falling through to the normal check below." >&2
    echo "" >&2
fi

if [ "$VALIDATE_EXIT" -eq 2 ]; then
    echo "DATA STANDARDS: the validator itself could not run — treating this as blocking" >&2
    echo "rather than silently letting the commit/push through unchecked:" >&2
    echo "$VALIDATE_OUTPUT" >&2
    echo "" >&2
    echo "Bypass (only if you've confirmed this is a validator bug, not a real problem):" >&2
    echo "export TALEEMABAD_DATA_STANDARDS_BYPASS=\"<a real reason>\"" >&2
    notify_slack "validation_failure" "$ACTOR" "VALIDATOR ERROR"
    exit 2
fi

echo "DATA STANDARDS: blocking — confirmed violation(s) in the staged schema change." >&2
echo "" >&2
echo "$VALIDATE_OUTPUT" >&2
echo "" >&2
echo "See skills/data-standards/reference/enforcement-policy.md for what blocks vs." >&2
echo "what's advisory. Fix the finding(s) above, or bypass with an approved reason:" >&2
echo "export TALEEMABAD_DATA_STANDARDS_BYPASS=\"<a real reason — ticket, incident, or named approver>\"" >&2
notify_slack "validation_failure" "$ACTOR" "FAIL"
exit 2
