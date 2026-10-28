#!/bin/bash
# verify-clean-clone.sh — prove the QA pipeline works from a FRESH CLONE of this repo: no Claude session, no
# pre-set git config. The harness is the SHARED engine, borrowed from rumi-agent-home (bd-9157r.1), so "any
# developer, any machine" has two halves, and both are tested rather than asserted: a machine WITHOUT the engine gets
# a repo that works and an E2E pipeline that stays quietly off; a machine WITH it gets the whole pipeline.
#
#   bash scripts/qa/verify-clean-clone.sh                 # clone THIS checkout's HEAD
#   bash scripts/qa/verify-clean-clone.sh <url-or-path> [branch]
#   E2E_ENGINE=<rumi-agent-home>/.claude/qa/engine bash scripts/qa/verify-clean-clone.sh   # the engine to borrow
#                                                         # (default: the one linked into this checkout)
#
# It clones into a temp dir, scrubs the environment (HOME, CLAUDE_PROJECT_DIR), then walks:
#   0. without the shared engine                → the link script, hooks and session shims exit 0, silent
#   1. link the engine as `npm install` does    → core.hooksPath = .githooks, no link shows in git status
#   1. a terminal commit to a mapped bot file  → post-commit arms a git-<sha> marker + brief
#   2. a docs-only commit                      → silent
#   3. the Claude Code hooks, driven by payload → SessionStart announces the git marker;
#      a session commit arms its own marker; Stop blocks once per marker; --clear works
#   4. impact over the range               → menu is STALE; a Spec-Sync trailer makes it
#                                                none-needed; a runs.jsonl row records proof
#   5. pre-push to develop                     → advisory report; strict mode blocks
#   7. NIETE's bridge test + the engine's own suite against the clone (failures held to its known list)
# Nothing here touches WhatsApp or any database.
set -u
SRC="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
BRANCH="${2:-}"
# The engine to borrow, resolved BEFORE HOME is scrubbed: E2E_ENGINE, else the one linked into this checkout.
ENGINE_SRC="${E2E_ENGINE:-$(cd "$(dirname "$0")/../../.claude/qa/engine" 2>/dev/null && pwd -P)}"
[ -n "$ENGINE_SRC" ] && [ -f "$ENGINE_SRC/ENGINE_VERSION" ] || ENGINE_SRC=""
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
git -C "$C" update-ref refs/remotes/origin/develop HEAD  # branch-guard-allow: fixture builds a throwaway clone
say "no hooksPath before install" "$(git -C "$C" config --get core.hooksPath)" ""
for f in .claude/qa/config/feature-map.yaml .claude/qa/config/tenants.yaml .claude/hooks/e2e-autorun.sh \
         .claude/hooks/e2e-autorun-stop.sh .claude/hooks/e2e-pending-banner.sh .claude/commands/niete-e2e.md \
         tests/features/whatsapp/niete/menu.feature .githooks/post-commit .githooks/pre-push scripts/qa/link-engine.sh; do
  [ -f "$C/$f" ] || bad "missing in clone: $f"
done
ok "the clone carries NIETE's own QA layer (manifest, map, specs, shims, the link script)"
has "settings.json wires the E2E hooks" "$(cat "$C/.claude/settings.json")" "e2e-autorun-stop.sh" yes
n=$(git -C "$C" grep -l -E "Rumi 10 April|/Users/[a-z]+/" -- .claude/qa .claude/hooks .claude/commands scripts/qa .githooks 2>/dev/null \
    | grep -v -E "\.test\.|test_|verify-clean-clone|\.claude/qa/ledgers/" | wc -l | tr -d ' ')
say "no machine paths in the tracked tooling (tests excepted)" "$n" "0"

echo "0 · without the shared engine — a machine that has no rumi-agent-home"
out=$(cd "$C" && env -u E2E_ENGINE bash scripts/qa/link-engine.sh --quiet 2>&1); say "the link script (npm's prepare) exit" "$?" "0"
[ -e "$C/.claude/qa/engine" ] && bad "…but an engine link appeared" || ok "…and links nothing"
git -C "$C" config core.hooksPath .githooks          # a developer who set it on another machine
printf '\n// probe without the engine\n' >> "$C/bot/shared/services/menu.service.js"; git -C "$C" add -A >/dev/null
err=$(git -C "$C" commit -qm "probe: no engine" 2>&1); say "a commit with no engine succeeds" "$?" "0"
say "…and the hooks say nothing" "$err" ""
[ -d "$C/.claude/.e2e-pending" ] && bad "…but armed something" || ok "…and arm nothing"
for h in e2e-pending-banner.sh e2e-autorun.sh e2e-autorun-stop.sh; do
  out=$(printf '{"session_id":"x"}' | CLAUDE_PROJECT_DIR="$C" bash "$C/.claude/hooks/$h" 2>&1); rc=$?
  [ "$rc" = 0 ] && [ -z "$out" ] || bad "$h with no engine: exit $rc, '$(printf '%s' "$out" | head -1 | cut -c1-100)'"
done; ok "the session-hook shims exit 0, silent"
git -C "$C" reset -q --hard HEAD~1; git -C "$C" config --unset core.hooksPath

echo "1 · link the shared engine (what npm install's prepare runs)"
if [ -z "$ENGINE_SRC" ]; then
  bad "no shared engine to borrow: set E2E_ENGINE=<rumi-agent-home>/.claude/qa/engine, or run from a checkout that links one"
  echo "  $FAILED of $N checks failing"; exit 2
fi
out=$(cd "$C" && E2E_ENGINE="$ENGINE_SRC" bash scripts/qa/link-engine.sh --quiet 2>&1); say "link exit" "$?" "0"
[ -f "$C/.claude/qa/engine/ENGINE_VERSION" ] && ok "engine $(cat "$C/.claude/qa/engine/ENGINE_VERSION") linked at .claude/qa/engine" \
  || bad "no engine at .claude/qa/engine"
say "core.hooksPath" "$(git -C "$C" config --get core.hooksPath)" ".githooks"
say "git status sees none of the links" "$(git -C "$C" status --porcelain | head -3)" ""
for f in .claude/qa/engine/bin/select_e2e.py .claude/qa/engine/bin/spec_sync.py .claude/qa/engine/bin/validate_specs.py \
         .claude/qa/engine/bin/impact.py .claude/commands/sync-specs.md .claude/skills/gherkin-spec-sync/SKILL.md \
         .claude/skills/gherkin-test-cases/SKILL.md; do
  [ -f "$C/$f" ] || bad "not reachable after the link: $f"
done
ok "the engine's tooling, skills and commands are reachable at their paths"
say "selector works without PyYAML (scrubbed HOME)" "$(cd "$C" && HOME=$HOME python3 -c "import sys; sys.path.insert(0, \".claude/qa/engine/bin\"); import select_e2e as se; m=se.load_map(\".claude/qa/config/feature-map.yaml\", \".claude/qa/agents\"); print(len(se.select([\"bot/shared/services/menu.service.js\"], m, se.load_feature_order(\".claude/qa/agents\")).features))" 2>/dev/null)" "1"

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
case "$brief_feat" in "menu update "[1-9]*) ok "brief says: update the menu spec ($brief_feat)";; *) bad "brief says '$brief_feat', not 'menu update <n>'";; esac

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

echo "5 · impact over the range (what pre-push computes)"
BASE=$(git -C "$C" rev-list --max-parents=0 HEAD | tail -1); BASE=$(git -C "$C" rev-parse "HEAD~3")
out=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "menu is pulled in by its own file" "$(printf '%s' "$out" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["per_feature"]["menu"]["only_shared"])')" "False"
say "…and its spec is STALE (menu.feature untouched)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["menu"]["spec_status"])')" "stale"
rc=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format md --freshness block --proof off >/dev/null 2>&1; echo $?)
say "block mode would fail the PR check" "$rc" "1"
printf '\n# clean-clone verify: synced\n' >> "$C/tests/features/whatsapp/niete/menu.feature"
git -C "$C" add -A >/dev/null; QA_HOOKS_QUIET=1 git -C "$C" commit -qm "test(menu): sync spec" 2>/dev/null
out=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "a .feature change in the range makes it synced" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["menu"]["spec_status"])')" "synced"
say "training still stale (no spec, no declaration)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["training"]["spec_status"])')" "stale"
git -C "$C" commit -q --allow-empty -m "chore: declare\n\nSpec-Sync: training=none-needed (probe file only, no teacher-visible change)" 2>/dev/null
git -C "$C" commit -q --amend --allow-empty -F - <<MSG 2>/dev/null
chore: declare

Spec-Sync: training=none-needed (probe file only, no teacher-visible change)
MSG
out=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "a Spec-Sync trailer declares training none-needed" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["per_feature"]["training"]["spec_status"])')" "none-needed"
say "spec freshness verdict" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["spec_freshness"])')" "synced"
say "E2E proof still missing (no run recorded)" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["e2e_proof"])')" "missing"
printf '{"run_id":"verify","ts":"2026-09-07T00:00:00Z","surface":"whatsapp","tenant":"niete","env":"staging","method":"chrome","feature":"menu","summary":{"total":12,"passed":12,"failed":0,"blocked":0},"status":"HEALTHY"}\n{"run_id":"verify","ts":"2026-09-07T00:00:00Z","surface":"whatsapp","tenant":"niete","env":"staging","method":"chrome","feature":"training","summary":{"total":23,"passed":23,"failed":0,"blocked":0},"status":"HEALTHY"}\n' >> "$C/.claude/qa/ledgers/runs.jsonl"
git -C "$C" add -A >/dev/null; QA_HOOKS_QUIET=1 git -C "$C" commit -qm "qa: record run" 2>/dev/null
out=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format json 2>/dev/null)
say "ledger rows in the range = E2E proof recorded" "$(printf '%s' "$out" | python3 -c 'import json,sys;print(json.load(sys.stdin)["verdict"]["e2e_proof"])')" "recorded"
rc=$(cd "$C" && python3 .claude/qa/engine/bin/impact.py --repo . --base "$BASE" --head HEAD --format md --freshness block --proof block >/dev/null 2>&1; echo $?)
say "block mode now passes" "$rc" "0"

echo "6 · pre-push to develop"
HEAD=$(git -C "$C" rev-parse HEAD)
out=$(cd "$C" && printf 'refs/heads/develop %s refs/heads/develop %s\n' "$HEAD" "$BASE" | bash .githooks/pre-push origin x 2>&1); rc=$?  # branch-guard-allow: synthetic ref fed to the pre-push hook
say "advisory exit 0" "$rc" "0"; has "reports the features" "$out" "menu" yes

echo "7 · the suites, inside the clone"
(cd "$C" && bash scripts/qa/engine-bridge.test.sh >"$TMP/bridge.log" 2>&1); say "scripts/qa/engine-bridge.test.sh" "$?" "0"
(cd "$C" && E2E_NIETE_CHECKOUT="$C" E2E_NIETE_SHA=HEAD bash .claude/qa/engine/tests/run-all.sh >"$TMP/run-all.log" 2>&1)
say "the engine's own suite against this clone (every failure on its known list)" "$?" "0"
for t in "python3 .claude/qa/engine/bin/check-all-mode-counts.py" "python3 .claude/qa/engine/bin/validate_specs.py"; do
  (cd "$C" && $t >/dev/null 2>&1); say "$t" "$?" "0"
done

echo "  ---"
if [ "$FAILED" -eq 0 ]; then echo "  CLEAN-CLONE VERIFICATION PASSED ($N checks)"; else echo "  $FAILED of $N checks failing"; exit 1; fi
