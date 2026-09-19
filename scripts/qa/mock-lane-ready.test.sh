#!/bin/bash
# The mock lane is "part of the hook" only if the hook can SAY, before an agent's turn, whether this
# machine can run it. Until 2026-09-18 the first signal was exit 14 deep inside local-stack.sh, after
# the commit, so a developer without keys/niete-local.env got a printed command that could never run
# and a ledger reading `e2e: missing` (PR #1084). These cases pin the preflight: the resolver, the
# readiness check, and commit-e2e.sh refusing up front with the one-command fix.
#
# Run:  bash scripts/qa/mock-lane-ready.test.sh
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"
FAILED=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
say() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
has() { case "$2" in *"$3"*) got=yes ;; *) got=no ;; esac; say "$1" "$got" "$4"; }

. "$ROOT/.claude/qa/engine/hooks/lib/mock-lane.sh"
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
has "names railway login for a missing keys file" "$blk" "railway login" yes
has "names the redis install" "$blk" "brew install redis" yes
blk=$(e2e_mock_not_ready_block "redis-server not on PATH")
has "redis-only: does not mention railway login" "$blk" "railway login" no

echo "mock-lane — autofix: an unready machine fixes ITSELF (no manual step)"
# fake railway (answers per --environment) + fake brew (drops a redis-server into the PATH dir)
mkdir -p "$TMP/abin"; SBX=$(sed -nE 's/^ENV_REFS = .*"sandbox": "([a-z0-9]+)".*/\1/p' "$ROOT/.claude/qa/shared/niete_training_db.py")
cat > "$TMP/abin/railway" <<RW
#!/bin/sh
[ -n "\${FAKE_RAILWAY_FAIL:-}" ] && { echo "Unauthorized. Please login with 'railway login'" >&2; exit 1; }
env=staging; while [ \$# -gt 0 ]; do case "\$1" in --environment) env="\$2"; shift 2;; *) shift;; esac; done
case "\$env" in sandbox) printf '%s\\n' "SUPABASE_URL=https://$SBX.supabase.co" "SUPABASE_SERVICE_ROLE_KEY=SBX";;
  *) printf '%s\\n' "PAKISTAN_LP_FLOW_ID=1" "PORTAL_URL=https://p.test" "R2_BUCKET_NAME=b";; esac
RW
cat > "$TMP/abin/brew" <<BR
#!/bin/sh
case "\$*" in *install*redis*) printf '#!/bin/sh\necho ok\n' > "$TMP/abin/redis-server"; chmod +x "$TMP/abin/redis-server";; esac
BR
chmod +x "$TMP/abin/railway" "$TMP/abin/brew"
A="$TMP/auto/main"; mkdir -p "$A/bot/scripts/e2e" "$A/.claude/qa/shared"
cp "$ROOT/bot/scripts/e2e/provision-local-keys.sh" "$A/bot/scripts/e2e/"; cp "$ROOT/.claude/qa/shared/niete_training_db.py" "$A/.claude/qa/shared/"
git -C "$A" init -q >/dev/null 2>&1
out=$(PATH="$TMP/abin:/usr/bin:/bin" e2e_mock_lane_autofix "$A" 2>&1); rc=$?
has "keys missing → auto-provisioned from Railway (says so)" "$out" "auto-provisioned" yes
[ -f "$A/keys/niete-local.env" ] && ok "…and the file now exists in <main>/keys" || bad "keys file not created ($A/keys)"
has "…redis not touched without --with-redis (still named)" "$(PATH="$TMP/abin:/usr/bin:/bin" e2e_mock_lane_ready "$A")" "redis-server" yes
out=$(PATH="$TMP/abin:/usr/bin:/bin" e2e_mock_lane_autofix "$A" --with-redis 2>&1); rc=$?
has "--with-redis: brew installs redis (says so)" "$out" "redis" yes
PATH="$TMP/abin:/usr/bin:/bin" e2e_mock_lane_ready "$A" >/dev/null && ok "machine is now READY with zero manual steps" || bad "still not ready after autofix"
B="$TMP/auto2/main"; mkdir -p "$B/bot/scripts/e2e" "$B/.claude/qa/shared"; cp "$A/bot/scripts/e2e/provision-local-keys.sh" "$B/bot/scripts/e2e/"; cp "$A/.claude/qa/shared/niete_training_db.py" "$B/.claude/qa/shared/"; git -C "$B" init -q >/dev/null 2>&1
out=$(FAKE_RAILWAY_FAIL=1 PATH="$TMP/abin:/usr/bin:/bin" e2e_mock_lane_autofix "$B" 2>&1); rc=$?
say "railway not logged in → autofix fails" "$rc" "1"
has "…and names the ONE remaining manual fact" "$out" "railway login" yes
[ -e "$B/keys/niete-local.env" ] && bad "wrote a file without credentials" || ok "nothing written"
blk=$(e2e_mock_not_ready_block "$(printf 'keys/niete-local.env missing (auto-provision failed: railway not logged in)')")
has "the not-ready text now points at railway login, not at a script to run by hand" "$blk" "railway login" yes

echo "mock-lane — commit-e2e.sh AUTO-FIXES instead of refusing when railway is available"
R2="$TMP/clone auto"; mkdir -p "$R2/bot/shared/services" "$R2/bot/scripts/e2e" "$R2/.claude/hooks" "$R2/tests/features/whatsapp"
cp -R "$ROOT/.claude/qa" "$R2/.claude/qa"; cp -R "$ROOT/.claude/hooks/lib" "$R2/.claude/hooks/lib"; cp "$ROOT/bot/scripts/e2e/provision-local-keys.sh" "$R2/bot/scripts/e2e/"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R2/tests/features/whatsapp/niete"; rm -rf "$R2/.claude/qa/results" "$R2/.claude/.e2e-pending"
printf 'module.exports = { ROWS: [] };\n' > "$R2/bot/shared/services/menu.service.js"
git -C "$R2" init -q -b sandbox; git -C "$R2" config user.email t@l; git -C "$R2" config user.name t; git -C "$R2" add -A >/dev/null; git -C "$R2" commit -qm baseline
printf '// change\n' >> "$R2/bot/shared/services/menu.service.js"; git -C "$R2" add -A >/dev/null; git -C "$R2" commit -qm "feat(menu): x"
out=$(cd "$R2" && PATH="$TMP/abin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_SPEC_SYNC_OFF=1 bash .claude/qa/engine/bin/commit-e2e.sh HEAD --features menu 2>&1); rc=$?
has "commit-e2e auto-provisioned the keys" "$out" "auto-provisioned" yes
has "…and did NOT print the not-ready block" "$out" "NOT READY" no
[ -f "$R2/keys/niete-local.env" ] && ok "keys file exists in the repo's keys/ afterwards" || bad "keys file missing after commit-e2e"

echo "mock-lane — commit-e2e.sh refuses UP FRONT on an unready machine"
R="$TMP/clone with space"; mkdir -p "$R/bot/shared/services" "$R/.claude/hooks" "$R/tests/features/whatsapp"
cp -R "$ROOT/.claude/qa" "$R/.claude/qa"; cp -R "$ROOT/.claude/hooks/lib" "$R/.claude/hooks/lib"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R/tests/features/whatsapp/niete"
rm -rf "$R/.claude/qa/results" "$R/.claude/.e2e-pending"
printf 'module.exports = { ROWS: [] };\n' > "$R/bot/shared/services/menu.service.js"
git -C "$R" init -q -b sandbox; git -C "$R" config user.email t@l; git -C "$R" config user.name t
git -C "$R" add -A >/dev/null; git -C "$R" commit -qm baseline
printf '// change\n' >> "$R/bot/shared/services/menu.service.js"; git -C "$R" add -A >/dev/null; git -C "$R" commit -qm "feat(menu): x"
out=$(cd "$R" && PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_AUTOFIX_OFF=1 E2E_SPEC_SYNC_OFF=1 bash .claude/qa/engine/bin/commit-e2e.sh HEAD --features menu 2>&1); rc=$?
say "exit 3 (blocked) — nothing was driven" "$rc" "3"
has "the output names the missing keys file" "$out" "niete-local.env" yes
has "…and the one remaining manual fact" "$out" "railway login" yes
has "…and never reached the stack (no run id printed)" "$out" "driving:" no
[ -d "$R/.claude/qa/results" ] && bad "a results dir was created although the run was refused" || ok "no results dir created"

echo; [ "$FAILED" -eq 0 ] && { echo "mock-lane-ready: all passed"; exit 0; } || { echo "mock-lane-ready: $FAILED failed"; exit 1; }
