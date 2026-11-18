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
# Governance-event reporting (added 2026-10-06): same best-effort, backgrounded
# pattern, now ALSO firing on a PASS (not just a block/bypass) — a real,
# reachable data-governance endpoint now exists (data-gate-telemetry), unlike
# when this path was first built and documented as "unset by design, nothing
# to send to yet." Reports PASS, FAIL, and BYPASSED: <reason> so the
# dashboard's pass-rate and "are violations getting fixed" stats reflect
# reality, not just a stream of failures — reporting only blocks/bypasses
# would make every repo using this gate look like it fails constantly, even
# one that's almost always compliant. Requires TALEEMABAD_GOVERNANCE_ENDPOINT +
# TELEMETRY_KEY in this pack's own .env; same zero-effect-on-blocking guarantee
# as Slack if either is unset or the POST fails.
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
export COMMAND
HOOK_EVENT=$(python3 -c 'import json,os; print((json.loads(os.environ.get("INPUT_JSON") or "{}") or {}).get("hook_event_name", ""))' 2>/dev/null)

# Word-boundary match for the four gated operations. A command string like
# "echo 'about to git commit soon'" must NOT trip this — only an actual
# invocation of the subcommand does.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]|\s)(git\s+commit|git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge)(\s|$)'; then
    exit 0
fi

# Claude usually runs `cd <repo> && git commit …`, but a hook runs in the
# session's own directory — follow that leading cd, or the gate validates
# (and reports) whatever repository the session happens to be sitting in.
# A `python3 -c` string, not a heredoc inside $( ): bash 3.2 (macOS /bin/bash)
# scans a $( ) for its closing paren and reads the heredoc's quotes as shell
# quoting, so the unmatched ' in this regex broke the parse of the whole file
# (bd-oa79w0, 2026-10-27). Single quotes inside the pattern are written \x27.
CD_TARGET=$(python3 -c 'import os, re
m = re.match(r"""\s*cd\s+(?:"([^"]+)"|\x27([^\x27]+)\x27|([^\s;&|]+))\s*&&""", os.environ.get("COMMAND", ""))
print(next(g for g in m.groups() if g) if m else "")')
if [ -n "$CD_TARGET" ] && [ -d "$CD_TARGET" ]; then
    cd "$CD_TARGET" || true
fi

# Resolved up front, before any exit path below, since the PASS-reporting
# call now needs these too (previously only the block/bypass paths did).
# The repo's own top-level directory name — resolved via git, not just the
# cwd's basename, so this stays correct even if the hook fires from a
# subdirectory of the repo rather than its root.
REPO_TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
REPO_NAME=$(basename "${REPO_TOPLEVEL:-$(pwd)}")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
GIT_HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
GIT_USER_EMAIL=$(git config user.email 2>/dev/null || echo "")
ACTOR="${TALEEMABAD_USER_EMAIL:-${GIT_USER_EMAIL:-${USER:-${USERNAME:-unknown}}}}"

# Best-effort, fire-and-forget Slack notification. Backgrounded (&) and fully
# redirected so a slow or failing network call can never add latency or
# stray output to what the user sees — the notify.py call's own exit code is
# never inspected here on purpose, matching notify.py's contract that a
# notification outcome must never influence the standards result.
notify_slack() {
    local summary_args=()
    if [ -n "${4:-}" ]; then
        summary_args=(--summary "$4")
    fi
    ( python3 "$NOTIFY" slack --event "$1" --repo "$REPO_NAME" \
        --branch "$GIT_BRANCH" --commit "$GIT_HEAD_SHA" \
        --actor "$2" --result "$3" ${summary_args[@]+"${summary_args[@]}"} > /dev/null 2>&1 & )
}

# Same best-effort, backgrounded pattern as notify_slack, reporting to
# data-gate-telemetry instead — fires on PASS, FAIL, and BYPASSED alike (see
# this file's header comment for why PASS is included). $1 is the result
# text; $2 is an optional bypass reason, passed through only on a bypass;
# $3 is an optional summary (what warned, and why it did not block).
notify_governance() {
    local bypass_args=()
    if [ -n "${2:-}" ]; then
        bypass_args=(--bypass-reason "$2")
    fi
    if [ -n "${3:-}" ]; then
        bypass_args+=(--summary "$3")
    fi
    ( python3 "$NOTIFY" governance --repo "$REPO_NAME" --branch "$GIT_BRANCH" \
        --head-sha "$GIT_HEAD_SHA" --actor "$ACTOR" --result "$1" \
        --report-ref "commit" ${bypass_args[@]+"${bypass_args[@]}"} > /dev/null 2>&1 & )
}

# A message the PERSON sees, on exit 0. Claude Code shows a PreToolUse hook's
# stderr only when it blocks, so a pass would otherwise be invisible — and a
# gate you never see run is indistinguishable from one that isn't installed.
# The JSON `systemMessage` field is what Claude Code displays to the user.
system_message() {
    python3 -c 'import json,sys; print(json.dumps({"systemMessage": sys.argv[1]}))' "$1"
}

# Where the repo has the data gates' own git hooks switched on (see
# git-gate.py / scripts/install_git_hooks.py), those run on this same commit
# or push — after staging, with the real hash — so this hook stands aside
# instead of checking and reporting everything twice.
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+(commit|push)(\s|$)'; then
    HOOKS_PATH=$(git config --get core.hooksPath 2>/dev/null || echo "")
    if [ -n "$HOOKS_PATH" ]; then
        case "$HOOKS_PATH" in
            /*|[A-Za-z]:*) HOOKS_DIR="$HOOKS_PATH" ;;
            *) HOOKS_DIR="${REPO_TOPLEVEL:-.}/$HOOKS_PATH" ;;
        esac
        if grep -qs "git-gate.py" "$HOOKS_DIR/pre-commit"; then
            exit 0
        fi
    fi
fi

# The new commit's hash doesn't exist until `git commit` has run, and this
# PreToolUse hook runs BEFORE it — so HEAD here is the PARENT, and reporting it
# as "the commit" names the wrong one. For a commit, the PreToolUse run checks
# and blocks as before but only records the verdict in this marker; the
# PostToolUse run of this same script (after the commit lands) reads it and
# sends the PASS/BYPASS report with the real hash. Blocks are still reported
# at once — a blocked commit never gets a hash. Pushes and PRs report at once.
IS_COMMIT=""
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+commit(\s|$)'; then
    IS_COMMIT=1
fi
GIT_DIR_PATH=$(git rev-parse --git-dir 2>/dev/null || echo "")
MARKER="${GIT_DIR_PATH:+$GIT_DIR_PATH/data-standards-pending-commit}"

if [ "$HOOK_EVENT" = "PostToolUse" ]; then
    { [ -n "$IS_COMMIT" ] && [ -n "$MARKER" ] && [ -f "$MARKER" ]; } || exit 0
    PENDING_BASE=$(sed -n 1p "$MARKER")
    PENDING_RESULT=$(sed -n 2p "$MARKER")
    PENDING_REASON=$(sed -n 3p "$MARKER")
    rm -f "$MARKER"
    if [ "$GIT_HEAD_SHA" = "$PENDING_BASE" ]; then
        system_message "– DATA STANDARDS: the commit did not go through (HEAD unchanged) — nothing reported."
        exit 0
    fi
    if [ "$PENDING_RESULT" = "NOT APPLICABLE" ]; then
        # The gate ran but had nothing to check: a board row only, no Slack.
        notify_governance "NOT APPLICABLE"
    elif [ "$PENDING_RESULT" = "WARN" ]; then
        notify_slack "warn" "$ACTOR" "PASS with warnings" "$PENDING_REASON"
        notify_governance "PASS WITH WARNINGS" "" "$PENDING_REASON"
        system_message "⚠ DATA STANDARDS: commit ${GIT_HEAD_SHA:0:7} on $GIT_BRANCH — PASS with warnings (not blocking), reported to Slack and the gate board."
    elif [ "$PENDING_RESULT" = "BYPASSED" ]; then
        notify_slack "bypass" "$ACTOR" "BYPASSED: $PENDING_REASON"
        notify_governance "BYPASSED" "$PENDING_REASON"
        system_message "⚠ DATA STANDARDS: commit ${GIT_HEAD_SHA:0:7} on $GIT_BRANCH went in with violations BYPASSED — $PENDING_REASON"
    else
        notify_slack "pass" "$ACTOR" "PASS"
        notify_governance "PASS"
        system_message "✓ DATA STANDARDS: commit ${GIT_HEAD_SHA:0:7} on $GIT_BRANCH — PASS, reported to Slack and the gate board."
    fi
    exit 0
fi
[ -n "$MARKER" ] && rm -f "$MARKER"

# Staged changes are what a `git commit` is about to record; an outgoing
# `git push` / `gh pr create|merge` is presumed to already be covered by an
# earlier commit's gate, but re-checking staged is cheap and catches the case
# where staging changed between commit and push in the same session.
VALIDATE_OUTPUT=$(python3 "$VALIDATOR" --mode staged 2>&1)
VALIDATE_EXIT=$?

if [ "$VALIDATE_EXIT" -eq 3 ]; then
    # No schema-relevant staged change — nothing for this gate to say, and no
    # bypass decision to make either. Correctly NOT a PASS report either: a
    # PASS means "the gate checked a real schema change and it was clean,"
    # not "there was nothing to check at all" — conflating the two would
    # make a repo with no schema activity this week look identical to one
    # that shipped several clean, compliant migrations.
    #
    # It IS recorded on the data-gate board, as NOT APPLICABLE (which the
    # board's pass/fail buckets leave out), so the board shows the gate ran
    # on this commit — silence would otherwise be indistinguishable from a
    # gate that isn't installed. Not posted to Slack: most commits touch no
    # schema, and those lines would bury the real passes and blocks. Only for
    # a commit — this hook doesn't check pushes or PRs, it re-checks staging.
    if [ -n "$IS_COMMIT" ] && [ -n "$MARKER" ]; then
        printf '%s\nNOT APPLICABLE\n' "$GIT_HEAD_SHA" > "$MARKER"
    fi
    system_message "– DATA STANDARDS: ran on this commit — no schema/migration files staged, nothing to check."
    exit 0
fi

if [ "$VALIDATE_EXIT" -eq 0 ]; then
    # A pass can still carry warnings (checks set to `warn` in standards.yaml):
    # never blocking, but shown to the person and reported as WARN, with the
    # reason each one only warns.
    WARN_TEXT=$(printf '%s' "$VALIDATE_OUTPUT" | python3 -c '
import json, sys
try:
    r = json.loads(sys.stdin.read())
except ValueError:
    r = {}
if r.get("warnings"):
    print(" ".join(r.get("summary", "").split()))
' 2>/dev/null)
    if [ -n "$WARN_TEXT" ]; then
        if [ -n "$IS_COMMIT" ] && [ -n "$MARKER" ]; then
            printf '%s\nWARN\n%s\n' "$GIT_HEAD_SHA" "$WARN_TEXT" > "$MARKER"
            system_message "⚠ DATA STANDARDS: staged schema changes — PASS with warnings (not blocking): $WARN_TEXT"
        else
            notify_governance "PASS WITH WARNINGS" "" "$WARN_TEXT"
            notify_slack "warn" "$ACTOR" "PASS with warnings" "$WARN_TEXT"
            system_message "⚠ DATA STANDARDS: schema changes — PASS with warnings (not blocking): $WARN_TEXT"
        fi
        exit 0
    fi
    if [ -n "$IS_COMMIT" ] && [ -n "$MARKER" ]; then
        printf '%s\nPASS\n' "$GIT_HEAD_SHA" > "$MARKER"
        system_message "✓ DATA STANDARDS: staged schema changes checked — PASS. Reported with the commit number once the commit lands."
    else
        notify_governance "PASS"
        notify_slack "pass" "$ACTOR" "PASS"
        system_message "✓ DATA STANDARDS: schema changes checked — PASS, no NON-NEGOTIABLE violations."
    fi
    exit 0
fi

# From here, VALIDATE_EXIT is 1 (confirmed violation) or 2 (validator error) —
# both blocking by default. Check whether a validated bypass applies before
# deciding what to do with either.
BYPASS_REASON="${TALEEMABAD_DATA_STANDARDS_BYPASS:-}"

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
        if [ -n "$IS_COMMIT" ] && [ -n "$MARKER" ]; then
            printf '%s\nBYPASSED\n%s\n' "$GIT_HEAD_SHA" "$BYPASS_REASON" > "$MARKER"
            system_message "⚠ DATA STANDARDS: violations BYPASSED with a recorded reason — reported with the commit number once the commit lands."
            exit 0
        fi
        notify_slack "bypass" "$ACTOR" "BYPASSED: $BYPASS_REASON"
        # "BYPASSED" alone, not "BYPASSED: <reason>" — data-gate-telemetry's
        # `result` column is capped at 64 chars (a short status, by design),
        # and the full reason belongs in the separate `bypass_reason` field
        # (1024-char cap) that's already passed as the second argument here.
        # Caught 2026-10-06: a long real reason silently failed Pydantic
        # validation server-side with the combined string, got counted as
        # "rejected" in the server's own log, and the client still received
        # 204 for the batch overall — nothing in the hook's own output
        # showed anything wrong, since notify.py reports its own HTTP
        # layer succeeding, not what the server does with the payload after.
        notify_governance "BYPASSED" "$BYPASS_REASON"
        system_message "⚠ DATA STANDARDS: violations BYPASSED with a recorded reason — $BYPASS_REASON"
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
    notify_governance "ERROR: validator could not run"
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
notify_governance "FAIL"
exit 2
