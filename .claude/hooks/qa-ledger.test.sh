#!/usr/bin/env bash
# qa-ledger.test.sh — every way the QA pipeline is switched off, gives up, or is
# cleared leaves one line in the clone's QA ledger (bd-61jjzd).
#
#   bash .claude/hooks/qa-ledger.test.sh
#
# WHY. From 2026-10-17 most sandbox PRs landed with stale Gherkin specs, and
# nothing on any machine could say why: E2E_AUTORUN_OFF, E2E_SPEC_SYNC_OFF and
# QA_HOOKS_OFF exit silently, the Stop hook lets a stale spec go after 3 holds
# with one stderr line nobody keeps, and `--clear --force` leaves no trace. The
# ledger is `<git common dir>/qa-events.jsonl` — shared by every worktree of a
# clone, outside the tree, so removing a worktree does not remove its history.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REAL_ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
unset E2E_AUTORUN_OFF E2E_SPEC_SYNC_OFF QA_HOOKS_OFF QA_HOOKS_QUIET QA_HOOKS_STRICT CI QA_LEDGER
export E2E_AUTOFIX_OFF=1

TMP=$(mktemp -d "${TMPDIR:-/tmp}/qaledger.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
R="$TMP/NIETE-Rumi"
mkdir -p "$R/bot/shared/services" "$R/tests/features/whatsapp" "$R/.claude" "$R/scripts"
cp -R "$REAL_ROOT/.claude/qa"    "$R/.claude/qa";    cp -R "$REAL_ROOT/.claude/hooks" "$R/.claude/hooks"
cp -R "$REAL_ROOT/.githooks"     "$R/.githooks";     cp -R "$REAL_ROOT/scripts/qa"    "$R/scripts/qa"
cp -R "$REAL_ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results" "$R/.claude/.e2e-pending"
printf "module.exports = { ROWS: ['Teacher Training'] };\n" > "$R/bot/shared/services/menu.service.js"
printf 'module.exports = { send: () => {} };\n' > "$R/bot/shared/services/whatsapp.service.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name "Test Operator"
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
S="ledger-$$"; PEND="$R/.claude/.e2e-pending"
HOOK="$R/.claude/hooks/e2e-autorun.sh"; STOP="$R/.claude/hooks/e2e-autorun-stop.sh"
LEDGER="$R/.git/qa-events.jsonl"

touch_menu() { printf '// change %s\n' "$RANDOM" >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null; }
payload() { printf '{"session_id":"%s","cwd":"%s","tool_name":"Bash","tool_input":{"command":"%s"},"tool_response":{"stdout":"","stderr":""}}' "$S" "$R" "$1"; }
arm() { touch_menu; git -C "$R" -c core.hooksPath=/dev/null commit -qm "${1:-feat(menu): change}"; payload "git commit -m x" | CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1; }
stop() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$R" | CLAUDE_PROJECT_DIR="$R" bash "$STOP" >/dev/null 2>&1; }
lines() { [ -f "$LEDGER" ] && wc -l < "$LEDGER" | tr -d ' ' || echo 0; }
count() { [ -f "$LEDGER" ] && jq -c "select($1)" "$LEDGER" 2>/dev/null | wc -l | tr -d ' ' || echo 0; }
last() { tail -1 "$LEDGER" 2>/dev/null | jq -r "$1" 2>/dev/null; }
clear_all() { bash "$HOOK" --clear --force </dev/null >/dev/null 2>&1; rm -f "$LEDGER"; }

echo "qa-ledger — E2E_AUTORUN_OFF on a session commit"
touch_menu; git -C "$R" -c core.hooksPath=/dev/null commit -qm "feat(menu): off"
payload "git commit -m x" | E2E_AUTORUN_OFF=1 CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1
say "one ledger line"                       "$(lines)" "1"
say "…names the hook"                       "$(last .hook)"   "e2e-autorun"
say "…the event"                            "$(last .event)"  "switch-off"
say "…and the switch"                       "$(last .switch)" "E2E_AUTORUN_OFF"
say "…carries the commit"                   "$(last .sha)"    "$(git -C "$R" rev-parse --short=12 HEAD)"
say "…and who"                              "$(last .user)"   "Test Operator"
payload "ls -la" | E2E_AUTORUN_OFF=1 CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1
say "a non-git command with the switch on logs nothing" "$(lines)" "1"
clear_all

echo "qa-ledger — E2E_SPEC_SYNC_OFF on a session commit"
touch_menu; git -C "$R" -c core.hooksPath=/dev/null commit -qm "feat(menu): nosync"
payload "git commit -m x" | E2E_SPEC_SYNC_OFF=1 CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1
say "logged as a switch-off of E2E_SPEC_SYNC_OFF" "$(count '.hook=="e2e-autorun" and .event=="switch-off" and .switch=="E2E_SPEC_SYNC_OFF"')" "1"
clear_all

echo "qa-ledger — the Stop hook giving up on a stale spec"
arm "feat(menu): stale"
for i in 1 2 3 4 5 6; do stop; done
say "gave-up logged exactly once"           "$(count '.hook=="e2e-autorun-stop" and .event=="gave-up"')" "1"
say "…naming the stale feature"             "$(count '.event=="gave-up" and (.detail|test("menu"))')" "1"
clear_all

echo "qa-ledger — E2E_AUTORUN_OFF while a marker is pending"
arm "feat(menu): pending"
for i in 1 2; do printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$R" | E2E_AUTORUN_OFF=1 CLAUDE_PROJECT_DIR="$R" bash "$STOP" >/dev/null 2>&1; done
say "Stop switch-off logged once per marker" "$(count '.hook=="e2e-autorun-stop" and .event=="switch-off"')" "1"
clear_all

echo "qa-ledger — clearing"
arm "feat(menu): forced"
bash "$HOOK" --clear --session "$S" --force </dev/null >/dev/null 2>&1
say "--clear --force is logged as force-cleared" "$(count '.event=="force-cleared" and .detail=="'"$S"'"')" "1"
rm -f "$LEDGER"
bash "$HOOK" --clear --session nothing-here </dev/null >/dev/null 2>&1
say "clearing a marker that does not exist logs nothing" "$(lines)" "0"

echo "qa-ledger — terminal git hooks"
(cd "$R" && bash scripts/qa/install-hooks.sh --quiet >/dev/null 2>&1)
touch_menu; QA_HOOKS_OFF=1 git -C "$R" commit -qm "feat(menu): terminal off" 2>/dev/null
say "post-commit QA_HOOKS_OFF logged" "$(count '.hook=="post-commit" and .switch=="QA_HOOKS_OFF"')" "1"
touch_menu; E2E_SPEC_SYNC_OFF=1 git -C "$R" commit -qm "feat(menu): terminal nosync" 2>/dev/null
say "post-commit E2E_SPEC_SYNC_OFF logged" "$(count '.hook=="post-commit" and .switch=="E2E_SPEC_SYNC_OFF"')" "1"
git init -q --bare "$TMP/remote.git"; git -C "$R" remote add origin "$TMP/remote.git"
QA_HOOKS_OFF=1 git -C "$R" push -q origin sandbox 2>/dev/null
say "pre-push QA_HOOKS_OFF logged" "$(count '.hook=="pre-push" and .switch=="QA_HOOKS_OFF"')" "1"
touch_menu; git -C "$R" commit -qm "feat(menu): terminal on" 2>/dev/null
say "a normal commit adds no ledger line" "$(count '.hook=="post-commit"')" "2"

echo "qa-ledger — one ledger for every worktree of the clone"
git -C "$R" worktree add -q --detach "$TMP/wt" HEAD
touch_menu_wt() { printf '// wt\n' >> "$TMP/wt/bot/shared/services/menu.service.js"; git -C "$TMP/wt" add -A >/dev/null; }
touch_menu_wt; QA_HOOKS_OFF=1 git -C "$TMP/wt" commit -qm "feat(menu): from a worktree" 2>/dev/null
say "a worktree's switch-off lands in the clone's ledger" "$(count '.hook=="post-commit" and .switch=="QA_HOOKS_OFF"')" "2"
say "every line is valid JSON" "$(jq -c . "$LEDGER" 2>/dev/null | wc -l | tr -d ' ')" "$(lines)"

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
