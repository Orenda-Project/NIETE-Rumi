#!/bin/bash
# PostToolUse on Bash — ARMS a targeted E2E run after a push that actually deploys.
#
#   commit/push → changed files → feature map → selected features
#               → SPEC SYNC BRIEF (phase 1) + marker file + `additionalContext`
#               → agent syncs the Gherkin, validates it, THEN drives the suite
#
# This is HALF of the auto-run. The other half is `e2e-autorun-stop.sh`, and the
# split is forced by the harness, not by taste:
#
#   "PreToolUse/PostToolUse hooks cannot trigger follow-up actions: they can only
#    allow, deny, ask, or provide context. They cannot cause Claude to run a
#    different command."   — Claude Code hooks reference
#
# So this hook can only ASK. The `Stop` event is the one place a hook can compel
# (`{"decision":"block","reason":…}` refuses to end the turn), which is why the
# marker exists: this hook writes the intent, the Stop hook enforces it.
#
# WHAT IT STILL CANNOT DO, and no amount of hook wiring will change:
#   · drive WhatsApp itself — the Chrome DevTools MCP tools belong to the agent,
#     not to a subprocess. The agent runs `/niete-e2e <feature>`; this hook can
#     only put that instruction in front of it.
#   · guarantee the target is testable — a linked WhatsApp Web session is a
#     human, physical precondition. `/niete-e2e` navigates to web.whatsapp.com
#     BEFORE judging, then stops on a QR screen and asks for a scan rather than
#     faking results, and that is correct.
#   · know the deploy has finished. It fires the instant the push returns, while
#     Railway is still building. Hence "confirm the deploy is live FIRST" in the
#     instruction — running earlier drives the OLD build and green-lights a change
#     that never actually ran.
#
# Off switch:  E2E_AUTORUN_OFF=1
# Sync off:    E2E_SPEC_SYNC_OFF=1 — skip phase 1 (the Gherkin sync) and behave
#              exactly as this hook did before bd-59809. Deliberately SEPARATE
#              from E2E_AUTORUN_OFF: if spec authoring turns noisy or wrong, the
#              E2E half must keep working rather than be switched off with it.
# Full suite:  E2E_AUTORUN_ALL=1  — arm `/niete-e2e all` instead of the targeted
#              selection. Opt-in on purpose: `all` is 99 scenarios and coaching's
#              15 each upload real audio and wait ~10min on analysis, so a
#              commit-triggered `all` blocks the session for hours.
# Both must be EXPORTED — inline `VAR=1 cmd` is invisible to hooks; see
# .claude/hooks/CLAUDE.md.
# Clear a pending marker: bash .claude/hooks/e2e-autorun.sh --clear [--session ID]

_HOOK_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${_HOOK_DIR%/.claude/hooks}}"
PENDING_DIR="$PROJECT_ROOT/.claude/.e2e-pending"

# --clear runs from a terminal with no stdin, so it must be handled before any
# read. Without this the maintenance path hangs waiting for a payload.
if [ "${1:-}" = "--clear" ]; then
  # The sync brief goes with the marker. A brief left behind describes a diff
  # that is no longer HEAD, so an agent that picks it up authors scenarios for a
  # change already superseded — worse than having no brief at all.
  if [ "${2:-}" = "--session" ] && [ -n "${3:-}" ]; then
    rm -f "$PENDING_DIR/$3.json" "$PENDING_DIR/$3.sync.json"
  else
    rm -f "$PENDING_DIR"/*.json
  fi
  echo "e2e-autorun: cleared." >&2
  exit 0
fi

[ "${E2E_AUTORUN_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null)
PAYLOAD_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

# shellcheck source=lib/git-push-match.sh
. "$_HOOK_DIR/lib/git-push-match.sh" 2>/dev/null || exit 0

SCAN=$(printf '%s' "$COMMAND" | strip_heredocs)
[ -z "$SCAN" ] && SCAN="$COMMAND"

# TWO TRIGGERS, and the range differs per trigger.
#
#   commit — the PRIMARY trigger (bd-43513). Fires on any branch: a commit
#            deploys nothing regardless of branch, so a branch filter here would
#            only make it fire less than asked. Range = the HEAD commit.
#   push   — kept for the one moment the code actually becomes testable. Only
#            develop/main/staging, because a feature-branch push deploys nothing
#            and would spend ~10 min driving the build that was already live.
#            Range = the tracking ref's reflog; AFTER a push `@{upstream}...HEAD`
#            is empty, which silently broke this once already.
#
# A commit followed by a push simply re-arms; the marker is overwritten, never
# duplicated.
#
# BOTH TRIGGERS EXECUTE (operator, 2026-08-25: "when we commit something then
# auto run the e2e test").
#
# This REVERSES PR #37, which had made commit silent-advisory. Read its reasoning
# before changing it back, because it was not wrong: a commit deploys nothing, so
# an E2E fired from one drives the build that was ALREADY LIVE. It cannot tell you
# anything about the change just committed.
#
# That cost is not removed by this hook — it is DISCLOSED. A commit-armed marker
# makes the Stop hook say, in the reason, that the code has not been deployed and
# the run therefore exercises the previous build. The agent decides what that is
# worth; it is no longer decided silently here.
#
#   commit → execute. Any branch: a commit deploys nothing regardless of branch,
#            so a branch filter would only make it fire less than asked.
#   push   → execute. The code is now reachable on staging/prod — this is the one
#            moment the run actually tests the change.
#
# The mode is still written into the marker rather than re-derived in the Stop
# hook, so the two halves cannot disagree about what a given arming meant, and so
# an advisory marker left on disk by the previous version stays silent.
if is_git_commit "$SCAN"; then
  TRIGGER=commit
  MODE=execute
  SEL_MODE="--json --committed"
elif is_git_push "$SCAN" && push_targets_deploy_branch "$SCAN"; then
  TRIGGER=push
  MODE=execute
  SEL_MODE="--json --pushed"
else
  exit 0
fi

REPO=$(e2e_resolve_repo "$SCAN" "$PAYLOAD_CWD")

if [ "${E2E_AUTORUN_ALL:-}" = "1" ]; then
  # FULL SUITE — the selector is not consulted at all, deliberately.
  #
  # `all` is not a bigger selection, it is a different question: "does the whole
  # product still work", not "did this diff break its own features". So it must
  # arm on the commits the targeted path drops — a docs-only commit selects zero
  # features, and that is exactly when someone asking for `all` still wants it.
  # Routing this through the selector would silently no-op on those.
  SEL='{"commands":["/niete-e2e all"],"features":["all"],"fallback":false,"unmapped":[]}'
else
  SEL=$(e2e_run_selector "$PROJECT_ROOT" "$REPO" "$SEL_MODE") || exit 0
  [ -z "$SEL" ] && exit 0

  # Nothing selected (docs-only change) is the common case. Say nothing.
  COUNT=$(printf '%s' "$SEL" | jq -r '.commands | length' 2>/dev/null)
  case "$COUNT" in ''|0) exit 0 ;; esac
fi

# ── PHASE 1: the Gherkin spec sync brief ─────────────────────────────────────
#
# Built from the SAME selection that armed the run, so the two phases cannot
# disagree about which features this change touched.
SYNC_FILE="$PENDING_DIR/$SESSION.sync.json"
SPEC_SYNC=false
mkdir -p "$PENDING_DIR" 2>/dev/null || exit 0
rm -f "$SYNC_FILE" 2>/dev/null
if [ "${E2E_SPEC_SYNC_OFF:-}" != "1" ]; then
  SYNC_MODE=""
  [ "$TRIGGER" = "commit" ] && SYNC_MODE=committed
  BRIEF=$(e2e_run_spec_sync "$PROJECT_ROOT" "$REPO" "$SEL" "$SYNC_MODE")
  # `sync_needed` false means the selection produced no feature to author for —
  # a full-suite promotion with no specs, say. Writing an empty brief would put
  # a phase in front of the agent with nothing in it.
  if [ -n "$BRIEF" ] \
     && [ "$(printf '%s' "$BRIEF" | jq -r '.sync_needed // false' 2>/dev/null)" = "true" ]; then
    printf '%s' "$BRIEF" > "$SYNC_FILE" 2>/dev/null && SPEC_SYNC=true
  fi
fi

CMDS=$(printf '%s' "$SEL" | jq -r '.commands[]' 2>/dev/null)
BRANCH=$(git -C "${REPO:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$BRANCH" ] && BRANCH=$(printf '%s' "$SCAN" | grep -oE '(develop|main|staging)' | head -1)
REPO_NAME=$(basename "${REPO:-unknown}")

# The advisory-downgrade guard that used to live here is GONE, because nothing
# arms advisory any more — every arming is an execute order, so re-arming can
# only ever refresh the selection with a newer one. Re-adding an advisory mode
# means re-adding that guard: an advisory arming must never overwrite an
# un-nudged execute marker, or the one run that was actually earned disappears
# and it looks like the hook never fired.

printf '%s' "$SEL" | jq \
  --arg session "$SESSION" \
  --arg repo "$REPO_NAME" \
  --arg branch "$BRANCH" \
  --arg armed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg trigger "$TRIGGER" \
  --arg mode "$MODE" \
  --argjson spec_sync "$SPEC_SYNC" \
  '{session: $session, repo: $repo, branch: $branch, trigger: $trigger, mode: $mode,
    armed_at: $armed, nudged: false, spec_sync: $spec_sync,
    commands: .commands, features: .features,
    fallback: .fallback, unmapped: .unmapped}' \
  > "$PENDING_DIR/$SESSION.json" 2>/dev/null || exit 0

# The order the agent acts on. It is an ORDER, not a hand-off: the expected
# response to this text is a driven suite, not a message repeating the commands
# back to the operator and waiting for a "go". Staging is pre-authorised
# (root CLAUDE.md Rule 7); prod is not, and the driver check below is where that
# is caught.
# The build the run will actually hit differs per trigger, and saying "confirm
# the deploy is live" after a commit would be nonsense — there is no deploy to
# wait for. Naming the real situation is the whole point: a commit-triggered run
# CANNOT test what was just committed, and an agent that does not know that will
# report a pass as if it covered the change.
if [ "$TRIGGER" = "commit" ]; then
  read -r -d '' WHICH_BUILD <<EOF
⚠ THIS RUN CANNOT TEST WHAT YOU JUST COMMITTED. The commit has not been deployed
anywhere — the target is still running the PREVIOUS build. Treat the result as a
regression check on what was already live, and say so when you report it. A pass
here is NOT evidence the committed change works.
EOF
else
  read -r -d '' WHICH_BUILD <<EOF
⚠ CONFIRM THE DEPLOY IS LIVE FIRST. This fired the moment the push returned, so
the build is probably still going. Driving now tests the OLD build, passes, and
proves nothing.
EOF
fi

# PHASE 1 goes in FRONT of the run, and the ordering is the whole point: driving
# a validated-but-STALE spec is exactly as useless as driving an unvalidated one.
# Before bd-59809 this hook jumped straight to the suite, so a commit that changed
# a flow drove the scenarios written for the OLD flow — and passed.
PHASE1=""
if [ "$SPEC_SYNC" = "true" ]; then
  read -r -d '' PHASE1 <<EOF
━━ PHASE 1 — SYNC THE GHERKIN FIRST ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /sync-specs --brief $SYNC_FILE

The brief is already built: per feature it holds the changed files, a bounded
diff, and the scenarios the spec has today. Follow the \`gherkin-spec-sync\`
skill — it is the procedure, not a suggestion — and author through
\`gherkin-test-cases\`, the SAME skill \`/testcases\` runs. Do not free-hand a
scenario: that skips the risk model and the quality gate, which is the whole
reason the manual command produced decent tests.

  · ADD a scenario for behaviour the diff introduces that nothing covers.
  · UPDATE a scenario the diff contradicts.
  · NEVER DELETE. Tag it \`@obsolete\` with a
    \`# OBSOLETE <date> (<bead>): <why>\` line and list it in your report. A
    wrong auto-delete removes coverage silently and nobody notices for months.
  · A feature marked \`only_shared\` was pulled in by a fan-out file
    (whatsapp.service.js and friends). Nothing of ITS surface necessarily
    changed — leaving that spec alone is usually the right answer.

Then GATE on the validator — it is what stands between a machine-written spec
and a suite that runs the wrong scenarios:

  python3 .claude/qa/shared/validate_specs.py --only <features>

Errors mean do NOT run the suite. Fix them, or say plainly that phase 2 is
skipped and why. Warnings are advisory. If you changed the scenario COUNT for a
feature, update the per-feature counts in .claude/commands/niete-e2e.md too —
\`check-all-mode-counts.py\` is what catches that drift.

When the validator is GREEN, RELEASE phase 2. This is the mechanism, not a
formality: the runner REFUSES to drive this commit until the release stamp
exists, so an unsynced spec cannot reach the suite.

  python3 .claude/qa/shared/spec_sync.py --release $SYNC_FILE

(\`/sync-specs\` runs this for you at the end of its procedure.)

━━ PHASE 2 — THEN DRIVE THE SUITE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
fi

read -r -d '' CONTEXT <<EOF
EXECUTE THE TARGETED E2E NOW — $TRIGGER on \`$BRANCH\` ($REPO_NAME) touched code covered by these:

$(printf '%s\n' "$CMDS" | sed 's/^/  /')

$PHASE1

Drive them yourself, in that order, via Chrome DevTools MCP. Do NOT print this
list back and wait to be told to proceed — running it IS the response.

$WHICH_BUILD

Preconditions — check, do not skip:
  · A linked web.whatsapp.com session. \`list_pages\` DOES NOT TELL YOU THIS.
    The session lives in the browser profile, so an \`about:blank\` tab is not
    evidence of anything — NAVIGATE FIRST (\`navigate_page\` to
    https://web.whatsapp.com, or \`new_page\`), give it a few seconds to sync,
    then judge what is on screen:
      · a loaded chat list  → you are linked, proceed
      · a QR "Scan to log in" screen → the ONLY real failure here. Leave the QR
        up, \`take_screenshot\` it, and ask the runner to scan it (phone →
        Linked Devices → Link a device). Then re-check and carry on. If nobody
        is there to scan it, THAT is the precondition failure — say so and
        clear the marker below. An unattended run must not sit waiting.
    "No linked session" reported WITHOUT navigating is a wrong answer, not a
    precondition failure. Never fake a result.
  · The Chrome DevTools MCP. If \`list_pages\` is an unknown tool, the server is
    not loaded — and that is INSTALLABLE, not a dead end. \`/niete-e2e\` says
    "check FIRST, install if missing": the repo ships the declaration in
    \`.mcp.json\`, or add it by hand —
      claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest
    Claude Code must then be RESTARTED before the tools appear, so the honest
    report is "installed it, restart and I'll re-run", never "cannot run".
    Needs Node.js on PATH and desktop Google Chrome.
  · The driver is \`test_driver: prompt\` — the runner's OWN linked number.
    READ IT OFF THE SESSION rather than asking:
    \`localStorage['last-wid-md']\` returns e.g.
    "923028931858:40@c.us". Confirm it with the runner before the first send; do
    not make them type what the browser already knows.

A precondition that genuinely fails is the ONLY reason not to run: say which one,
plainly, then clear the marker:
  bash .claude/hooks/e2e-autorun.sh --clear --session $SESSION
A skipped run reported honestly is fine. A skipped run reported as a pass is not.
EOF

jq -n --arg ctx "$CONTEXT" \
  '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
exit 0
