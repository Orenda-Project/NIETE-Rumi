#!/usr/bin/env bash
# qa-notes.test.sh — the QA ledger says WHY a spec was missed, where the dashboard can read it (bd-amxdhg).
#
#   bash .claude/hooks/qa-notes.test.sh
#
# WHY. bd-61jjzd put every switch-off, give-up and clear on <git common dir>/qa-events.jsonl —
# but that file never leaves the laptop, so "why did PR #3755 miss its spec?" still meant asking
# the author to run jq. Now the ledger also records the arming, a local --declare and a push with
# a stale spec, and each commit's lines are published to origin as a git note under
# refs/qa-hooks/<clone-id>. The dashboard fetches those refs and shows the reason.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REAL_ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
unset E2E_AUTORUN_OFF E2E_SPEC_SYNC_OFF QA_HOOKS_OFF QA_HOOKS_QUIET QA_HOOKS_STRICT CI QA_LEDGER QA_NOTES_OFF GITHUB_ACTIONS
export E2E_AUTOFIX_OFF=1 QA_NOTES_SYNC=1   # publish in the foreground so the test can look at once

TMP=$(mktemp -d "${TMPDIR:-/tmp}/qanotes.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
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
git init -q --bare "$TMP/remote.git"; git -C "$R" remote add origin "$TMP/remote.git"
git -C "$R" -c core.hooksPath=/dev/null push -q origin sandbox 2>/dev/null
S="notes-$$"; PEND="$R/.claude/.e2e-pending"
HOOK="$R/.claude/hooks/e2e-autorun.sh"; STOP="$R/.claude/hooks/e2e-autorun-stop.sh"; LIB="$R/.claude/hooks/lib/qa-ledger.sh"
LEDGER="$R/.git/qa-events.jsonl"

touch_menu() { printf '// change %s\n' "$RANDOM" >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null; }
payload() { printf '{"session_id":"%s","cwd":"%s","tool_name":"Bash","tool_input":{"command":"%s"},"tool_response":{"stdout":"","stderr":""}}' "$S" "$R" "$1"; }
commit_nohooks() { touch_menu; git -C "$R" -c core.hooksPath=/dev/null commit -qm "${1:-feat(menu): change}"; }
arm() { commit_nohooks "$1"; payload "git commit -m x" | CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1; }
stop() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$R" | CLAUDE_PROJECT_DIR="$R" bash "$STOP" >/dev/null 2>&1; }
count() { [ -f "$LEDGER" ] && jq -c "select($1)" "$LEDGER" 2>/dev/null | wc -l | tr -d ' ' || echo 0; }
short() { git -C "$R" rev-parse --short=12 "${1:-HEAD}"; }
remote_refs() { git -C "$TMP/remote.git" for-each-ref --format='%(refname)' refs/qa-hooks/ | wc -l | tr -d ' '; }
# the note on commit $1 as the dashboard reads it: fetch refs/qa-hooks/* into a notes namespace
remote_note() {
  rm -rf "$TMP/reader"; git clone -q --bare "$TMP/remote.git" "$TMP/reader" 2>/dev/null
  git -C "$TMP/reader" fetch -q origin '+refs/qa-hooks/*:refs/notes/qa-remote/*' 2>/dev/null
  local ref; ref=$(git -C "$TMP/reader" for-each-ref --format='%(refname:lstrip=2)' refs/notes/qa-remote/ | head -1)
  [ -n "$ref" ] && git -C "$TMP/reader" notes --ref="$ref" show "$(git -C "$R" rev-parse "$1")" 2>/dev/null
}
reset() { bash "$HOOK" --clear --force </dev/null >/dev/null 2>&1; rm -f "$LEDGER"; git -C "$R" update-ref -d refs/notes/qa-hooks 2>/dev/null
          for r in $(git -C "$TMP/remote.git" for-each-ref --format='%(refname)' refs/qa-hooks/); do git -C "$TMP/remote.git" update-ref -d "$r"; done; }

echo "qa-notes — the session hook records the arming"
arm "feat(menu): armed"
say "one armed line from e2e-autorun"       "$(count '.hook=="e2e-autorun" and .event=="armed"')" "1"
say "…tied to the commit"                   "$(count '.event=="armed" and .sha=="'"$(short)"'"')" "1"
say "…naming the feature"                   "$(count '.event=="armed" and (.detail|test("menu"))')" "1"
say "an arming alone publishes nothing yet" "$(remote_refs)" "0"

echo "qa-notes — giving up is published at once, on the ARMED commit"
ARMED=$(short)
commit_nohooks "chore: HEAD moves on after the arming"
for i in 1 2 3 4 5 6; do stop; done
say "gave-up carries the marker's commit, not HEAD" "$(count '.event=="gave-up" and .sha=="'"$ARMED"'"')" "1"
say "one ref on origin for this clone"      "$(remote_refs)" "1"
NOTE=$(remote_note "$ARMED")
say "the note holds the gave-up line"       "$(printf '%s\n' "$NOTE" | jq -r 'select(.event=="gave-up") | .hook' 2>/dev/null)" "e2e-autorun-stop"
say "…and the arming line"                  "$(printf '%s\n' "$NOTE" | jq -r 'select(.event=="armed") | .hook' 2>/dev/null)" "e2e-autorun"
say "…and no local path"                    "$(printf '%s\n' "$NOTE" | jq -r 'select(has("cwd")) | .cwd' 2>/dev/null | wc -l | tr -d ' ')" "0"
reset

echo "qa-notes — a local --declare is recorded with its reason"
arm "feat(menu): declared"
ARMED=$(short)
commit_nohooks "chore: move HEAD"
bash "$HOOK" --declare --session "$S" 'menu=none-needed (copy only, no teacher-visible change)' </dev/null >/dev/null 2>&1
say "declared logged on the marker's commit" "$(count '.event=="declared" and .sha=="'"$ARMED"'"')" "1"
say "…with the reason"                       "$(count '.event=="declared" and (.detail|test("copy only"))')" "1"
say "…and published"                         "$(remote_note "$ARMED" | jq -r 'select(.event=="declared") | .event' 2>/dev/null)" "declared"
reset

echo "qa-notes — terminal commits and pushes"
(cd "$R" && bash scripts/qa/install-hooks.sh --quiet >/dev/null 2>&1)
git -C "$R" checkout -q -b feat-x
touch_menu; git -C "$R" commit -qm "feat(menu): terminal" 2>/dev/null
say "post-commit records the arming"        "$(count '.hook=="post-commit" and .event=="armed" and .sha=="'"$(short)"'"')" "1"
LINES_BEFORE=$(count 'true')
git -C "$R" push -q origin feat-x 2>/dev/null
say "a push with a stale spec is recorded"  "$(count '.hook=="pre-push" and .event=="pushed-stale" and .sha=="'"$(short)"'"')" "1"
say "the pushed commit's note is on origin" "$(remote_note HEAD | jq -r 'select(.hook=="post-commit") | .event' 2>/dev/null)" "armed"
say "publishing never re-runs pre-push"     "$(count '.hook=="pre-push"')" "1"
say "the push itself added only that line"  "$(count 'true')" "$((LINES_BEFORE + 1))"
reset

echo "qa-notes — switches and failure modes"
touch_menu; QA_NOTES_OFF=1 E2E_SPEC_SYNC_OFF=1 git -C "$R" commit -qm "feat(menu): notes off" 2>/dev/null
say "QA_NOTES_OFF: still on the local ledger" "$(count '.switch=="E2E_SPEC_SYNC_OFF"')" "1"
say "…but nothing published"                "$(remote_refs)" "0"
touch_menu; CI=1 E2E_SPEC_SYNC_OFF=1 git -C "$R" commit -qm "feat(menu): in ci" 2>/dev/null
say "CI: nothing published"                 "$(remote_refs)" "0"
git -C "$R" remote set-url origin "$TMP/does-not-exist.git"
touch_menu; E2E_SPEC_SYNC_OFF=1 git -C "$R" commit -qm "feat(menu): unreachable" 2>/dev/null; RC=$?
say "an unreachable origin never fails the commit" "$RC" "0"
say "…and the line is still logged"         "$(count '.switch=="E2E_SPEC_SYNC_OFF"')" "3"
git -C "$R" remote set-url origin "$TMP/remote.git"

echo "qa-notes — backfill"
bash "$LIB" --publish "$R" >/dev/null 2>&1; RC=$?
say "--publish exits 0"                     "$RC" "0"
say "--publish puts every ledger commit on origin" "$(remote_note HEAD | jq -r 'select(.switch=="E2E_SPEC_SYNC_OFF") | .event' 2>/dev/null)" "switch-off"
say "…the notes-off commit too"             "$(remote_note HEAD~2 | jq -r '.event' 2>/dev/null | sort -u | tr '\n' ' ')" "armed switch-off "
OUT=$(. "$LIB"; qa_ledger_log "$R" t armed "" ""; echo "rc=$?")
say "sourcing the lib and logging prints nothing but our echo" "$OUT" "rc=0"

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
