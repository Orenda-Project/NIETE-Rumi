#!/usr/bin/env bash
# e2e-tenancy.test.sh — the bash engine (hooks, lib, git hooks) reads tenants.yaml, never a tenant name (bd-9157r).
#
#   D=$(mktemp -d); bash .claude/qa/engine/tests/mkfixture.sh rumi "$D" >/dev/null
#   E2E_FIXTURE="$D" E2E_FIXTURE_SHAPE=rumi bash .claude/qa/engine/hooks/e2e-tenancy.test.sh
#
# Runs under bash (lib/tenants.sh needs BASH_SOURCE). The trigger words are assembled at runtime
# (`G="git"; P="push"`) because hooks that match on that phrase read this file too.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
D="${E2E_FIXTURE:?set E2E_FIXTURE}"; S="${E2E_FIXTURE_SHAPE:?set E2E_FIXTURE_SHAPE}"
export CLAUDE_PROJECT_DIR="$D"
export E2E_CHROME_ON=1          # every assertion below is about selection, not about the chrome pause
. ./lib/tenants.sh; . ./lib/git-push-match.sh; . ./lib/mock-lane.sh
G="git"; P="push"
CMD=$(e2e_cmd)

# ── deploy-branch detection comes from branches.deploy_triggers ─────────────────────────────────
if [ "$S" = niete ]; then
  push_targets_deploy_branch "$G $P origin sandbox" && ok "niete: a push to sandbox deploys" || bad "niete: sandbox should deploy"
  push_targets_deploy_branch "$G $P origin bd-1234-feature" && bad "niete: a feature branch must not deploy" || ok "niete: a feature branch does not deploy"
else
  push_targets_deploy_branch "$G $P origin staging" && ok "rumi: a push to staging deploys" || bad "rumi: staging should deploy"
  push_targets_deploy_branch "$G $P origin sandbox" && bad "rumi: sandbox must not deploy" || ok "rumi: sandbox does not deploy"
fi
push_targets_deploy_branch "$G $P origin main" && ok "$S: main deploys" || bad "$S: main should deploy"

# ── mock-lane features come from the manifest's drivers_dir, the chrome filter from its command ──
[ "$(e2e_mock_features)" = "menu" ] && ok "$S: mock features derived from drivers_dir" || bad "$S: mock features = '$(e2e_mock_features)'"
kept=$(e2e_filter_chrome_cmds "$CMD menu
$CMD status" "menu")
[ "$kept" = "$CMD status" ] && ok "$S: chrome filter drops the mock feature (single form)" || bad "$S: chrome filter kept: $kept"
kept=$(e2e_filter_chrome_cmds "$CMD tz menu
$CMD tz status" "menu")
[ "$kept" = "$CMD tz status" ] && ok "$S: chrome filter drops the mock feature (tenant form)" || bad "$S: chrome filter (tenant form) kept: $kept"
blk=$(e2e_mock_block deadbeef menu "")
printf '%s' "$blk" | grep -q "engine/bin/commit-e2e.sh deadbeef --features menu" && ok "$S: mock block names the engine path (single tenant)" || bad "$S: mock block: $blk"
blk=$(e2e_mock_block deadbeef menu "pk,tz")
printf '%s' "$blk" | grep -q -- "--tenant pk --features menu" && printf '%s' "$blk" | grep -q -- "--tenant tz --features menu" \
  && ok "$S: mock block fans out per tenant" || bad "$S: multi-tenant mock block: $blk"

# ── the real PostToolUse hook arms a marker whose commands and tenants come from the manifest ────
RT=$([ "$S" = niete ] && echo bot/ || echo "")
printf '// touched\n' >> "$D/${RT}shared/services/menu.service.js"; git -C "$D" add -A >/dev/null; git -C "$D" commit -qm "touch menu"
SESSION="tenancy-$$"
printf '{"session_id":"%s","cwd":"%s","tool_name":"Bash","tool_input":{"command":"cd %s && git commit -m x"},"tool_response":{}}' "$SESSION" "$D" "$D" \
  | bash ./e2e-autorun.sh >"$D/.claude/.e2e-pending/hook.out" 2>&1
M="$D/.claude/.e2e-pending/$SESSION.json"
[ -f "$M" ] && ok "$S: marker armed" || bad "$S: no marker at $M ($(head -c 300 "$D/.claude/.e2e-pending/hook.out"))"
if [ -f "$M" ]; then
  n=$(jq -r '.tenants | keys | length' "$M" 2>/dev/null)
  case "$S:$n" in niete:1|rumi:5) ok "$S: marker carries $n tenant(s)";; *) bad "$S: marker tenants=$n";; esac
  jq -r '.commands[]' "$M" | grep -q "^$CMD" && ok "$S: commands use $CMD" || bad "$S: commands: $(jq -c .commands "$M")"
  jq -r '.spec_hashes | to_entries[] | .value.path' "$M" | grep -q "^tests/features/whatsapp/$([ "$S" = niete ] && echo niete || echo rumi)/menu.feature$" \
    && ok "$S: spec hash path is the manifest spec dir" || bad "$S: spec_hashes paths: $(jq -c .spec_hashes "$M")"
  ctx=$(jq -r '.hookSpecificOutput.additionalContext // .additionalContext // ""' "$D/.claude/.e2e-pending/hook.out" 2>/dev/null)
  printf '%s' "$ctx" | grep -q "engine/bin/validate_specs.py" && ok "$S: order names the engine validator" || bad "$S: order lacks engine validator path"
  printf '%s' "$ctx" | grep -q "/niete-e2e" && [ "$S" = rumi ] && bad "rumi: order still says /niete-e2e" || ok "$S: order uses the manifest command"
  # the Stop hook adopts the marker and blocks exactly once, naming the same paths
  out=$(printf '{"session_id":"%s","cwd":"%s","hook_event_name":"Stop"}' "$SESSION" "$D" | bash ./e2e-autorun-stop.sh 2>/dev/null)
  printf '%s' "$out" | jq -e '.decision=="block"' >/dev/null && ok "$S: stop hook blocks once" || bad "$S: stop hook did not block: $(printf '%s' "$out" | head -c 200)"
  [ "$(jq -r .nudged "$M")" = true ] && ok "$S: marker nudged" || bad "$S: marker not nudged"
fi

# ── git hooks: post-commit arms the same marker shape; pre-push consults manifest branches ───────
printf '// touched again\n' >> "$D/${RT}shared/services/status.service.js"; git -C "$D" add -A >/dev/null
( cd "$D" && GIT_DIR="$D/.git" git commit -qm "touch status" && bash "$D/.claude/qa/engine/githooks/post-commit" >/dev/null 2>&1 )
GM=$(ls -t "$D"/.claude/.e2e-pending/git-*.json 2>/dev/null | head -1)
[ -n "$GM" ] && ok "$S: post-commit wrote a git marker" || bad "$S: post-commit wrote no marker"
if [ -n "$GM" ]; then
  n=$(jq -r '.tenants | keys | length' "$GM" 2>/dev/null)
  case "$S:$n" in niete:1|rumi:4) ok "$S: git marker carries $n tenant(s) for status";; *) bad "$S: git marker tenants=$n";; esac
fi

[ "$F" = 0 ] && echo "e2e-tenancy[$S]: all ok" || { echo "e2e-tenancy[$S]: $F failure(s)"; exit 1; }
