#!/usr/bin/env bash
# Tests for scripts/qa/spec-autosync.sh — the deterministic half of the server-side
# Gherkin auto-sync (bd-2a07j). The judgement half (Claude authoring through the
# gherkin-spec-sync skill) runs only on the GitHub runner with an API key; this
# pins everything around it: the brief for a PR range, the loop guard, and the
# validate-then-commit step. Run: bash scripts/qa/test_spec_autosync.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"; FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }
TMP=$(mktemp -d "${TMPDIR:-/tmp}/autosync.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
R="$TMP/NIETE-Rumi"; mkdir -p "$R/bot/shared/services" "$R/tests/features/whatsapp" "$R/.claude" "$R/scripts"
cp -R "$ROOT/.claude/qa" "$R/.claude/qa"; cp -R "$ROOT/scripts/qa" "$R/scripts/qa"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"; rm -rf "$R/.claude/qa/results"
printf 'module.exports = { ROWS: ["Teacher Training"] };\n' > "$R/bot/shared/services/menu.service.js"
printf 'module.exports = { send: () => {} };\n' > "$R/bot/shared/services/whatsapp.service.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
BASE=$(git -C "$R" rev-parse HEAD)
git -C "$R" checkout -q -b feat
printf '// change\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null; git -C "$R" commit -qm "feat(menu): change"
HEAD=$(git -C "$R" rev-parse HEAD)
S="bash $R/scripts/qa/spec-autosync.sh"
SPEC="$R/tests/features/whatsapp/niete/menu.feature"

echo "spec-autosync — brief"
$S brief --repo "$R" --base "$BASE" --head "$HEAD" --out "$TMP/brief.json" >/dev/null 2>&1; rc=$?
say "brief exits 0 when a sync is needed"       "$rc" "0"
say "brief names menu"                          "$(jq -r '.features[0].feature' "$TMP/brief.json" 2>/dev/null)" "menu"
say "…as an update"                             "$(jq -r '.features[0].action' "$TMP/brief.json" 2>/dev/null)" "update"
FEATS=$($S features --brief "$TMP/brief.json" 2>/dev/null); say "features lists menu" "$FEATS" "menu"
$S brief --repo "$R" --base "$HEAD" --head "$HEAD" --out "$TMP/none.json" >/dev/null 2>&1; rc=$?
say "empty range → exit 3 (nothing to author)"  "$rc" "3"

echo "spec-autosync — loop guard"
$S guard --repo "$R" --head "$HEAD" >/dev/null 2>&1; say "a human commit at HEAD → go (0)" "$?" "0"
printf '# authored\n' >> "$SPEC"; git -C "$R" add -A >/dev/null
git -C "$R" commit -qm "qa(spec-sync): sync menu.feature to ${HEAD:0:12} [auto]"
BOT=$(git -C "$R" rev-parse HEAD)
$S guard --repo "$R" --head "$BOT" >/dev/null 2>&1; say "the bot's own commit at HEAD → stop (2)" "$?" "2"
git -C "$R" reset -q --hard "$HEAD"

echo "spec-autosync — commit step"
$S commit --repo "$R" --features menu --head "$HEAD" --no-push >/dev/null 2>&1; rc=$?
say "nothing changed → exit 3, no commit"        "$rc:$(git -C "$R" rev-parse HEAD)" "3:$HEAD"
python3 - "$SPEC" <<'PY'
import sys; p=sys.argv[1]; s=open(p,encoding="utf-8").read()
open(p,"w",encoding="utf-8").write(s.replace('And the list opener button is labelled "View Features"','And the list opener button is labelled "Explore Features"'))
PY
$S commit --repo "$R" --features menu --head "$HEAD" --no-push >/dev/null 2>&1; rc=$?
say "valid change → exit 0"                      "$rc" "0"
has "commit subject is the bot's"                "$(git -C "$R" log -1 --format=%s)" "qa(spec-sync):" yes
has "…names the commit it synced to"             "$(git -C "$R" log -1 --format=%B)" "${HEAD:0:12}" yes
has "…carries the Claude co-author"              "$(git -C "$R" log -1 --format=%B)" "Co-Authored-By: Claude" yes
say "only the spec was committed"                "$(git -C "$R" show --stat --format= HEAD | grep -c 'menu.feature')" "1"
git -C "$R" reset -q --hard "$HEAD"
python3 - "$SPEC" <<'PY'
import sys,re; p=sys.argv[1]; s=open(p,encoding="utf-8").read()
m=re.search(r'^(\s*Scenario: .+)$', s, re.M); name=m.group(1)
s=s.rstrip()+"\n\n  @whatsapp @ict @profile:niete @feature:menu @persona:teacher @e2e @p3\n"+name+"\n    Given a registered teacher\n    When she sends \"/menu\"\n    Then the menu card is shown\n"
open(p,"w",encoding="utf-8").write(s)
PY
out=$($S commit --repo "$R" --features menu --head "$HEAD" --no-push 2>&1); rc=$?
say "INVALID change → exit 1, nothing committed"  "$rc:$(git -C "$R" rev-parse HEAD)" "1:$HEAD"
has "…and the validator is quoted"               "$out" "duplicate" yes
git -C "$R" checkout -q -- tests

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
