#!/bin/bash
# The mock lane is "part of the hook" only if the hook can SAY, before an agent's turn, whether this
# machine can run it. Until 2026-09-18 the first signal was exit 14 deep inside local-stack.sh, after
# the commit, so a developer without keys/niete-local.env got a printed command that could never run
# and a ledger reading `e2e: missing` (PR #1084). These cases pin the preflight: the resolver, the
# readiness check, and commit-e2e.sh refusing up front with the one-command fix.
#
# Run:  bash .claude/hooks/lib/mock-lane-ready.test.sh
set -u
cd "$(dirname "$0")/../../.." || exit 1
ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

. "$ROOT/.claude/hooks/lib/mock-lane.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/mocklane.XXXXXX"); trap 'rm -rf "$TMP"' EXIT

echo "mock-lane — keys dir resolution (mirrors local-stack.sh)"
mkdir -p "$TMP/ws/main/keys" "$TMP/ws/keys"
: > "$TMP/ws/main/keys/niete-staging.env"; : > "$TMP/ws/keys/niete-local.env"
say "a stray main/keys without the file falls back to the workspace keys/" "$(e2e_keys_dir "$TMP/ws/main")" "$TMP/ws/keys"
: > "$TMP/ws/main/keys/niete-local.env"
say "main/keys wins when it holds niete-local.env" "$(e2e_keys_dir "$TMP/ws/main")" "$TMP/ws/main/keys"

echo "mock-lane — readiness"
mkdir -p "$TMP/bin"; printf '#!/bin/sh\necho ok\n' > "$TMP/bin/redis-server"; chmod +x "$TMP/bin/redis-server"
mkdir -p "$TMP/bare/main"
out=$(PATH="$TMP/bin:/usr/bin:/bin" e2e_mock_lane_ready "$TMP/bare/main"); rc=$?
say "no keys file → not ready" "$rc" "1"
has "…and the missing item is NAMED" "$out" "niete-local.env" yes
out=$(PATH="/usr/bin:/bin" e2e_mock_lane_ready "$TMP/ws/main"); rc=$?
say "keys present but no redis-server on PATH → not ready" "$rc" "1"
has "…and redis-server is named" "$out" "redis-server" yes
has "…and the keys file is NOT named (it is present)" "$out" "niete-local.env" no
out=$(PATH="$TMP/bin:/usr/bin:/bin" e2e_mock_lane_ready "$TMP/ws/main"); rc=$?
say "keys + redis-server → ready, silent" "$rc:$out" "0:"

echo "mock-lane — the fix text"
blk=$(e2e_mock_not_ready_block "$(printf 'keys/niete-local.env missing\nredis-server not on PATH')")
has "names the provisioning command for the keys file" "$blk" "provision-local-keys.sh" yes
has "names the redis install" "$blk" "brew install redis" yes
blk=$(e2e_mock_not_ready_block "redis-server not on PATH")
has "redis-only: does not send the developer to provision keys they have" "$blk" "provision-local-keys.sh" no

echo "mock-lane — commit-e2e.sh refuses UP FRONT on an unready machine"
R="$TMP/clone with space"; mkdir -p "$R/bot/shared/services" "$R/.claude/hooks" "$R/tests/features/whatsapp"
cp -R "$ROOT/.claude/qa" "$R/.claude/qa"; cp -R "$ROOT/.claude/hooks/lib" "$R/.claude/hooks/lib"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results" "$R/.claude/.e2e-pending"
printf 'module.exports = { ROWS: [] };\n' > "$R/bot/shared/services/menu.service.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
printf '// change\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null; git -C "$R" commit -qm "feat(menu): x"
out=$(cd "$R" && PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_SPEC_SYNC_OFF=1 bash .claude/qa/shared/commit-e2e.sh HEAD --features menu 2>&1); rc=$?
say "exit 3 (blocked) — nothing was driven" "$rc" "3"
has "the output names the missing keys file" "$out" "niete-local.env" yes
has "…and the one-command fix" "$out" "provision-local-keys.sh" yes
has "…and never reached the stack (no run id printed)" "$out" "driving:" no
[ -d "$R/.claude/qa/results" ] && bad "a results dir was created although the run was refused" || ok "no results dir created"

echo; [ "$FAILED" -eq 0 ] && { echo "mock-lane-ready: all passed"; exit 0; } || { echo "mock-lane-ready: $FAILED failed"; exit 1; }
