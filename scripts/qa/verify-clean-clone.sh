#!/bin/bash
# verify-clean-clone.sh — prove the QA pipeline works from a FRESH CLONE of this
# repo on a machine that has nothing else: no parent workspace, no Claude session,
# no pre-set git config. This is the "any developer, any machine" claim, tested
# rather than asserted.
#
#   bash scripts/qa/verify-clean-clone.sh                 # clone THIS checkout's HEAD
#   bash scripts/qa/verify-clean-clone.sh <url-or-path> [branch]
#
# It clones into a temp dir, scrubs the environment (HOME, CLAUDE_PROJECT_DIR),
# installs the git hooks the way `npm install` does, then walks the pipeline:
#   1. a terminal commit to a mapped bot file  → post-commit arms a git-<sha> marker + brief
#   2. a docs-only commit                      → silent
#   3. the Claude Code hooks, driven by payload → SessionStart announces the git marker;
#      a session commit arms its own marker; Stop blocks once per marker; --clear works
#   4. ci_impact over the range               → menu is STALE; a Spec-Sync trailer makes it
#                                                none-needed; a runs.jsonl row records proof
#   5. pre-push to develop                     → advisory report; strict mode blocks
#   6. every QA test suite, inside the clone   → green
# Nothing here touches WhatsApp or any database.
set -u
SRC="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
BRANCH="${2:-}"
FAILED=0; N=0
ok()  { N=$((N+1)); printf '  ok    %s\n' "$1"; }
bad() { N=$((N+1)); printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/niete clean clone.XXXXXX")   # a path with spaces, on purpose
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"                      # no user git config, no ~/.claude
unset CLAUDE_PROJECT_DIR E2E_AUTORUN_OFF E2E_SPEC_SYNC_OFF QA_HOOKS_OFF QA_HOOKS_STRICT QA_HOOKS_QUIET CI
C="$TMP/NIETE-Rumi"

echo "clean clone — $SRC ${BRANCH:+($BRANCH)}"
if [ -n "$BRANCH" ]; then git clone -q --branch "$BRANCH" "$SRC" "$C" 2>&1 | tail -2
else git clone -q "$SRC" "$C" 2>&1 | tail -2; fi
[ -d "$C/.git" ] && ok "cloned" || { bad "clone failed"; exit 1; }
git -C "$C" config user.email dev@example.org; git -C "$C" config user.name "Another Developer"
git -C "$C" checkout -q -b develop 2>/dev/null || git -C "$C" checkout -q develop
git -C "$C" remote set-url origin https://github.com/Orenda-Project/NIETE-Rumi.git
git -C "$C" branch -f origin-develop-marker >/dev/null 2>&1
git -C "$C" update-ref refs/remotes/origin/develop HEAD
say "selector works without PyYAML (scrubbed HOME)" "$(cd "$C" && HOME=$HOME python3 -c "import sys; sys.path.insert(0, \".claude/qa/shared\"); import select_e2e as se; m=se.load_map(\".claude/qa/config/feature-map.yaml\", \".claude/qa/agents\"); print(len(se.select([\"bot/shared/services/menu.service.js\"], m, se.load_feature_order(\".claude/qa/agents\")).features))" 2>/dev/null)" "1"
say "no hooksPath before install" "$(git -C "$C" config --get core.hooksPath)" ""
for f in .claude/qa/config/feature-map.yaml .claude/qa/shared/select_e2e.py .claude/qa/shared/spec_sync.py \
         .claude/qa/shared/validate_specs.py .claude/hooks/e2e-autorun.sh .claude/hooks/e2e-autorun-stop.sh \
         .claude/hooks/e2e-pending-banner.sh .claude/commands/niete-e2e.md .claude/commands/sync-specs.md \
         .claude/skills/gherkin-spec-sync/SKILL.md .claude/skills/gherkin-test-cases/SKILL.md \
         tests/features/whatsapp/niete/menu.feature .githooks/post-commit .githooks/pre-push \
         scripts/qa/install-hooks.sh scripts/qa/ci_impact.py .github/workflows/qa-impact.yml; do
  [ -f "$C/$f" ] || bad "missing in clone: $f"
done
ok "every QA artefact is in the clone (map, tooling, hooks, commands, skills, specs, CI)"
has "settings.json wires the E2E hooks" "$(cat "$C/.claude/settings.json")" "e2e-autorun-stop.sh" yes
n=$(grep -rl -E "rumi-agent-home|Rumi 10 April|/Users/[a-z]+/" "$C/.claude/qa" "$C/.claude/hooks/e2e-autorun.sh" "$C/.claude/hooks/e2e-autorun-stop.sh" "$C/.claude/hooks/lib/git-push-match.sh" "$C/.claude/commands" "$C/scripts/qa" "$C/.githooks" 2>/dev/null | grep -v -E "\.test\.|test_|verify-clean-clone" | wc -l | tr -d ' ')
say "no workspace paths in the shipped tooling (tests excepted)" "$n" "0"

echo "1 · install (what npm install's prepare runs)"
out=$(cd "$C" && bash scripts/qa/install-hooks.sh --quiet 2>&1); say "installer exit" "$?" "0"
say "core.hooksPath" "$(git -C "$C" config --get core.hooksPath)" ".githooks"

echo "2 · a terminal commit to a mapped bot file"
PEND="$C/.claude/.e2e-pending"
printf '\n// verify-clean-clone probe\n' >> "$C/bot/shared/services/menu.service.js"
git -C "$C" add -A >/dev/null
err=$(git -C "$C" commit -qm "feat(menu): probe from a clean clone" 2>&1); say "commit ok" "$?" "0"
SHA=$(git -C "$C" rev-parse --short=12 HEAD)
[ -f "$PEND/git-$SHA.json" ] && ok "post-commit armed git-$SHA.json" || bad "no marker"
[ -f "$PEND/git-$SHA.sync.json" ] && ok "…with the Gherkin sync brief" || bad "no brief"
has "terminal told the developer which feature" "$err" "menu" yes
has "…and the phase-1 command" "$err" "/sync-specs --brief" yes
has "…and the phase-2 command" "$err" "/niete-e2e menu" yes
brief_feat=$(python3 -c "import json;b=json.load(open('$PEND/git-$SHA.sync.json'));print(b['features'][0]['feature'], b['features'][0]['action'], b['features'][0]['scenario_count'])" 2>/dev/null)
say "brief says: update the menu spec (12 scenarios today)" "$brief_feat" "menu update 12"

echo "3 · a docs-only commit"
printf '\nprobe\n' >> "$C/README.md"; git -C "$C" add -A >/dev/null
before=$(ls "$PEND" | wc -l | tr -d ' ')
err=$(git -C "$C" commit -qm "docs: probe" 2>&1)
say "silent, no marker" "$(ls "$PEND" | wc -l | tr -d ' '):$err" "$before:"

echo "4 · the Claude Code hooks, as a session in this clone would run them"
S="verify-$$"
pay() { printf '{"session_id":"%s","cwd":"%s","hook_event_name":"%s","tool_name":"Bash","tool_input":{"command":%s}}' "$S" "$C" "$1" "$(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"; }
out=$(pay SessionStart "" | CLAUDE_PROJECT_DIR="$C" bash "$C/.claude/hooks/e2e-pending-banner.sh" 2>/dev/null)
has "SessionStart announces the terminal commit" "$out" "git-$SHA" yes
has "…with its brief" "$out" "git-$SHA.sync.json" yes
printf '\n// session probe\n' >> "$C/bot/shared/services/training/x.js" 2>/dev/null || { mkdir -p "$C/bot/shared/services/training"; printf '// session probe\n' > "$C/bot/shared/services/training/x.js"; }
git -C "$C" add -A >/dev/null; QA_HOOKS_QUIET=1 git -C "$C" commit -qm "feat(training): session probe" 2>/dev/null
out=$(pay PostToolUse "cd \"$C\" && git commit -qm \"feat(training): session probe\"" | CLAUDE_PROJECT_DIR="$C" bash "$C/.claude/hooks/e2e-autorun.sh" 2>/dev/null)
has "a session commit arms this session's run" "$out" "/niete-e2e training" yes
[ -f "$PEND/$S.json" ] && ok "session marker written" || bad "session marker missing"
out=$(pay Stop "" | CLAUDE_PROJECT_DIR="$C" bash "$C/.claude/hooks/e2e-autorun-stop.sh" 2>/dev/null)
has "Stop blocks once for the session's own run" "$out" '"decision": "block"' yes
has "…naming training" "$out" "/niete-e2e training" yes
out=$(pay Stop "" | CLAUDE_PROJECT_DIR="$C" bash "$C/.claude/hooks/e2e-autorun-stop.sh" 2>/dev/null)
has "next Stop adopts the newest terminal-commit marker" "$out" "git-" yes
has "…flagged as made outside any session" "$out" "outside any Claude session" yes
bash "$C/.claude/hooks/e2e-autorun.sh" --clear --session "$S" 2>/dev/null
[ -f "$PEND/$S.json" ] && bad "--clear removes the session marker" || ok "--clear removes the session marker"

echo "5 · CI impact over the range (what the PR check computes)"
BASE=$(git -C "$C" rev-list --max-parents=0 HEAD | tail -1); BASE=$(git -C "$C" rev-parse "HEAD~3")
out=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "menu is pulled in by its own file" "$(printf '%s' "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["per_feature"]["menu"]["only_shared"])')" "False"
say "…and its spec is STALE (menu.feature untouched)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["menu"]["spec_status"])')" "stale"
rc=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format md --freshness block --proof off >/dev/null 2>&1; echo $?)
say "block mode would fail the PR check" "$rc" "1"
printf '\n# clean-clone verify: synced\n' >> "$C/tests/features/whatsapp/niete/menu.feature"
git -C "$C" add -A >/dev/null; QA_HOOKS_QUIET=1 git -C "$C" commit -qm "test(menu): sync spec" 2>/dev/null
out=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "a .feature change in the range makes it synced" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["menu"]["spec_status"])')" "synced"
say "training still stale (no spec, no declaration)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["training"]["spec_status"])')" "stale"
git -C "$C" commit -q --allow-empty -m "chore: declare\n\nSpec-Sync: training=none-needed (probe file only, no teacher-visible change)" 2>/dev/null
git -C "$C" commit -q --amend --allow-empty -F - <<MSG 2>/dev/null
chore: declare

Spec-Sync: training=none-needed (probe file only, no teacher-visible change)
MSG
out=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "a Spec-Sync trailer declares training none-needed" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["training"]["spec_status"])')" "none-needed"
say "spec freshness verdict" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["spec_freshness"])')" "synced"
say "E2E proof still missing (no run recorded)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["e2e_proof"])')" "missing"
printf '{"run_id":"verify","ts":"2026-09-07T00:00:00Z","surface":"whatsapp","tenant":"niete","env":"staging","method":"chrome","feature":"menu","summary":{"total":12,"passed":12,"failed":0,"blocked":0},"status":"HEALTHY"}\n{"run_id":"verify","ts":"2026-09-07T00:00:00Z","surface":"whatsapp","tenant":"niete","env":"staging","method":"chrome","feature":"training","summary":{"total":23,"passed":23,"failed":0,"blocked":0},"status":"HEALTHY"}\n' >> "$C/.claude/qa/ledgers/runs.jsonl"
git -C "$C" add -A >/dev/null; QA_HOOKS_QUIET=1 git -C "$C" commit -qm "qa: record run" 2>/dev/null
out=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "ledger rows in the range = E2E proof recorded" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["e2e_proof"])')" "recorded"
rc=$(cd "$C" && python3 scripts/qa/ci_impact.py --repo . --base "$BASE" --head HEAD --format md --freshness block --proof block >/dev/null 2>&1; echo $?)
say "block mode now passes" "$rc" "0"

echo "6 · pre-push to develop"
HEAD=$(git -C "$C" rev-parse HEAD)
out=$(cd "$C" && printf 'refs/heads/develop %s refs/heads/develop %s\n' "$HEAD" "$BASE" | bash .githooks/pre-push origin x 2>&1); rc=$?
say "advisory exit 0" "$rc" "0"; has "reports the features" "$out" "menu" yes

echo "7 · the QA test suites, inside the clone"
for t in "python3 .claude/qa/shared/test_select_e2e.py" "python3 .claude/qa/shared/test_spec_sync.py" \
         "python3 .claude/qa/shared/test_validate_specs.py" "python3 .claude/qa/shared/test_yaml_lite.py" "python3 scripts/qa/test_ci_impact.py" \
         "python3 .claude/qa/shared/check-all-mode-counts.py" "python3 .claude/qa/shared/validate_specs.py" \
         "bash .claude/hooks/lib/git-push-match.test.sh" "bash .githooks/githooks.test.sh" \
         "bash .claude/hooks/e2e-autorun-gitmarker.test.sh" "bash .claude/hooks/spec-sync-pipeline.test.sh" \
         "bash .claude/hooks/e2e-autorun.test.sh"; do
  (cd "$C" && $t >/dev/null 2>&1); say "$t" "$?" "0"
done

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  CLEAN-CLONE VERIFICATION PASSED ($N checks)"; else echo "  $FAILED of $N checks failing"; exit 1; fi
