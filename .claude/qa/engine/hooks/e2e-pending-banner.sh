#!/bin/bash
# SessionStart — announce QA work armed OUTSIDE any Claude session.
#
# The git post-commit hook (.claude/qa/engine/githooks/post-commit) runs for a plain terminal
# commit and leaves `git-<sha>.json` (+ `.sync.json`) in .claude/.e2e-pending/.
# Nobody was in a session to be nudged, so the next session in this clone is
# told at start what is waiting: the Gherkin sync brief and the targeted E2E.
# The Stop hook (e2e-autorun-stop.sh) then holds that session's turn once until
# it drives or clears them. Silent when nothing is pending. Off: E2E_AUTORUN_OFF=1.
#
# ALSO (2026-09-09, bd-57aky): install the git hooks if this clone has none.
# The whole terminal-commit half of the pipeline rests on `core.hooksPath =
# .claude/qa/engine/githooks`, which only `npm install` at the root or .claude/qa/engine/scripts/install-hooks.sh
# ever set — PRs #835/#836 came from a clone where neither had happened, so no
# marker was ever written and nothing said so. A Claude session is the one moment
# we KNOW we are inside the clone with a shell, so it sets it. Idempotent, never
# clobbers a foreign hooksPath (says how to take it over instead), never fails
# the session start.
[ "${E2E_AUTORUN_OFF:-}" = "1" ] && exit 0
command -v jq >/dev/null 2>&1 || exit 0
_HOOK_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
# The engine is vendored at <repo>/.claude/qa/engine, so its hooks dir is four levels below the repo root.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-${_HOOK_DIR%/.claude/qa/engine/hooks}}"
. "$_HOOK_DIR/lib/mock-lane.sh" 2>/dev/null || true   # so e2e_split_lanes exists for the mock-lane line below
# shellcheck source=lib/tenants.sh
. "$_HOOK_DIR/lib/tenants.sh" 2>/dev/null || exit 0
cat >/dev/null   # payload unused
# Not a guarded repo (no tenants.yaml): nothing pending can exist here.
e2e_root >/dev/null 2>&1 || exit 0
E2E_CMD=$(e2e_cmd); E2E_LANDING=$(e2e_get branches.landing)

INSTALL_CTX=""
if [ -f "$PROJECT_ROOT/.claude/qa/engine/scripts/install-hooks.sh" ] \
   && git -C "$PROJECT_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  CUR=$(git -C "$PROJECT_ROOT" config --get core.hooksPath 2>/dev/null)
  if [ -z "$CUR" ]; then
    (cd "$PROJECT_ROOT" && bash .claude/qa/engine/scripts/install-hooks.sh --quiet >/dev/null 2>&1)
    NOW=$(git -C "$PROJECT_ROOT" config --get core.hooksPath 2>/dev/null)
    if [ "$NOW" = ".claude/qa/engine/githooks" ]; then
      INSTALL_CTX="QA GIT HOOKS WERE NOT INSTALLED IN THIS CLONE — this session just installed them
(core.hooksPath=.claude/qa/engine/githooks; .claude/qa/engine/githooks/post-commit + pre-push). From now on every commit here
selects its E2E features and leaves a marker, and every push prints the impact report.
Nothing else to do. (Undo: bash .claude/qa/engine/scripts/install-hooks.sh --uninstall)"
    else
      INSTALL_CTX="QA GIT HOOKS ARE NOT INSTALLED IN THIS CLONE and the automatic install did not take.
Run:  bash .claude/qa/engine/scripts/install-hooks.sh   (then re-check: git config --get core.hooksPath)"
    fi
  elif [ "$CUR" != ".claude/qa/engine/githooks" ]; then
    INSTALL_CTX="QA GIT HOOKS ARE NOT ACTIVE IN THIS CLONE: core.hooksPath is '$CUR', so .claude/qa/engine/githooks/post-commit
never runs and commits here arm no E2E. Either take it over —  bash .claude/qa/engine/scripts/install-hooks.sh --force
— or chain .claude/qa/engine/githooks/post-commit and .claude/qa/engine/githooks/pre-push from the hooks in '$CUR'."
  fi
fi

# Machine readiness for the mock lane (layer 1, the run that tests a commit itself). Without
# the keys file (keys.local in tenants.yaml) + redis-server every commit's mock run stops before starting and the ledger
# stays `e2e: missing` — say so at session start, with the one-time fix, not on the agent's turn.
MOCK_CTX=""
# E2E_AUTOFIX_OFF=1 (CI, the engine's own tests) also silences this block: with the fix disabled there is nothing a
# session could do about it, and a fixture repo is not a developer machine.
if [ "${E2E_AUTOFIX_OFF:-}" != "1" ] && type e2e_mock_lane_autofix >/dev/null 2>&1 && git -C "$PROJECT_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  _MAIN=$(e2e_main_checkout "$PROJECT_ROOT")
  _FIX=$(e2e_mock_lane_autofix "$_MAIN"); _FIX_RC=$?
  _DONE=$(printf '%s\n' "$_FIX" | grep '^auto-' || true)
  if [ "$_FIX_RC" -ne 0 ]; then
    MOCK_CTX="$(e2e_mock_not_ready_block "$(e2e_mock_lane_ready "$_MAIN"; printf '%s\n' "$_FIX" | grep -E 'failed|unavailable' || true)")
Until that is done, report a commit's mock lane as NOT RUN (and why) — never as a pass."
  elif [ -n "$_DONE" ]; then
    MOCK_CTX="MOCK LANE: this session fixed the machine automatically — $_DONE. Nothing to do."
  fi
fi

PEND="$PROJECT_ROOT/.claude/.e2e-pending"
LINES=""; N=0
[ -d "$PEND" ] || PEND=""
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
    if [ -n "${E2E_LANE_MOCK:-}" ] && [ -n "$sha" ]; then
      mockline="  mock lane (tests THIS commit):  bash .claude/qa/engine/bin/commit-e2e.sh $sha --features $E2E_LANE_MOCK"
      # the same split the Stop hook applies: those features leave the WhatsApp Web line
      cmds=$(e2e_filter_chrome_cmds "$(jq -r '(.commands // [])[]' "$f" 2>/dev/null)" "$E2E_LANE_MOCK" | awk 'NF{a[++n]=$0} END{for(i=1;i<=n;i++) printf "%s%s", (i>1?"   ":""), a[i]}')
    fi
  fi
  LINES="$LINES
• $id — commit ${sha:-?} on \`$br\`, armed $at — touched: ${feats:-?}
$sync
$mockline
  phase 2 (WhatsApp Web):  ${cmds:-— none for this commit; $E2E_CMD tests it after the $E2E_LANDING deploy}
  clear instead:  bash .claude/qa/engine/hooks/e2e-autorun.sh --clear --session $id"
done <<LS
$([ -n "$PEND" ] && ls -t "$PEND"/git-*.json 2>/dev/null)
LS
if [ "$N" -eq 0 ]; then
  [ -n "$INSTALL_CTX$MOCK_CTX" ] || exit 0
  jq -n --arg ctx "${INSTALL_CTX:+$INSTALL_CTX
}${INSTALL_CTX:+${MOCK_CTX:+
}}$MOCK_CTX" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
  exit 0
fi
read -r -d '' CTX <<EOF
${INSTALL_CTX:+$INSTALL_CTX

}${MOCK_CTX:+$MOCK_CTX

}QA WORK IS PENDING FROM $N TERMINAL COMMIT(S) IN THIS CLONE. They were made outside
any Claude session, so their Gherkin specs have not been synced and their targeted
E2E has not been driven. The Stop hook will hold your turn once for the newest until
it is driven or cleared — do it early rather than at the end:
$LINES

Procedure: the gherkin-spec-sync skill for phase 1 (author through gherkin-test-cases,
never delete — tag @obsolete), gate on validate_specs.py, then $E2E_CMD for phase 2.
EOF
jq -n --arg ctx "$CTX" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}'
exit 0
