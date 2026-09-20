#!/bin/bash
# lib/tenants.sh in WORKSPACE mode: the tenant layer sits ABOVE the bot clone (bd-9157r, 2026-09-20).
#   bash .claude/qa/engine/hooks/lib/tenants-workspace.test.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/tenants.sh"
FAILED=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED+1)); }
say(){ [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
WS=$(mktemp -d); trap 'rm -rf "$WS"' EXIT
L="$WS/.claude/qa/tenants/niete"; mkdir -p "$L/config" "$L/agents" "$WS/NIETE-Rumi/tests"
printf 'version: 1\nrepo: NIETE-Rumi\ncommand: /niete-e2e\nspec_suite: niete\nruntime_scope:\n  - bot/**\ntenants:\n  niete:\n    region_code: default\n' > "$L/config/tenants.yaml"
git -C "$WS/NIETE-Rumi" init -q; git -C "$WS/NIETE-Rumi" remote add origin https://github.com/Orenda-Project/NIETE-Rumi.git
git -C "$WS/NIETE-Rumi" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
unset CLAUDE_PROJECT_DIR
echo "tenants.sh — workspace mode"
say "e2e_root from inside the clone is the CLONE"          "$(cd "$WS/NIETE-Rumi/tests" && e2e_root)" "$WS/NIETE-Rumi"
say "e2e_layer is the workspace tenant dir"                "$(cd "$WS/NIETE-Rumi/tests" && e2e_layer)" "$L"
say "e2e_abs agents_abs points into the layer"             "$(cd "$WS/NIETE-Rumi/tests" && e2e_abs agents_abs)" "$L/agents"
say "e2e_abs spec_abs points into the clone"               "$(cd "$WS/NIETE-Rumi/tests" && e2e_abs spec_abs)" "$WS/NIETE-Rumi/tests/features/whatsapp/niete"
say "e2e_cmd reads the layer's manifest"                   "$(cd "$WS/NIETE-Rumi" && e2e_cmd)" "/niete-e2e"
say "from the workspace root + CLAUDE_PROJECT_DIR=clone"   "$(cd "$WS" && CLAUDE_PROJECT_DIR="$WS/NIETE-Rumi" e2e_root)" "$WS/NIETE-Rumi"
r=$(cd "$WS" && e2e_root); [ "$r" != "$WS" ] && ok "the workspace root itself is never the guarded repo" || bad "the workspace root resolved to itself"
# the vendored engine's tests run with cwd INSIDE a guarded bot repo — the session's clone must still win
mkdir -p "$WS/other/.claude/qa/config" "$WS/other/sub"; cp "$L/config/tenants.yaml" "$WS/other/.claude/qa/config/tenants.yaml"
say "CLAUDE_PROJECT_DIR=clone beats a guarded cwd"          "$(cd "$WS/other/sub" && CLAUDE_PROJECT_DIR="$WS/NIETE-Rumi" e2e_root)" "$WS/NIETE-Rumi"
say "…and e2e_layer follows it"                            "$(cd "$WS/other/sub" && CLAUDE_PROJECT_DIR="$WS/NIETE-Rumi" e2e_layer)" "$L"
echo; [ "$FAILED" -eq 0 ] && { echo "tenants-workspace: all passed"; exit 0; } || { echo "tenants-workspace: $FAILED failed"; exit 1; }
