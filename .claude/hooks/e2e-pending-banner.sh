#!/bin/bash
# SessionStart — announce QA work armed OUTSIDE any Claude session.
#
# The git post-commit hook (.githooks/post-commit) runs for a plain terminal
# commit and leaves `git-<sha>.json` (+ `.sync.json`) in .claude/.e2e-pending/.
# Nobody was in a session to be nudged, so the next session in this clone is
# told at start what is waiting: the Gherkin sync brief and the targeted E2E.
# The Stop hook (e2e-autorun-stop.sh) then holds that session's turn once until
# it drives or clears them. Silent when nothing is pending. Off: E2E_AUTORUN_OFF=1.
[ "${E2E_AUTORUN_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
_HOOK_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${_HOOK_DIR%/.claude/hooks}}"
PEND="$PROJECT_ROOT/.claude/.e2e-pending"
[ -d "$PEND" ] || exit 0
. "$_HOOK_DIR/lib/mock-lane.sh" 2>/dev/null || true
cat >/dev/null   # payload unused
LINES=""; N=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in *.sync.json) continue ;; esac
  [ "$(jq -r '.nudged // false' "$f" 2>/dev/null)" = "true" ] && continue
  id=$(basename "${f%.json}")
  sha=$(jq -r '.sha // ""' "$f" 2>/dev/null); at=$(jq -r '.armed_at // ""' "$f" 2>/dev/null)
  br=$(jq -r '.branch // "?"' "$f" 2>/dev/null); feats=$(jq -r '(.features // []) | join(", ")' "$f" 2>/dev/null)
  cmds=$(jq -r '(.commands // []) | join("   ")' "$f" 2>/dev/null)
  sync=""; [ "$(jq -r '.spec_sync // false' "$f" 2>/dev/null)" = "true" ] && [ -f "${f%.json}.sync.json" ] \
    && sync="  phase 1 first:  /sync-specs --brief .claude/.e2e-pending/$id.sync.json"
  N=$((N + 1))
  mockline=""
  if type e2e_split_lanes >/dev/null 2>&1; then
    e2e_split_lanes "$(printf '%s' "$feats" | tr -d ' ')"
    [ -n "${E2E_LANE_MOCK:-}" ] && [ -n "$sha" ] && mockline="  mock lane (tests THIS commit):  bash .claude/qa/shared/commit-e2e.sh $sha --features $E2E_LANE_MOCK"
  fi
  LINES="$LINES
• $id — commit ${sha:-?} on \`$br\`, armed $at — touched: ${feats:-?}
$sync
$mockline
  phase 2 (WhatsApp Web):  $cmds
  clear instead:  bash .claude/hooks/e2e-autorun.sh --clear --session $id"
done <<LS
$(ls -t "$PEND"/git-*.json 2>/dev/null)
LS
[ "$N" -gt 0 ] || exit 0
read -r -d '' CTX <<EOF
QA WORK IS PENDING FROM $N TERMINAL COMMIT(S) IN THIS CLONE. They were made outside
any Claude session, so their Gherkin specs have not been synced and their targeted
E2E has not been driven. The Stop hook will hold your turn once for the newest until
it is driven or cleared — do it early rather than at the end:
$LINES

Procedure: the gherkin-spec-sync skill for phase 1 (author through gherkin-test-cases,
never delete — tag @obsolete), gate on validate_specs.py, then /niete-e2e for phase 2.
EOF
jq -n --arg ctx "$CTX" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
exit 0
