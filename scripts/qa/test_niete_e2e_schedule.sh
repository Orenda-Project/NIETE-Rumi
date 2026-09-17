#!/usr/bin/env bash
# Tests for the scheduled run's SCOPE RESOLUTION (bd-dzyl6).
#
#   bash scripts/qa/test_niete_e2e_schedule.sh
#
# WHY. The LaunchAgent drove `/niete-e2e all` — 101 scenarios, ~3h15m — every two hours,
# regardless of what had changed. Most of that re-drove features nothing had touched, and a
# full pass outlasts the cadence, so roughly every other fire stepped aside on the driver
# lock. Now the fire asks the same question the commit hook asks: which features did the
# diff touch? The anchor is the `commit` stamped on the last runs.jsonl row (added in #838),
# so "since the last run that was actually recorded" is answerable without new state.
#
# This file pins the resolution only — `--resolve-scope` prints what a fire WOULD drive and
# exits. Driving WhatsApp needs a linked browser and is out of scope here, as everywhere.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"; FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/e2esched.XXXXXX"); trap 'rm -rf "$TMP"' EXIT
R="$TMP/niete-e2e"
mkdir -p "$R/bot/shared/services" "$R/tests/features/whatsapp" "$R/.claude" "$R/scripts"
cp -R "$ROOT/.claude/qa" "$R/.claude/qa"; cp -R "$ROOT/scripts/qa" "$R/scripts/qa"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results"; mkdir -p "$R/.claude/qa/ledgers" "$R/.claude/qa/results/whatsapp/niete"
printf 'module.exports={ROWS:["Teacher Training"]};\n' > "$R/bot/shared/services/menu.service.js"
printf 'module.exports={send:()=>{}};\n'               > "$R/bot/shared/services/whatsapp.service.js"
mkdir -p "$R/bot/shared/services/coaching"
printf 'module.exports={build:()=>{}};\n'              > "$R/bot/shared/services/coaching/coaching-breakdown.service.js"
printf '# readme\n' > "$R/README.md"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
BASE=$(git -C "$R" rev-parse --short=12 HEAD)
LEDGER="$R/.claude/qa/ledgers/runs.jsonl"

row() {  # $1 feature  $2 commit ("" = a pre-#838 row with no commit key)
  python3 -c "
import json,sys
r={'run_id':'t','ts':'2026-09-10T00:00:00Z','surface':'whatsapp','tenant':'niete','env':'sandbox',
   'method':'chrome','feature':sys.argv[1],'summary':{'total':1,'passed':1,'failed':0,'blocked':0},
   'duration_ms':1,'status':'HEALTHY','coverage':{'scenarios':1,'surface_observed':1,'uncovered':0},
   'drift_count':0,'discovery_count':0,'evidence_dir':'x/'}
if sys.argv[2]: r['commit']=sys.argv[2]
print(json.dumps(r))" "$1" "$2" >> "$LEDGER"
}
resolve() { (cd "$R" && NIETE_E2E_DRIVER=1 NIETE_E2E_SCOPE="${1:-auto}" bash scripts/qa/niete-e2e-scheduled.sh --resolve-scope 2>&1); }

echo "schedule scope — no ledger yet"
out=$(resolve); rc=$?
say  "a first-ever fire falls back to the full suite" "$rc" "0"
has  "…and says so"                                  "$out" "all" yes

echo "schedule scope — anchored on the last recorded run"
row menu "$BASE"
printf '// menu change\n' >> "$R/bot/shared/services/menu.service.js"
git -C "$R" add -A >/dev/null; git -C "$R" -c core.hooksPath=/dev/null commit -qm "feat(menu): change"
out=$(resolve)
has  "one touched feature → just that feature"        "$out" "menu"     yes
has  "…and NOT the full suite"                        "$out" "all"      no
has  "…naming the anchor it measured from"            "$out" "$BASE"    yes

echo "schedule scope — two features"
printf '// coaching change\n' >> "$R/bot/shared/services/coaching/coaching-breakdown.service.js"
git -C "$R" add -A >/dev/null; git -C "$R" -c core.hooksPath=/dev/null commit -qm "fix(coaching): change"
out=$(resolve)
has  "both features are named"                        "$out" "menu"     yes
has  "…including coaching"                            "$out" "coaching" yes

echo "schedule scope — nothing bot-facing since the last run"
NOW=$(git -C "$R" rev-parse --short=12 HEAD); row menu "$NOW"
printf 'docs only\n' >> "$R/README.md"
git -C "$R" add -A >/dev/null; git -C "$R" -c core.hooksPath=/dev/null commit -qm "docs: readme"
out=$(resolve); rc=$?
say  "a docs-only window declines the fire (exit 3)"  "$rc" "3"
has  "…saying nothing bot-facing changed"             "$out" "nothing" yes

echo "schedule scope — the anchor is unusable"
row menu "ffffffffffff"
printf '// another menu change\n' >> "$R/bot/shared/services/menu.service.js"
git -C "$R" add -A >/dev/null; git -C "$R" -c core.hooksPath=/dev/null commit -qm "feat(menu): again"
out=$(resolve); rc=$?
say  "an unknown anchor sha falls back, never guesses" "$rc" "0"
has  "…to the full suite"                              "$out" "all" yes

echo "schedule scope — a pre-#838 row carries no commit"
: > "$LEDGER"; row menu ""
out=$(resolve); rc=$?
say  "a row with no commit stamp falls back"           "$rc" "0"
has  "…to the full suite"                              "$out" "all" yes

echo "schedule scope — an explicit scope still wins"
: > "$LEDGER"; row menu "$BASE"
out=$(resolve all)
has  "NIETE_E2E_SCOPE=all bypasses selection"          "$out" "all"  yes
out=$(resolve coaching)
has  "an explicit feature list is honoured"            "$out" "coaching" yes
has  "…without consulting the ledger"                  "$out" "$BASE"    no

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  all cases pass"; else echo "  $FAILED case(s) failing"; exit 1; fi
