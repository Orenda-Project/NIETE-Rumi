#!/usr/bin/env bash
# The portal's per-request DB role and user context, proven through a transaction pooler (bd-sex15q.50).
#   scripts/portal_rls_pooler_harness.sh [jest args...]
# Starts a throwaway PostgreSQL 17 (with a portal_app_user role and set_portal_user_context, as on prod) and pgbouncer in
# pool_mode=transaction with one server connection per pool, so every client shares ONE backend, the worst case of
# Supavisor on 6543. Runs dashboard/tests/database-context-pooler.service.test.js through it and tears everything down.
# Nothing leaves the temp directory; no remote database is touched.
set -euo pipefail
# PostgreSQL 17 first: a bare initdb on PATH may be libpq's, with no server beside it.
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || true)}"
for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/postgres" ] && PGBIN="$d" && break; done
export PATH="$PGBIN:$PATH"
command -v pgbouncer >/dev/null || { echo "pgbouncer not found (brew install pgbouncer)"; exit 2; }
command -v initdb >/dev/null || { echo "initdb not found (PostgreSQL 17)"; exit 2; }
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/portal-rls.XXXXXX")"
PGPORT="${PORTAL_RLS_PGPORT:-55492}"
BPORT="${PORTAL_RLS_BPORT:-56492}"
cleanup() {
  [ -f "$WORK/pgbouncer.pid" ] && kill "$(cat "$WORK/pgbouncer.pid")" 2>/dev/null || true
  pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
initdb -D "$WORK/data" -U postgres -A trust >/dev/null
pg_ctl -D "$WORK/data" -o "-p $PGPORT -k $WORK -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
# The role and the function as supabase/baseline/schema.sql defines them (session-scope set_config, as on prod).
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE portal_app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO portal_app_user;
CREATE FUNCTION public.set_portal_user_context(p_portal_user_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_portal_user_id IS NULL THEN
    PERFORM set_config('app.portal_user_id', '', false);
  ELSE
    PERFORM set_config('app.portal_user_id', p_portal_user_id::text, false);
  END IF;
END;
$$;
-- prod's shape (30 Oct 2026 catalog): portal_app_user holds SELECT on RLS tables whose only policy is
-- auth.role() = 'service_role', false on a direct connection, so the role reads nothing from them
CREATE TABLE public.coaching_sessions (id int);
ALTER TABLE public.coaching_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_coaching_sessions ON public.coaching_sessions FOR ALL TO public USING (false);
GRANT SELECT ON public.coaching_sessions TO portal_app_user;
INSERT INTO public.coaching_sessions VALUES (1), (2), (3);
SQL
echo '"postgres" ""' > "$WORK/users.txt"
cat > "$WORK/pgbouncer.ini" <<INI
[databases]
one = host=127.0.0.1 port=$PGPORT dbname=postgres user=postgres pool_size=1
[pgbouncer]
listen_addr = 127.0.0.1
listen_port = $BPORT
unix_socket_dir =
auth_type = trust
auth_file = $WORK/users.txt
pool_mode = transaction
default_pool_size = 1
min_pool_size = 0
server_reset_query =
logfile = $WORK/pgbouncer.log
pidfile = $WORK/pgbouncer.pid
INI
pgbouncer -d "$WORK/pgbouncer.ini"
for _ in $(seq 1 50); do psql -h 127.0.0.1 -p "$BPORT" -U postgres -d one -Atc 'SELECT 1' >/dev/null 2>&1 && break; sleep 0.1; done
echo "harness: postgres $(postgres --version | awk '{print $3}') on $PGPORT, pgbouncer $(pgbouncer --version | head -1 | awk '{print $2}') pool_mode=transaction pool_size=1 on $BPORT"
cd "$REPO/dashboard"
# Node 25 refuses jest-environment-node without a localStorage file (a path with no spaces).
case "${NODE_OPTIONS:-}" in *localstorage-file*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:-} --localstorage-file=$WORK/ls.json" ;; esac
PORTAL_RLS_POOLED=1 SUPABASE_DB_HOST=127.0.0.1 SUPABASE_DB_PORT="$BPORT" SUPABASE_DB_USER=postgres SUPABASE_DB_PASSWORD= \
SUPABASE_DB_NAME=one DB_POOL_MIN=0 PORTAL_RLS_DIRECT_URL="postgres://postgres@127.0.0.1:$PGPORT/postgres" \
  npx jest --verbose --maxWorkers=1 --forceExit tests/database-context-pooler.service.test.js "$@"
