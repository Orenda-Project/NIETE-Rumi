#!/usr/bin/env bash
# qa-engine-guard.test.sh — the downstream read-only guard blocks engine paths, allows the tenant layer (bd-9157r).
set -uo pipefail
cd "$(dirname "$0")" || exit 1
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
blocks() { printf '{"tool_input":{"file_path":"%s"}}' "$1" | env -u QA_ENGINE_GUARD_OFF bash ./qa-engine-guard.sh | jq -e '.decision=="block"' >/dev/null 2>&1; }
for p in /x/.claude/qa/engine/bin/select_e2e.py "/x y/.claude/qa/engine/hooks/e2e-autorun.sh" /x/.claude/commands/sync-specs.md \
         /x/.claude/skills/gherkin-spec-sync/SKILL.md /x/.github/workflows/qa-impact.yml /x/.claude/qa/engine/ENGINE_VERSION; do
  blocks "$p" && ok "blocks $p" || bad "did not block $p"
done
for p in /x/.claude/qa/config/tenants.yaml /x/.claude/qa/config/feature-map.yaml /x/.claude/qa/fixtures/whatsapp/pk/copy.yaml \
         /x/.claude/qa/shared/features/menu.cjs /x/tests/features/whatsapp/rumi/menu.feature /x/.claude/qa/agents/menu-agent.md \
         /x/.claude/commands/niete-e2e.md /x/shared/services/menu.service.js; do
  blocks "$p" && bad "blocked tenant-layer path $p" || ok "allows $p"
done
out=$(printf '{"tool_input":{"file_path":"/x/.claude/qa/engine/bin/x.py"}}' | QA_ENGINE_GUARD_OFF=1 bash ./qa-engine-guard.sh)
[ -z "$out" ] && ok "QA_ENGINE_GUARD_OFF=1 bypasses" || bad "bypass ignored"
out=$(printf '{"tool_input":{}}' | bash ./qa-engine-guard.sh); [ -z "$out" ] && ok "no file_path → silent" || bad "spoke without a file_path"
[ "$F" = 0 ] && echo "qa-engine-guard: all ok" || { echo "qa-engine-guard: $F failure(s)"; exit 1; }
