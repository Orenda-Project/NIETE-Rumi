#!/usr/bin/env bash
# spec-sync-pipeline.test.sh — drive the WHOLE commit → Gherkin → gate → E2E chain
# against real hooks, real scripts and real .feature files (bd-59809).
#
#   bash .claude/hooks/spec-sync-pipeline.test.sh
#
# WHY THIS EXISTS ALONGSIDE THE UNIT TESTS. `e2e-autorun.test.sh` proves each hook
# behaves; `test_spec_sync.py` / `test_validate_specs.py` prove each module does.
# Neither proves the JOIN — that a real `git commit` in a NIETE-shaped repo walks
# all the way to a validated spec and a released phase 2. Every defect this file
# has caught lived in a seam, not in a unit.
#
# WHAT IT CANNOT COVER, and no harness will: phase 2 itself. Driving WhatsApp
# needs a linked web.whatsapp.com session and the Chrome DevTools MCP tools, which
# belong to an agent, not a subprocess — the same reason `select_e2e` cannot run
# the suite it selects. This file stops at the gate and asserts the gate's verdict.
# It also stands in for the agent's authoring step with a scripted edit: that step
# is judgement, and judgement is not what a regression test pins down.
#
# ISOLATION. Everything happens under a temp project root holding COPIES of the
# real specs, agents and config. The live tests/features/ tree is never written to.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
REAL_ROOT="$PWD"

FAILED=0
STAGE=""

stage() { STAGE="$1"; printf '\n  \033[1m%s\033[0m\n' "$1"; }
ok()    { printf '    ok    %s\n' "$1"; }
bad()   { printf '    FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say()   { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has()   { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/specsync-pipeline.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# ── an isolated project root with REAL specs, agents and map ─────────────────
PROJ="$TMP/proj"
mkdir -p "$PROJ/.claude" "$PROJ/tests/features/whatsapp"
cp -R "$REAL_ROOT/.claude/qa"    "$PROJ/.claude/qa"
cp -R "$REAL_ROOT/.claude/hooks" "$PROJ/.claude/hooks"
cp -R "$REAL_ROOT/tests/features/whatsapp/niete" "$PROJ/tests/features/whatsapp/niete"
SPECS="$PROJ/tests/features/whatsapp/niete"

# ── a NIETE-shaped fixture repo (the map keys off bot/** paths) ──────────────
REPO="$TMP/NIETE-Rumi"
mkdir -p "$REPO/bot/shared/services"
git -C "$REPO" init -q .
git -C "$REPO" config user.email p@local
git -C "$REPO" config user.name pipeline
cat > "$REPO/bot/shared/services/menu.service.js" <<'JS'
const ROWS = ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything'];
const OPENER = 'View Features';
module.exports = { ROWS, OPENER };
JS
printf 'module.exports = { send: () => {} };\n' > "$REPO/bot/shared/services/whatsapp.service.js"
printf '# notes\n' > "$REPO/README.md"
git -C "$REPO" add -A >/dev/null; git -C "$REPO" commit -qm baseline

SESSION="pipeline-$$"
MARKER="$PROJ/.claude/.e2e-pending/$SESSION.json"
BRIEF="$PROJ/.claude/.e2e-pending/$SESSION.sync.json"

commit_and_arm() {   # $1 = commit subject
  git -C "$REPO" add -A >/dev/null
  git -C "$REPO" commit -qm "$1"
  rm -f "$MARKER" "$BRIEF"
  python3 -c "
import json
print(json.dumps({'session_id':'$SESSION','cwd':'$REPO','tool_name':'Bash',
 'tool_input':{'command':'cd $REPO && git commit -m \"$1\"'},
 'tool_response':{'stdout':'','stderr':'','interrupted':False}}))" \
  | CLAUDE_PROJECT_DIR="$PROJ" bash "$PROJ/.claude/hooks/e2e-autorun.sh" 2>/dev/null
}

stop_hook() {
  python3 -c "
import json
print(json.dumps({'session_id':'$SESSION','cwd':'$REPO','hook_event_name':'Stop'}))" \
  | CLAUDE_PROJECT_DIR="$PROJ" bash "$PROJ/.claude/hooks/e2e-autorun-stop.sh" 2>/dev/null
}

jqf() { python3 -c "
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print('MISSING'); raise SystemExit
cur=d
for k in sys.argv[2].split('.'):
    cur = cur[int(k)] if k.isdigit() else cur.get(k)
    if cur is None: print('None'); raise SystemExit
print(cur)" "$1" "$2" 2>/dev/null || echo MISSING; }

validate() { python3 "$PROJ/.claude/qa/shared/validate_specs.py" \
               --spec-dir "$SPECS" --agents-dir "$PROJ/.claude/qa/agents" "$@" 2>&1; }

echo "spec-sync pipeline — commit → brief → author → gate → release"

# ═════════════════════════════════════════════════════════════════════════════
stage "A · a behaviour change reaches the agent as a brief"

sed -i.bak "s/'Ask Anything'\]/'Ask Anything', 'Reading Assessment']/; s/OPENER = 'View Features'/OPENER = 'Explore Features'/" \
  "$REPO/bot/shared/services/menu.service.js" && rm -f "$REPO/bot/shared/services/menu.service.js.bak"
OUT=$(commit_and_arm "menu: add a fifth row, rename the opener")

say "1. the commit arms a run"            "$([ -f "$MARKER" ] && echo yes || echo no)" yes
say "2. a brief is built"                 "$([ -f "$BRIEF" ] && echo yes || echo no)"  yes
say "3. it selects exactly menu"          "$(jqf "$BRIEF" features.0.feature)"         menu
say "4. as an update, not a create"       "$(jqf "$BRIEF" features.0.action)"          update
say "5. owned change, not fan-out"        "$(jqf "$BRIEF" features.0.only_shared)"     False
say "6. it knows the spec's current size" "$(jqf "$BRIEF" features.0.scenario_count)"  12
has "7. the real diff is in the brief"    "$(jqf "$BRIEF" features.0.diff)" "Reading Assessment" yes
has "8. including the renamed opener"     "$(jqf "$BRIEF" features.0.diff)" "Explore Features"   yes
has "9. phase 1 is ordered before phase 2" \
    "$(printf '%s' "$OUT" | python3 -c 'import json,sys
c=json.load(sys.stdin)["hookSpecificOutput"]["additionalContext"]
a,b=c.find("PHASE 1"),c.find("PHASE 2"); print("yes" if 0<=a<b else "no")' 2>/dev/null)" yes yes
has "10. authoring is routed to the existing skill" "$OUT" "gherkin-test-cases" yes

# ═════════════════════════════════════════════════════════════════════════════
stage "B · the gate catches a BAD generation before phase 2"

# The spec still asserts 4 rows and "View Features" — i.e. exactly the stale state
# the whole feature exists to prevent. First prove the file is currently clean, so
# the failures below are caused by the injected defects and nothing else.
say "1. baseline: the real spec passes"   "$(validate --only menu >/dev/null 2>&1; echo $?)" 0

cp "$SPECS/menu.feature" "$TMP/menu.orig"

# a duplicated scenario name — two scenarios, one reported result
cat >> "$SPECS/menu.feature" <<'GK'

  @e2e @menu @P1
  Scenario: /menu renders the card and exactly the 4 ICT feature rows
    When I send "/menu"
    Then five rows are shown
GK
say "2. duplicate scenario name is caught" "$(validate --only menu >/dev/null 2>&1; echo $?)" 1
has "3. ...and named as E-DUPNAME"         "$(validate --only menu)" "E-DUPNAME" yes
cp "$TMP/menu.orig" "$SPECS/menu.feature"

# a mistyped gating tag — reads as covered, is NEVER run
cat >> "$SPECS/menu.feature" <<'GK'

  @e2ee @menu @P1
  Scenario: silently excluded from every run forever
    When I send "/menu"
    Then five rows are shown
GK
say "4. a mistyped @e2e is caught"         "$(validate --only menu >/dev/null 2>&1; echo $?)" 1
has "5. ...and named as E-TAGTYPO"         "$(validate --only menu)" "E-TAGTYPO" yes
cp "$TMP/menu.orig" "$SPECS/menu.feature"

# a scenario that can never fail
cat >> "$SPECS/menu.feature" <<'GK'

  @e2e @menu @P1
  Scenario: asserts nothing at all
    When I send "/menu"
GK
say "6. a scenario with no Then is caught" "$(validate --only menu >/dev/null 2>&1; echo $?)" 1
cp "$TMP/menu.orig" "$SPECS/menu.feature"

# ═════════════════════════════════════════════════════════════════════════════
stage "C · a GOOD sync passes and releases phase 2"

# Stand in for the agent: update the stale scenario to match the diff.
python3 - "$SPECS/menu.feature" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace('''      | Teacher Training   |
      | Lesson Plans       |
      | Classroom Coaching |
      | Ask Anything       |''',
'''      | Teacher Training   |
      | Lesson Plans       |
      | Classroom Coaching |
      | Ask Anything       |
      | Reading Assessment |''')
s = s.replace('And the list opener button is labelled "View Features"',
              'And the list opener button is labelled "Explore Features"')
open(p, "w", encoding="utf-8").write(s)
PY
has "1. the spec now covers the new row"  "$(cat "$SPECS/menu.feature")" "Reading Assessment" yes
has "2. and the renamed opener"           "$(cat "$SPECS/menu.feature")" "Explore Features"   yes
say "3. the gate passes"                  "$(validate --only menu >/dev/null 2>&1; echo $?)" 0
say "4. no other spec was disturbed"      "$(validate >/dev/null 2>&1; echo $?)"             0

SOUT=$(stop_hook)
has "5. Stop still compels the run"       "$SOUT" '"block"'        yes
has "6. ...naming phase 1"                "$SOUT" "PHASE 1"        yes
has "7. ...and phase 2"                   "$SOUT" "/niete-e2e menu" yes
say "8. and it nudges only once"          "$(stop_hook | head -c 1 | wc -c | tr -d ' ')" 0

# ═════════════════════════════════════════════════════════════════════════════
stage "D · deletion is PROPOSED, never performed"

python3 - "$SPECS/menu.feature" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace("  @e2e @menu @edge @P3\n  Scenario: /menu is case-insensitive",
              "  @e2e @menu @edge @P3 @obsolete\n  Scenario: /menu is case-insensitive")
open(p, "w", encoding="utf-8").write(s)
PY
say "1. @obsolete with no reason is refused" "$(validate --only menu >/dev/null 2>&1; echo $?)" 1
has "2. ...as E-OBSOLETE-NOREASON"           "$(validate --only menu)" "E-OBSOLETE-NOREASON" yes

python3 - "$SPECS/menu.feature" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace('    Then the "View Features" menu is shown with the 4 ICT rows',
              '    Then the "View Features" menu is shown with the 4 ICT rows\n'
              '    # OBSOLETE 2026-08-28 (bd-59809): case-folding removed in a1b2c3d.\n'
              '    # Proposed for deletion — NOT deleted.')
open(p, "w", encoding="utf-8").write(s)
PY
say "3. with a reason it passes"            "$(validate --only menu >/dev/null 2>&1; echo $?)" 0
has "4. the scenario is still on disk"      "$(cat "$SPECS/menu.feature")" "/menu is case-insensitive" yes
cp "$TMP/menu.orig" "$SPECS/menu.feature"

# ═════════════════════════════════════════════════════════════════════════════
stage "E · a shared fan-out does not churn nine specs"

printf 'module.exports = { send: () => {}, log: () => {} };\n' > "$REPO/bot/shared/services/whatsapp.service.js"
commit_and_arm "whatsapp: add a log helper" >/dev/null
COUNT=$(python3 -c "
import json;print(len(json.load(open('$BRIEF'))['features']))" 2>/dev/null)
ALLSHARED=$(python3 -c "
import json;print(all(f['only_shared'] for f in json.load(open('$BRIEF'))['features']))" 2>/dev/null)
say "1. every feature is selected"          "$COUNT"      9
say "2. ...and every one is flagged shared" "$ALLSHARED"  True

# ═════════════════════════════════════════════════════════════════════════════
stage "F · a docs-only commit stays silent"

printf '# notes\nmore\n' > "$REPO/README.md"
OUT=$(commit_and_arm "docs: update notes")
say "1. no run is armed"                    "$([ -f "$MARKER" ] && echo yes || echo no)" no
say "2. no brief is written"                "$([ -f "$BRIEF" ]  && echo yes || echo no)" no
say "3. the hook says nothing at all"       "${OUT:-empty}"                              empty

# ═════════════════════════════════════════════════════════════════════════════
stage "G · phase 1 failing must not take phase 2 with it"

printf 'const X = 2;\n' >> "$REPO/bot/shared/services/menu.service.js"
echo 'import sys; sys.exit(1)' > "$PROJ/.claude/qa/shared/spec_sync.py"
OUT=$(commit_and_arm "menu: another change, with a broken sync")
say "1. the E2E is still armed"             "$([ -f "$MARKER" ] && echo yes || echo no)" yes
has "2. the run order survives"             "$OUT" "/niete-e2e menu"  yes
has "3. no phase 1 is claimed"              "$OUT" "PHASE 1"          no
say "4. the marker records no sync"         "$(jqf "$MARKER" spec_sync)" False

# ═════════════════════════════════════════════════════════════════════════════
stage "H · phase 2 is mechanically HELD until phase 1 releases it (bd-zdpr8)"

# Stage G clobbered spec_sync.py with a sys.exit(1) stub; restore the real module.
cp "$REAL_ROOT/.claude/qa/shared/spec_sync.py" "$PROJ/.claude/qa/shared/spec_sync.py"

# run-suite.sh resolves its repo from its own location, so PROJ must BE the repo:
# its --repo relevance check asks "is this brief's commit in my history?" and the
# fixture $REPO's commits are not. Give PROJ a history with the menu change.
git -C "$PROJ" init -q . 2>/dev/null
git -C "$PROJ" config user.email p@local; git -C "$PROJ" config user.name pipeline
mkdir -p "$PROJ/bot/shared/services"
cp "$TMP/menu.orig" "$SPECS/menu.feature"
cat > "$PROJ/bot/shared/services/menu.service.js" <<'JS'
const ROWS = ['Teacher Training', 'Lesson Plans', 'Classroom Coaching', 'Ask Anything'];
module.exports = { ROWS };
JS
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm baseline >/dev/null 2>&1
printf "const OPENER = 'View Features';\nmodule.exports.OPENER = OPENER;\n" >> "$PROJ/bot/shared/services/menu.service.js"
git -C "$PROJ" add -A >/dev/null 2>&1; git -C "$PROJ" commit -qm "menu: export the opener" >/dev/null 2>&1
HSHA=$(git -C "$PROJ" rev-parse HEAD)

rm -f "$PROJ/.claude/.e2e-pending/"*.json
HOUT=$(python3 -c "
import json
print(json.dumps({'session_id':'$SESSION','cwd':'$PROJ','tool_name':'Bash',
 'tool_input':{'command':'git commit -m x'},'tool_response':{'stdout':'','stderr':'','interrupted':False}}))" \
  | CLAUDE_PROJECT_DIR="$PROJ" bash "$PROJ/.claude/hooks/e2e-autorun.sh" 2>/dev/null)
has "1. the arming order names the release step"        "$HOUT" "spec_sync.py --release" yes
say "2. the brief carries the commit"                   "$(jqf "$BRIEF" commit_sha)" "$HSHA"
say "3. ...and starts unreleased"                        "$(jqf "$BRIEF" released)"   False

# run-suite (the ONLY runner on develop — chrome lane) refuses before the release.
# --dry-run stops at the gate, so no Chrome/driver is needed to prove it.
ROUT=$(bash "$PROJ/.claude/qa/shared/run-suite.sh" menu --driver 1 --target 1 --dry-run 2>&1); RRC=$?
say "4. run-suite REFUSES before the release"           "$RRC" 4
has "5. ...naming the release path"                     "$ROUT" "spec_sync.py --release" yes
has "6. ...and it never reached Chrome preconditions"   "$ROUT" "Chrome DevTools" no

# the agent syncs (spec already covers this change) and RELEASES
python3 .claude/qa/shared/validate_specs.py --spec-dir "$SPECS" --agents-dir "$PROJ/.claude/qa/agents" --only menu >/dev/null 2>&1
say "7. validate is green for menu"                     "$?" 0
REL=$(python3 "$PROJ/.claude/qa/shared/spec_sync.py" --release "$BRIEF" 2>&1); RELRC=$?
say "8. the release runs the validator and passes"      "$RELRC" 0
STAMP=$(ls "$PROJ/.claude/.e2e-pending/"released-*.json 2>/dev/null | head -1)
say "9. a per-commit stamp is written"                  "$([ -n "$STAMP" ] && echo yes || echo no)" yes
say "10. ...naming the commit"                           "$(jqf "$STAMP" commit_sha)" "$HSHA"
say "11. ...and the brief is marked released"            "$(jqf "$BRIEF" released)" True

ROUT=$(bash "$PROJ/.claude/qa/shared/run-suite.sh" menu --driver 1 --target 1 --dry-run 2>&1); RRC=$?
say "12. after the release run-suite passes the gate"   "$RRC" 0
has "13. ...and says the gate passed"                   "$ROUT" "release gate passed" yes

# a BROKEN sync must not release: inject a defect, drop the stamp, try again
cp "$SPECS/menu.feature" "$TMP/menu.h"
cat >> "$SPECS/menu.feature" <<'GK'

  @e2ee @menu @P1
  Scenario: mistyped tag, never run
    When I send "/menu"
    Then five rows are shown
GK
rm -f "$PROJ/.claude/.e2e-pending/"released-*.json
python3 - "$BRIEF" <<'PY2'
import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["released"]=False; json.dump(d, open(p,"w"))
PY2
REL=$(python3 "$PROJ/.claude/qa/shared/spec_sync.py" --release "$BRIEF" 2>&1); RELRC=$?
say "14. a failing validator refuses to release"        "$RELRC" 1
say "15. ...and writes no stamp"                         "$(ls "$PROJ/.claude/.e2e-pending/"released-*.json 2>/dev/null | wc -l | tr -d ' ')" 0
ROUT=$(bash "$PROJ/.claude/qa/shared/run-suite.sh" menu --driver 1 --target 1 --dry-run 2>&1); RRC=$?
say "16. so run-suite is still held"                    "$RRC" 4
cp "$TMP/menu.h" "$SPECS/menu.feature"

echo
echo "  ────────────────────────────────────────────────────────────"
if [ "$FAILED" = "0" ]; then
  echo "  PIPELINE OK — every stage from commit to gate behaves as designed."
  echo "  (Phase 2 itself needs a linked WhatsApp session; out of scope here.)"
  exit 0
fi
echo "  $FAILED assertion(s) FAILING"
exit 1
