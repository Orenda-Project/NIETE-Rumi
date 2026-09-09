#!/usr/bin/env bash
# e2e-phase1-gate.test.sh — phase 1 (the Gherkin sync) is a GATE, not a nudge (bd-zqtgs).
#
#   bash .claude/hooks/e2e-phase1-gate.test.sh
#
# WHY. NIETE-Rumi PR #841 changed training code from a Claude session; the hook
# selected `training`, built the brief, nudged once at the end of the turn — and
# the turn ended with training.feature untouched. The Stop hook checked "was it
# nudged?", never "did the spec change?", and its message said "clear it either
# way". So: a stale spec now keeps holding the turn (bounded — 3 re-blocks, then
# it lets go loudly and the PR check catches it), `--clear` refuses while stale,
# and the two legitimate exits are a changed+valid spec or an explicit
# declaration (`--declare`, or a `Spec-Sync:` trailer on HEAD). Phase 2 (the
# WhatsApp E2E) still nudges exactly once — a linked browser is a human precondition.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REAL_ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }
unset E2E_AUTORUN_OFF E2E_SPEC_SYNC_OFF QA_HOOKS_OFF CI

TMP=$(mktemp -d "${TMPDIR:-/tmp}/phase1gate.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
# One dir is both the project root AND the repo, like a real clone.
R="$TMP/NIETE-Rumi"
mkdir -p "$R/bot/shared/services" "$R/tests/features/whatsapp" "$R/.claude" "$R/scripts"
cp -R "$REAL_ROOT/.claude/qa"    "$R/.claude/qa";    cp -R "$REAL_ROOT/.claude/hooks" "$R/.claude/hooks"
cp -R "$REAL_ROOT/.githooks"     "$R/.githooks";     cp -R "$REAL_ROOT/scripts/qa"    "$R/scripts/qa"
cp -R "$REAL_ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results" "$R/.claude/.e2e-pending"
SPEC="$R/tests/features/whatsapp/niete/menu.feature"
cat > "$R/bot/shared/services/menu.service.js" <<'JS'
const ROWS = ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything'];
module.exports = { ROWS };
JS
printf 'module.exports = { send: () => {} };\n' > "$R/bot/shared/services/whatsapp.service.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
S="gate-$$"; PEND="$R/.claude/.e2e-pending"; MARKER="$PEND/$S.json"
HOOK="$R/.claude/hooks/e2e-autorun.sh"; STOP="$R/.claude/hooks/e2e-autorun-stop.sh"

arm() {  # a session commit touching menu
  printf '// change %s\n' "$RANDOM" >> "$R/bot/shared/services/menu.service.js"
  git -C "$R" add -A >/dev/null; git -C "$R" -c core.hooksPath=/dev/null commit -qm "${1:-feat(menu): change}"
  printf '{"session_id":"%s","cwd":"%s","tool_name":"Bash","tool_input":{"command":"git commit -m x"},"tool_response":{"stdout":"","stderr":""}}' "$S" "$R" \
    | CLAUDE_PROJECT_DIR="$R" bash "$HOOK" >/dev/null 2>&1
}
stop() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$R" | CLAUDE_PROJECT_DIR="$R" bash "$STOP" 2>/dev/null; }
field() { jq -r "$2" "$1" 2>/dev/null; }
good_edit() {  # a valid, meaningful spec change
  python3 - "$SPEC" <<'PY'
import sys; p=sys.argv[1]; s=open(p,encoding="utf-8").read()
s=s.replace('And the list opener button is labelled "View Features"','And the list opener button is labelled "Explore Features"')
open(p,"w",encoding="utf-8").write(s)
PY
}
bad_edit() {  # duplicate a scenario name → validator must refuse
  python3 - "$SPEC" <<'PY'
import sys,re; p=sys.argv[1]; s=open(p,encoding="utf-8").read()
m=re.search(r'^(\s*Scenario: .+)$', s, re.M); name=m.group(1)
s=s.rstrip()+"\n\n  @whatsapp @ict @profile:niete @feature:menu @persona:teacher @e2e @p3\n"+name+"\n    Given a registered teacher\n    When she sends \"/menu\"\n    Then the menu card is shown\n"
open(p,"w",encoding="utf-8").write(s)
PY
}
restore_spec() { git -C "$R" checkout -q -- tests/features/whatsapp/niete/menu.feature; }

echo "phase-1 gate — arming records what the spec looked like"
arm "feat(menu): first"
[ -f "$MARKER" ] && ok "marker armed" || bad "marker missing"
say "spec_sync armed"                       "$(field "$MARKER" '.spec_sync')" "true"
say "marker carries a hash of menu.feature" "$([ -n "$(field "$MARKER" '.spec_hashes.menu.hash // ""')" ] && echo yes || echo no)" yes
say "…with its path"                        "$(field "$MARKER" '.spec_hashes.menu.path')" "tests/features/whatsapp/niete/menu.feature"

echo "phase-1 gate — a stale spec keeps holding the turn"
out=$(stop); has "1st stop blocks"                         "$out" '"block"'  yes
has "…and says phase 1 is a gate, not a nudge"          "$out" "held"      yes
out=$(stop); has "2nd stop, spec unchanged → blocks AGAIN" "$out" '"block"'  yes
has "…names the unchanged spec"                          "$out" "menu.feature" yes
has "…and offers the declaration exit"                   "$out" "--declare" yes
has "…but does NOT re-order the E2E (phase 2 nudged once)" "$out" "/niete-e2e menu" no
say "marker counts the re-block"                         "$(field "$MARKER" '.phase1_blocks')" "1"

echo "phase-1 gate — clear refuses while stale"
rc=$(bash "$HOOK" --clear --session "$S" </dev/null >/dev/null 2>&1; echo $?)
say "--clear exits 1"                                    "$rc" "1"
[ -f "$MARKER" ] && ok "marker survives" || bad "marker was removed"
rc=$(bash "$HOOK" --clear --session "$S" --force </dev/null >/dev/null 2>&1; echo $?)
say "--clear --force is the escape hatch"                "$rc" "0"
[ -f "$MARKER" ] && bad "--force left the marker" || ok "--force removed it"

echo "phase-1 gate — a changed, VALID spec releases the turn"
arm "feat(menu): second"; stop >/dev/null
good_edit
out=$(stop); say "stop after a good edit → silent"       "$out" ""
rc=$(bash "$HOOK" --clear --session "$S" </dev/null >/dev/null 2>&1; echo $?)
say "…and --clear now works"                             "$rc" "0"
restore_spec

echo "phase-1 gate — a changed but INVALID spec still blocks, with the validator's words"
arm "feat(menu): third"; stop >/dev/null
bad_edit
out=$(stop); has "invalid edit → blocks"                 "$out" '"block"'  yes
has "…quoting the validator"                             "$out" "validate_specs" yes
restore_spec; bash "$HOOK" --clear --session "$S" --force </dev/null >/dev/null 2>&1

echo "phase-1 gate — an explicit declaration releases the turn"
arm "feat(menu): fourth"; stop >/dev/null
rc=$(bash "$HOOK" --declare --session "$S" "menu=none-needed (log line only)" </dev/null >/dev/null 2>&1; echo $?)
say "--declare exits 0"                                  "$rc" "0"
say "…recorded on the marker"                            "$(field "$MARKER" '.spec_declared.menu')" "log line only"
out=$(stop); say "stop after declaration → silent"       "$out" ""
bash "$HOOK" --clear --session "$S" </dev/null >/dev/null 2>&1

echo "phase-1 gate — a Spec-Sync trailer on HEAD counts as the declaration"
arm "feat(menu): fifth"; stop >/dev/null
git -C "$R" -c core.hooksPath=/dev/null commit -q --amend -m "feat(menu): fifth

Spec-Sync: menu=none-needed (refactor, no teacher-visible change)"
out=$(stop); say "stop with trailer → silent"            "$out" ""
bash "$HOOK" --clear --session "$S" --force </dev/null >/dev/null 2>&1

echo "phase-1 gate — bounded: three re-blocks, then it lets go loudly"
arm "feat(menu): sixth"; stop >/dev/null
b=0; for i in 1 2 3; do out=$(stop); case "$out" in *'"block"'*) b=$((b+1));; esac; done
say "three stale stops → three re-blocks"                "$b" "3"
err=$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$S" "$R" | CLAUDE_PROJECT_DIR="$R" bash "$STOP" 2>&1 >/dev/null)
out=$(stop); say "fourth stale stop → lets go"           "$out" ""
has "…but says so on stderr"                             "$err" "stale" yes
bash "$HOOK" --clear --session "$S" --force </dev/null >/dev/null 2>&1

echo "phase-1 gate — the git post-commit marker carries the same hashes"
(cd "$R" && bash scripts/qa/install-hooks.sh --quiet >/dev/null 2>&1)
printf '// terminal\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null
git -C "$R" commit -qm "feat(menu): terminal commit" 2>/dev/null
sha=$(git -C "$R" rev-parse --short=12 HEAD)
say "git marker has a menu hash" "$([ -n "$(field "$PEND/git-$sha.json" '.spec_hashes.menu.hash // ""')" ] && echo yes || echo no)" yes

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
