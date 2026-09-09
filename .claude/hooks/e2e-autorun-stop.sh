#!/bin/bash
# Stop hook — ENFORCES the E2E run that `e2e-autorun.sh` armed.
#
# The Stop event is the only place a hook can compel rather than suggest:
# `{"decision":"block","reason":…}` refuses to let the turn end and feeds the
# reason back as context. PostToolUse cannot do this ("hooks cannot cause Claude
# to run a different command" — hooks reference), which is why the auto-run is
# split across two hooks and a marker file.
#
# IT NUDGES EXACTLY ONCE. This is the single most important line in the file.
#
# If the E2E genuinely cannot run — no linked WhatsApp Web session, Chrome MCP
# absent, the deploy failed — an unconditional Stop block wedges the session in a
# loop the agent cannot escape, and the fix everyone reaches for is deleting the
# hook, which takes the whole feature with it. So: block once, record that we
# did, then get out of the way. One guaranteed surfacing at end-of-turn is all
# the enforcement this needs; anything more is a trap.
#
# The marker is NOT deleted on nudge — it stays for visibility (and for
# `--clear` to report on). Only `nudged` flips.
#
# Since bd-59809 the nudge carries TWO phases when a spec-sync brief was armed:
# sync the Gherkin to the diff and validate it, THEN drive. Still ONE block —
# adding a phase must not add a second nudge, or the wedge this file exists to
# prevent comes back through the front door.
#
# Off switch: E2E_AUTORUN_OFF=1 (export it — inline `VAR=1 cmd` is invisible to
# hooks; see CLAUDE.md). E2E_SPEC_SYNC_OFF=1 drops phase 1 only.

[ "${E2E_AUTORUN_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0

_HOOK_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${_HOOK_DIR%/.claude/hooks}}"

INPUT=$(cat)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null)
PAYLOAD_CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)
PEND="$PROJECT_ROOT/.claude/.e2e-pending"
MARKER="$PEND/$SESSION.json"
# shellcheck source=lib/git-push-match.sh
. "$_HOOK_DIR/lib/git-push-match.sh" 2>/dev/null || exit 0

# PHASE 1 IS A GATE, NOT A NUDGE (bd-zqtgs). PR #841 changed training code from a
# session; the hook selected `training`, built the brief, nudged once — and the
# turn ended with training.feature untouched, because this hook asked "was it
# nudged?" and never "did the spec change?". Now a marker whose spec is still
# byte-identical to arming (and undeclared) keeps holding the turn — bounded to
# PHASE1_MAX_BLOCKS re-blocks so a session can never wedge; after that it lets go
# LOUDLY and the PR check (qa-impact.yml) is what catches it. Phase 2 (the E2E)
# still fires exactly once: a linked browser is a human precondition.
PHASE1_MAX_BLOCKS="${E2E_PHASE1_MAX_BLOCKS:-3}"
phase1_open() {   # $1 marker → prints "stale <feats>" or "invalid <validator text>", or nothing
  local st inv
  st=$(e2e_phase1_stale "$PROJECT_ROOT" "$1" "$PAYLOAD_CWD")
  if [ -n "$st" ]; then printf 'stale %s' "$st"; return 0; fi
  inv=$(e2e_phase1_invalid "$PROJECT_ROOT" "$1" "$PAYLOAD_CWD")
  [ -n "$inv" ] && printf 'invalid %s' "$inv"
  return 0
}

# Another session's pending run is not this session's problem. Keying on
# session_id is what keeps parallel agents (5+ on this repo) from blocking each
# other's turns over a push none of them made.
#
# ONE EXCEPTION: a marker armed by the git post-commit hook (`git-<sha>.json`,
# .githooks/post-commit). A terminal commit has no session, so nobody was there
# to nudge; the next Claude session in this clone inherits it, exactly once,
# the way it would its own. Otherwise the terminal path is a strictly weaker
# pipeline than the agent path. This session's OWN un-nudged marker still comes
# first — a git marker waits for the following turn rather than being folded in.
# These markers are per-clone, per-machine (gitignored), so nothing here can be
# another developer's.
# A marker still "owes" this session a stop when it is un-nudged (phase 2 not yet
# ordered) OR its phase 1 is still open (spec unchanged / invalid, undeclared).
owes() { [ -f "$1" ] || return 1
  [ "$(jq -r '.nudged // false' "$1" 2>/dev/null)" != "true" ] && return 0
  [ -n "$(phase1_open "$1")" ]; }
ADOPTED=""
if ! owes "$MARKER"; then
  MARKER=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in *.sync.json) continue ;; esac
    owes "$f" || continue
    MARKER="$f"; ADOPTED=1; break
  done <<EOF
$(ls -t "$PEND"/git-*.json 2>/dev/null)
EOF
  [ -n "$MARKER" ] || exit 0
fi

NUDGED=$(jq -r '.nudged // false' "$MARKER" 2>/dev/null)
# What `--clear --session <id>` needs, for either kind of marker.
CLEAR_ID=$(basename "${MARKER%.json}")

# ADVISORY MARKERS NEVER BLOCK (operator, 2026-08-25).
#
# A commit arms one purely so `--clear` and inspection can show what a deploy
# would have driven. Blocking on it would interrupt every commit of the day with
# a run that, by definition, can only drive the build that was already live.
# `// "execute"` keeps markers written before this field existed behaving as they
# always did — a missing mode must not silently disable the enforcement half.
MODE=$(jq -r '.mode // "execute"' "$MARKER" 2>/dev/null)
[ "$MODE" = "advisory" ] && exit 0

# ── the phase 1 RE-BLOCK: phase 2 was already ordered once; the spec is still open
if [ "$NUDGED" = "true" ]; then
  OPEN=$(phase1_open "$MARKER")
  [ -n "$OPEN" ] || exit 0
  BLOCKS=$(jq -r '.phase1_blocks // 0' "$MARKER" 2>/dev/null); case "$BLOCKS" in ''|null) BLOCKS=0 ;; esac
  KIND=${OPEN%% *}; DETAIL=${OPEN#* }
  FEATS=$(jq -r '.spec_hashes | keys | join(",")' "$MARKER" 2>/dev/null)
  SYNC_FILE="${MARKER%.json}.sync.json"
  if [ "$BLOCKS" -ge "$PHASE1_MAX_BLOCKS" ]; then
    echo "e2e-autorun-stop: phase 1 still $KIND for [$DETAIL] after $BLOCKS holds — letting the turn end. The Gherkin spec is NOT synced; qa-impact will fail the PR until it is synced or declared (Spec-Sync: trailer)." >&2
    exit 0
  fi
  TMP="$MARKER.tmp.$$"
  if jq '.phase1_blocks = ((.phase1_blocks // 0) + 1)' "$MARKER" > "$TMP" 2>/dev/null; then mv "$TMP" "$MARKER" 2>/dev/null || rm -f "$TMP"; else rm -f "$TMP"; fi
  N=$((BLOCKS + 1))
  if [ "$KIND" = "stale" ]; then
    WHY="$(for f in $DETAIL; do printf '  %s.feature is byte-identical to when this run was armed\n' "$f"; done)"
  else
    WHY="  the spec changed but does not pass the validator:
$(printf '%s' "$DETAIL" | sed 's/^/    /')"
  fi
  read -r -d '' REASON <<EOF
PHASE 1 IS NOT DONE — this turn is held (hold $N of $PHASE1_MAX_BLOCKS).

$WHY

The E2E for this change was already ordered and is not repeated here. What is
still owed is the Gherkin: driving a suite written for the OLD behaviour proves
nothing. Do ONE of these, then end the turn:

  /sync-specs --brief $SYNC_FILE
  python3 .claude/qa/shared/validate_specs.py --only $FEATS

  bash .claude/hooks/e2e-autorun.sh --declare --session $CLEAR_ID '$FEATS=none-needed (<why>)'
    — ONLY if the change alters no teacher-visible behaviour. Put the same line as
      a \`Spec-Sync:\` trailer on the commit so the PR check agrees.

\`--clear\` refuses while phase 1 is open; \`--clear --force\` is the escape hatch and
the PR check will still flag it. After $PHASE1_MAX_BLOCKS holds this stops asking.
EOF
  jq -n --arg reason "$REASON" '{decision: "block", reason: $reason}'
  exit 0
fi

# Flip `nudged` BEFORE emitting the block. If anything below fails — a crash, a
# malformed payload, a killed process — the worst case must be "we failed to
# nudge", never "we block forever".
TMP="$MARKER.tmp.$$"
if jq '.nudged = true' "$MARKER" > "$TMP" 2>/dev/null; then
  mv "$TMP" "$MARKER" 2>/dev/null || { rm -f "$TMP"; exit 0; }
else
  rm -f "$TMP"
  exit 0
fi

CMDS=$(jq -r '.commands[]?' "$MARKER" 2>/dev/null | sed 's/^/  /')
BRANCH=$(jq -r '.branch // "?"' "$MARKER" 2>/dev/null)
REPO=$(jq -r '.repo // "?"' "$MARKER" 2>/dev/null)
FALLBACK=$(jq -r '.fallback // false' "$MARKER" 2>/dev/null)
# Name the ACTUAL trigger. This said "push" unconditionally, so a commit-armed run
# announced "this session's push to main" with no push anywhere in sight. The
# marker has carried `trigger` since bd-43513; the message just never read it.
# `// "change"` covers a marker written before that field existed — better a
# slightly generic word than "session's  to main" with a hole in it.
TRIGGER=$(jq -r '.trigger // "change"' "$MARKER" 2>/dev/null)
[ -z "$TRIGGER" ] || [ "$TRIGGER" = "null" ] && TRIGGER=change
[ "$TRIGGER" = "git-commit" ] && TRIGGER=commit     # same build note as any commit
[ -z "$CMDS" ] && exit 0

# PHASE 1 — the Gherkin sync (bd-59809).
#
# Read from the MARKER, never re-derived here. The arming hook already decided
# whether a sync was armed (it may have been switched off with E2E_SPEC_SYNC_OFF,
# or the brief may have failed to build), and the two halves must not be able to
# disagree — the same reason `mode` and `trigger` are recorded rather than
# re-computed. `// false` keeps markers written before this field existed silent
# instead of inventing a phase they never armed.
SPEC_SYNC=$(jq -r '.spec_sync // false' "$MARKER" 2>/dev/null)
SYNC_FILE="${MARKER%.json}.sync.json"
PHASE1=""
if [ "$SPEC_SYNC" = "true" ] && [ -f "$SYNC_FILE" ]; then
  read -r -d '' PHASE1 <<EOF
━━ PHASE 1 FIRST — SYNC THE GHERKIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /sync-specs --brief $SYNC_FILE

Driving a STALE spec proves nothing: the suite passes against the scenarios
written for the behaviour you just changed. Author through \`gherkin-test-cases\`
(the skill \`/testcases\` runs) — never free-hand. Then validate:

  python3 .claude/qa/shared/validate_specs.py --only <features>

Errors mean phase 2 does not run. Never delete a scenario — tag it \`@obsolete\`
with a reason and report it.

THIS PHASE IS A GATE: the turn will be held again (up to $PHASE1_MAX_BLOCKS times) while the
.feature is unchanged and undeclared, and \`--clear\` refuses. If the change truly
alters nothing a teacher sees, declare it instead of skipping it:
  bash .claude/hooks/e2e-autorun.sh --declare --session $CLEAR_ID '<feature>=none-needed (<why>)'

━━ PHASE 2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EOF
fi

EXTRA=""
if [ "$FALLBACK" = "true" ]; then
  EXTRA="
The SAFE subset is in that list because this push touched files the feature map
does not claim. Adding them to feature-map.yaml narrows it next time."
fi

# WHICH BUILD THIS ACTUALLY DRIVES — the single most misreadable thing about a
# commit-armed run, and the reason PR #37 made commits silent in the first place.
# A commit deploys nothing, so the run hits the build that was already live. That
# is a legitimate regression check; it is NOT evidence about the commit. Saying so
# here is what keeps an honest pass from being reported as a false one.
if [ "$TRIGGER" = "commit" ]; then
  read -r -d '' BUILD_NOTE <<EOF
⚠ THIS CANNOT TEST WHAT WAS JUST COMMITTED. The commit has not been deployed — the
target still runs the PREVIOUS build. Run it as a regression check and report it
as one. Do not present a pass as evidence the committed change works.
EOF
else
  read -r -d '' BUILD_NOTE <<EOF
⚠ Confirm what is live before trusting a pass. The push that armed this fired the
moment it returned, while the build was probably still going — a pass on the old
build is worse than no run at all.
EOF
fi

# The full suite is a different order of commitment from a targeted selection and
# has to be named as one. An agent that reads "/niete-e2e all" as a quick check
# will abandon it half-driven, which lands the worst outcome: a partial run
# reported as a suite.
ALL_NOTE=""
case "$CMDS" in
  */niete-e2e\ all*)
    read -r -d '' ALL_NOTE <<EOF

⏱ THIS IS THE FULL SUITE — 99 scenarios across 7 features, and it takes HOURS.
Coaching's 15 scenarios each upload real audio and wait ~10min on analysis. Every
scenario needs its own PASS/FAIL/SKIP line with evidence; a summary of "the core
paths passed" is not an \`all\` run. If you cannot finish it, say so before you
start rather than reporting a partial run as a suite.
EOF
    ;;
esac

# A git-armed marker is named as such: the agent must know the commit was made
# outside any session (so nothing was synced or driven yet) and which one it was.
if [ -n "$ADOPTED" ]; then
  GSHA=$(jq -r '.sha // ""' "$MARKER" 2>/dev/null); GAT=$(jq -r '.armed_at // ""' "$MARKER" 2>/dev/null)
  WHOSE="a TERMINAL commit in this clone ($CLEAR_ID${GSHA:+, sha $GSHA}${GAT:+, armed $GAT}) — made outside any Claude session, so nothing has been synced or driven for it yet — to \`$BRANCH\` ($REPO)"
else
  WHOSE="this session's $TRIGGER to \`$BRANCH\` ($REPO)"
fi

read -r -d '' REASON <<EOF
EXECUTE NOW — the E2E for $WHOSE has not
been driven:

$CMDS
$EXTRA$ALL_NOTE
$PHASE1
Drive them via Chrome DevTools MCP before this turn ends. Running them IS the
expected response — do not end the turn by repeating the list back and asking
whether to proceed.

$BUILD_NOTE

A linked web.whatsapp.com session is required — and \`list_pages\` ALONE CANNOT
TELL YOU there isn't one. The session lives in the browser profile, so a blank
tab proves nothing. \`navigate_page\` to https://web.whatsapp.com first, then
judge: a chat list means go; a QR screen means leave it up, ask the runner to
scan it (phone → Linked Devices → Link a device), and carry on once linked.

A precondition that genuinely fails — a QR screen nobody scans, the deploy
failed — is the only reason not to run. A missing Chrome DevTools MCP is NOT
one: install it (\`claude mcp add chrome-devtools -- npx -y
chrome-devtools-mcp@latest\`), say a restart is needed, and re-run after it.

Name the one that failed, plainly, and clear the marker. A skipped run reported
honestly is fine; reported as a pass it is not.

Clear it either way when you are done:
  bash .claude/hooks/e2e-autorun.sh --clear --session $CLEAR_ID

(The E2E order above fires once for this $TRIGGER — you will not be stopped again for
it. Phase 1 — the Gherkin — is different: it holds the turn until the spec is changed
and valid, or declared none-needed.)
EOF

jq -n --arg reason "$REASON" '{decision: "block", reason: $reason}'
exit 0
