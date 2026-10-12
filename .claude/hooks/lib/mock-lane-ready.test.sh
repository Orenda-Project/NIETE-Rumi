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
# The sections up to the local-database one test the SANDBOX lane (keys, redis, autofix): opt out
# explicitly, since the local lane is the default (bd-z3ze4.2).
export E2E_LOCAL_DB=0
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

echo "mock-lane — autofix: apt-get is the Linux path when there is no brew (bd-vqp9g)"
# An Ubuntu box with no brew and no docker could NOT self-fix: the autofix only knew brew, so
# commit-e2e.sh exited 3 and told the operator to run `brew install redis` on a machine with no
# brew (PR #1151, 2026-09-21). apt-get must never PROMPT — the autofix runs from hooks and a
# password prompt would hang the agent's turn — so it installs only when sudo -n already works.
mkdir -p "$TMP/dbin"; cp "$TMP/abin/railway" "$TMP/dbin/railway"
cat > "$TMP/dbin/apt-get" <<AG
#!/bin/sh
case "\$*" in *install*redis*) printf '#!/bin/sh\necho ok\n' > "$TMP/dbin/redis-server"; chmod +x "$TMP/dbin/redis-server";; esac
AG
cat > "$TMP/dbin/sudo" <<SU
#!/bin/sh
[ "\$1" = "-n" ] && shift
[ "\$1" = "true" ] && exit 0
exec "\$@"
SU
chmod +x "$TMP/dbin/railway" "$TMP/dbin/apt-get" "$TMP/dbin/sudo"
mk_machine() { mkdir -p "$1/bot/scripts/e2e" "$1/.claude/qa/shared"; cp "$ROOT/bot/scripts/e2e/provision-local-keys.sh" "$1/bot/scripts/e2e/"; cp "$ROOT/.claude/qa/shared/niete_training_db.py" "$1/.claude/qa/shared/"; git -C "$1" init -q >/dev/null 2>&1; }
D="$TMP/apt/main"; mk_machine "$D"
out=$(PATH="$TMP/dbin:/usr/bin:/bin" e2e_mock_lane_autofix "$D" --with-redis 2>&1); rc=$?
say "no brew, but apt-get + passwordless sudo → autofix succeeds" "$rc" "0"
has "…and says it installed redis via apt-get" "$out" "apt-get" yes
[ -x "$TMP/dbin/redis-server" ] && ok "…and redis-server is now on PATH" || bad "the apt-get branch did not install redis-server"

# apt-get present but sudo would prompt: fail CLEANLY and name the command, never hang.
mkdir -p "$TMP/nbin"; cp "$TMP/abin/railway" "$TMP/nbin/railway"; cp "$TMP/dbin/apt-get" "$TMP/nbin/apt-get"
printf '#!/bin/sh\nexit 1\n' > "$TMP/nbin/sudo"; chmod +x "$TMP/nbin/railway" "$TMP/nbin/apt-get" "$TMP/nbin/sudo"
E="$TMP/apt2/main"; mk_machine "$E"
out=$(PATH="$TMP/nbin:/usr/bin:/bin" e2e_mock_lane_autofix "$E" --with-redis 2>&1); rc=$?
say "apt-get but no passwordless sudo → fails, does not hang" "$rc" "1"
has "…and names the exact command to run by hand" "$out" "apt-get install" yes
[ -x "$TMP/nbin/redis-server" ] && bad "installed redis although it could not sudo" || ok "…and installed nothing"

# Neither package manager (D already has keys, so nothing external is needed): name BOTH.
mkdir -p "$TMP/empty"
out=$(PATH="$TMP/empty" e2e_mock_lane_autofix "$D" --with-redis 2>&1); rc=$?
has "no brew and no apt-get → the message names both" "$out" "no brew or apt-get" yes

blk=$(PATH="$TMP/nbin:/usr/bin:/bin" e2e_mock_not_ready_block "redis-server not on PATH")
has "the not-ready block suggests apt-get on a machine that has it" "$blk" "apt-get install" yes

echo "mock-lane — commit-e2e.sh AUTO-FIXES instead of refusing when railway is available"
R2="$TMP/clone auto"; mkdir -p "$R2/bot/shared/services" "$R2/bot/scripts/e2e" "$R2/.claude/hooks" "$R2/tests/features/whatsapp"
cp -R "$ROOT/.claude/qa" "$R2/.claude/qa"; cp -R "$ROOT/.claude/hooks/lib" "$R2/.claude/hooks/lib"; cp "$ROOT/bot/scripts/e2e/provision-local-keys.sh" "$R2/bot/scripts/e2e/"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R2/tests/features/whatsapp/niete"; rm -rf "$R2/.claude/qa/results" "$R2/.claude/.e2e-pending"
printf 'module.exports = { ROWS: [] };\n' > "$R2/bot/shared/services/menu.service.js"
git -C "$R2" init -q -b sandbox; git -C "$R2" config user.email t@l; git -C "$R2" config user.name t; git -C "$R2" add -A >/dev/null; git -C "$R2" commit -qm baseline
printf '// change\n' >> "$R2/bot/shared/services/menu.service.js"; git -C "$R2" add -A >/dev/null; git -C "$R2" commit -qm "feat(menu): x"
out=$(cd "$R2" && PATH="$TMP/abin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_SPEC_SYNC_OFF=1 bash .claude/qa/shared/commit-e2e.sh HEAD --features menu 2>&1); rc=$?
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
out=$(cd "$R" && PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_AUTOFIX_OFF=1 E2E_SPEC_SYNC_OFF=1 bash .claude/qa/shared/commit-e2e.sh HEAD --features menu 2>&1); rc=$?
say "exit 3 (blocked) — nothing was driven" "$rc" "3"
has "the output names the missing keys file" "$out" "niete-local.env" yes
has "…and the one remaining manual fact" "$out" "railway login" yes
has "…and never reached the stack (no run id printed)" "$out" "driving:" no
[ -d "$R/.claude/qa/results" ] && bad "a results dir was created although the run was refused" || ok "no results dir created"

echo "mock-lane — the local database is the DEFAULT and sets ITSELF up on a new machine (bd-z3ze4, .2)"
unset E2E_LOCAL_DB
# A fake local-db.sh answers `doctor` / `seed-status` / `seed-pull` from marker files, so this pins the
# READINESS logic, not Postgres. Real behaviour of those commands: bot/scripts/e2e/local-db.test.sh.
mk_ldb() {   # $1 = main checkout; markers live in $1/.ldb/{tools,seed}
  mkdir -p "$1/bot/scripts/e2e" "$1/.ldb"
  cat > "$1/bot/scripts/e2e/local-db.sh" <<'LDB'
#!/bin/sh
M="$(cd "$(dirname "$0")/../../.." && pwd)/.ldb"
case "$1" in
  doctor) rc=0
    [ -f "$M/tools" ] || { echo "postgres17 missing"; echo "postgrest missing"; rc=1; }
    s=$(cat "$M/seed" 2>/dev/null || echo missing); [ "$s" = ok ] || { echo "seed $s"; rc=1; }
    exit $rc ;;
  seed-status) cat "$M/seed" 2>/dev/null || echo missing ;;
  seed-pull) [ -n "${FAKE_RAILWAY_FAIL:-}" ] && { echo "[local-db] no seed source: log in to railway" >&2; exit 3; }
    echo ok > "$M/seed"; echo "[local-db] seed: 176M in 207s" >&2 ;;
  drift) [ -f "$M/drift" ] || exit 0
    echo "schema drift — the live sandbox differs from the committed baseline (+ only on the sandbox, - only in the baseline):"
    echo "+ quiz_sessions.device_ref:text"; echo "fix: bash bot/scripts/e2e/local-db.sh baseline"; exit 10 ;;
esac
LDB
  chmod +x "$1/bot/scripts/e2e/local-db.sh"
}
mkdir -p "$TMP/lbin"; cp "$TMP/abin/railway" "$TMP/lbin/railway"; printf '#!/bin/sh\necho ok\n' > "$TMP/lbin/redis-server"
cat > "$TMP/lbin/brew" <<BR
#!/bin/sh
case "\$*" in *install*postgresql@17*pgvector*postgrest*) touch "\$LDB_MARK/tools";; esac
BR
chmod +x "$TMP/lbin/railway" "$TMP/lbin/redis-server" "$TMP/lbin/brew"
L="$TMP/local/main"; mk_ldb "$L"; mkdir -p "$L/keys"; : > "$L/keys/niete-local.env"
out=$(E2E_LOCAL_DB=0 PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_ready "$L"); rc=$?
say "opt-out (E2E_LOCAL_DB=0, the sandbox lane): the local DB is not a precondition" "$rc:$out" "0:"
out=$(PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_ready "$L"); rc=$?
say "DEFAULT (E2E_LOCAL_DB unset) on a bare machine → not ready" "$rc" "1"
has "…naming Postgres 17" "$out" "postgres17" yes
has "…and the missing seed snapshot" "$out" "seed missing" yes
out=$(LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" 2>&1); rc=$?
has "without --with-redis (the commit hook) nothing heavy runs: no install" "$out" "auto-installed postgres" no
has "…and no 3-minute seed pull inside a commit" "$out" "auto-pulled" no
out=$(LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" --with-redis 2>&1); rc=$?
has "--with-redis (about to run): brew installs Postgres 17 + pgvector + postgrest" "$out" "auto-installed postgresql@17" yes
has "…and pulls the seed snapshot" "$out" "auto-pulled the seed snapshot" yes
say "…and the machine is ready afterwards" "$rc" "0"
out=$(PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_ready "$L"); rc=$?
say "ready check now passes with zero manual steps" "$rc:$out" "0:"
echo stale > "$L/.ldb/seed"
out=$(LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" --with-redis 2>&1); rc=$?
has "a STALE snapshot (the committed table list changed) is re-pulled" "$out" "auto-pulled the seed snapshot" yes
touch "$L/.ldb/drift"
out=$(LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" --with-redis 2>&1); rc=$?
has "by DEFAULT a run does not check drift (it needs sandbox access; bd-z3ze4.5)" "$out" "schema drift" no
out=$(E2E_DRIFT_CHECK=1 LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" --with-redis 2>&1); rc=$?
has "with E2E_DRIFT_CHECK=1, schema drift on the sandbox is SAID before a run (bd-z3ze4.3)" "$out" "schema drift" yes
has "…naming what differs" "$out" "device_ref" yes
has "…and the fix" "$out" "local-db.sh baseline" yes
say "…but never blocks the run (a warning, not a refusal)" "$rc" "0"
rm -f "$L/.ldb/drift"
out=$(E2E_DRIFT_CHECK=1 LDB_MARK="$L/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L" --with-redis 2>&1)
has "no drift → nothing said about it" "$out" "schema drift" no
# bd-z3ze4.5: the local lane needs NO keys file and NO Railway — its settings are committed, its DB/files its own.
NK="$TMP/nokeys/main"; mk_ldb "$NK"; touch "$NK/.ldb/tools"; echo ok > "$NK/.ldb/seed"
mkdir -p "$TMP/nrbin"; cp "$TMP/lbin/redis-server" "$TMP/nrbin/"   # no railway, no brew on PATH
out=$(PATH="$TMP/nrbin:/usr/bin:/bin" e2e_mock_lane_ready "$NK"); rc=$?
say "local lane, no keys file, no railway: READY" "$rc:$out" "0:"
out=$(LDB_MARK="$NK/.ldb" PATH="$TMP/nrbin:/usr/bin:/bin" e2e_mock_lane_autofix "$NK" --with-redis 2>&1); rc=$?
say "…and the autofix succeeds without touching Railway" "$rc" "0"
has "…and does not try to provision a keys file" "$out" "niete-local.env" no
[ -e "$NK/keys/niete-local.env" ] && bad "a keys file was written on the local lane" || ok "…no keys file written"
out=$(E2E_LOCAL_DB=0 PATH="$TMP/nrbin:/usr/bin:/bin" e2e_mock_lane_ready "$NK"); rc=$?
has "the SANDBOX lane (E2E_LOCAL_DB=0) still requires the keys file" "$out" "niete-local.env" yes
L2="$TMP/local2/main"; mk_ldb "$L2"; mkdir -p "$L2/keys"; : > "$L2/keys/niete-local.env"; touch "$L2/.ldb/tools"
out=$(FAKE_RAILWAY_FAIL=1 LDB_MARK="$L2/.ldb" PATH="$TMP/lbin:/usr/bin:/bin" e2e_mock_lane_autofix "$L2" --with-redis 2>&1); rc=$?
say "railway not logged in → the seed pull fails, autofix fails" "$rc" "1"
blk=$(e2e_mock_not_ready_block "$out")
has "…and the fix text names railway login" "$blk" "railway login" yes
blk=$(e2e_mock_not_ready_block "postgres17 missing")
has "missing Postgres → the fix text names the brew install" "$blk" "brew install postgresql@17 pgvector postgrest" yes

echo "mock-lane — run-suite.sh (not only commit-e2e.sh) sets an unready machine up itself (bd-z3ze4.2)"
R3="$TMP/clone suite"; mkdir -p "$R3/bot/shared/services" "$R3/bot/scripts/e2e" "$R3/.claude/hooks" "$R3/tests/features/whatsapp"
cp -R "$ROOT/.claude/qa" "$R3/.claude/qa"; cp -R "$ROOT/.claude/hooks/lib" "$R3/.claude/hooks/lib"; cp "$ROOT/bot/scripts/e2e/provision-local-keys.sh" "$R3/bot/scripts/e2e/"
cp -R "$ROOT/tests/features/whatsapp/niete" "$R3/tests/features/whatsapp/niete"; rm -rf "$R3/.claude/qa/results" "$R3/.claude/.e2e-pending"
printf 'module.exports = { ROWS: [] };\n' > "$R3/bot/shared/services/menu.service.js"
git -C "$R3" init -q -b sandbox; git -C "$R3" config user.email t@l; git -C "$R3" config user.name t; git -C "$R3" add -A >/dev/null; git -C "$R3" commit -qm baseline
out=$(cd "$R3" && PATH="$TMP/abin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" E2E_LOCAL_DB=0 E2E_LEDGER_COMMIT_OFF=1 bash .claude/qa/shared/run-suite.sh menu --method mock --commit HEAD --run-id rs-autofix 2>&1); rc=$?
has "run-suite.sh auto-provisioned the keys (it no longer depends on commit-e2e.sh having run first)" "$out" "auto-provisioned" yes
[ -f "$R3/keys/niete-local.env" ] && ok "…keys file exists afterwards" || bad "run-suite did not provision keys"

echo "mock-lane — the seed comes from the PRIVATE release: the fix text says gh, not railway (bd-z3ze4.7)"
blk=$(e2e_mock_not_ready_block "seed snapshot missing (pull failed: could not download niete-e2e-seed.tar.gz from Orenda-Project/niete-e2e-fixtures release seed-x: HTTP 404 — gh auth login with access to Orenda-Project/niete-e2e-fixtures)")
has "a failed release download names gh auth login" "$blk" "gh auth login" yes
has "…and does NOT send the operator to railway" "$blk" "railway login" no
blk=$(e2e_mock_not_ready_block "seed snapshot missing (pull failed: gh not found — brew install gh, then gh auth login (needs access to Orenda-Project/niete-e2e-fixtures))")
has "no gh at all → names the install" "$blk" "brew install gh" yes

echo "mock-lane — no gh on a machine that needs the release seed: brew installs it (bd-z3ze4.7)"
G="$TMP/ghless/main"; mk_ldb "$G"; touch "$G/.ldb/tools"; mkdir -p "$G/supabase/baseline"; echo "tag=seed-x" > "$G/supabase/baseline/seed-release.txt"
mkdir -p "$TMP/gbin"; cp "$TMP/lbin/redis-server" "$TMP/gbin/"
printf '#!/bin/sh\ncase "$*" in *install*gh*) printf "#!/bin/sh\\nexit 0\\n" > "%s/gbin/gh"; chmod +x "%s/gbin/gh";; esac\n' "$TMP" "$TMP" > "$TMP/gbin/brew"; chmod +x "$TMP/gbin/brew"
out=$(LDB_MARK="$G/.ldb" PATH="$TMP/gbin:/usr/bin:/bin" e2e_mock_lane_autofix "$G" --with-redis 2>&1)
has "autofix installs gh when the seed comes from the release and gh is missing" "$out" "auto-installed gh" yes
[ -x "$TMP/gbin/gh" ] && ok "…gh is on PATH afterwards" || bad "gh was not installed"

echo; [ "$FAILED" -eq 0 ] && { echo "mock-lane-ready: all passed"; exit 0; } || { echo "mock-lane-ready: $FAILED failed"; exit 1; }
