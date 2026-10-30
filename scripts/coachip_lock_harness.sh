#!/usr/bin/env bash
# The COACHIP nightly's run lock, proven through a transaction pooler (bd-sex15q.19, session 2a).
#   scripts/coachip_lock_harness.sh [jest args...]
# Starts a throwaway PostgreSQL 17 and pgbouncer in pool_mode=transaction (default_pool_size=2, like Supavisor on 6543),
# runs dashboard/tests/insights/run-lock-pooler.service.test.js against both, and tears everything down. Nothing leaves the
# temp directory; no remote database is touched.
set -euo pipefail
# PostgreSQL 17 first: a bare initdb on PATH may be libpq's, with no server beside it.
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || true)}"
for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/postgres" ] && PGBIN="$d" && break; done
export PATH="$PGBIN:$PATH"
command -v pgbouncer >/dev/null || { echo "pgbouncer not found (brew install pgbouncer)"; exit 2; }
command -v initdb >/dev/null || { echo "initdb not found (PostgreSQL 17)"; exit 2; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/coachip-lock.XXXXXX")"
PGPORT="${COACHIP_LOCK_PGPORT:-55491}"
BPORT="${COACHIP_LOCK_BPORT:-56491}"
cleanup() {
  [ -f "$WORK/pgbouncer.pid" ] && kill "$(cat "$WORK/pgbouncer.pid")" 2>/dev/null || true
  pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
initdb -D "$WORK/data" -U postgres -A trust >/dev/null
pg_ctl -D "$WORK/data" -o "-p $PGPORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
echo '"postgres" ""' > "$WORK/users.txt"
cat > "$WORK/pgbouncer.ini" <<INI
[databases]
postgres = host=127.0.0.1 port=$PGPORT dbname=postgres user=postgres
one = host=127.0.0.1 port=$PGPORT dbname=postgres user=postgres pool_size=1
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = $BPORT
unix_socket_dir =
auth_type = trust
auth_file = $WORK/users.txt
pool_mode = transaction
default_pool_size = 2
min_pool_size = 0
server_reset_query =
logfile = $WORK/pgbouncer.log
pidfile = $WORK/pgbouncer.pid
INI
pgbouncer -d "$WORK/pgbouncer.ini"
for _ in $(seq 1 50); do psql -h 127.0.0.1 -p "$BPORT" -U postgres -d postgres -Atc 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done
echo "harness: postgres $(postgres --version | awk '{print $3}') on $PGPORT, pgbouncer $(pgbouncer --version | head -1 | awk '{print $2}') pool_mode=transaction default_pool_size=2 on $BPORT"
cd "$REPO/dashboard"
# Node 25 refuses jest-environment-node without a localStorage file (a path with no spaces).
case "${NODE_OPTIONS:-}" in *localstorage-file*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:-} --localstorage-file=$WORK/ls.json" ;; esac
COACHIP_LOCK_POOLED_URL="postgres://postgres@127.0.0.1:$BPORT/postgres" \
COACHIP_LOCK_ONE_URL="postgres://postgres@127.0.0.1:$BPORT/one" \
COACHIP_LOCK_DIRECT_URL="postgres://postgres@127.0.0.1:$PGPORT/postgres" \
  npx jest --verbose --maxWorkers=1 tests/insights/run-lock-pooler.service.test.js "$@"
