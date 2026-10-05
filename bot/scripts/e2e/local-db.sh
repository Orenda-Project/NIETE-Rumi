#!/usr/bin/env bash
# local-db.sh — a clean local database for every mock-lane run, instead of the shared sandbox Supabase (bd-z3ze4).
#
#   bash bot/scripts/e2e/local-db.sh up <run_dir>          # clone a fresh run database; writes <run_dir>/db.env
#   bash bot/scripts/e2e/local-db.sh down <run_dir>        # stop this run's PostgREST + proxy, drop its database
#   bash bot/scripts/e2e/local-db.sh baseline [out.sql]    # re-dump the sandbox schema (schema only, no rows)
#   bash bot/scripts/e2e/local-db.sh status | stop          # the machine's cluster
#
# Three tiers, the same split the lane already uses for redis and node_modules:
#   once per machine   a Postgres 17 cluster under $LOCAL_DB_HOME, started on first use and left running
#                      (brew install postgresql@17 pgvector postgrest — no Docker).
#   once per schema    a GOLDEN database = bootstrap + schema + seed, named by the hash of those three files.
#                      A changed baseline or seed builds a new one; an unchanged one is reused.
#   every run          CREATE DATABASE … TEMPLATE golden — a file-level copy, so every run starts from the
#                      same state and nothing a run writes survives it. Then PostgREST on that database and a
#                      proxy that adds the /rest/v1 prefix supabase-js expects.
#
# Safety: `up` only ever writes a 127.0.0.1 SUPABASE_URL; `baseline` refuses any project ref but the sandbox
# one before it connects (the same ENV_REFS the DB tooling asserts).
#
# Exit codes: 2 usage · 3 baseline source is not the sandbox · 4 no Postgres 17 / pgvector / postgrest ·
# 5 cluster failed to start · 6 golden build failed · 7 run database clone failed · 8 PostgREST/proxy not healthy.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

LOCAL_DB_HOME="${LOCAL_DB_HOME:-$HOME/.cache/niete-e2e-db}"
PG_PORT="${LOCAL_DB_PG_PORT:-54329}"
REST_PORT="${LOCAL_DB_REST_PORT:-54330}"
API_PORT="${E2E_SUPABASE_PORT:-54321}"
SCHEMA="${LOCAL_DB_SCHEMA:-$REPO/supabase/baseline/schema.sql}"
SEED="${LOCAL_DB_SEED:-$REPO/supabase/baseline/seed.sql}"
BOOTSTRAP="$HERE/local-db-bootstrap.sql"
PGDATA="$LOCAL_DB_HOME/pg17"

log() { echo "[local-db] $*" >&2; }

pg_bin() {   # Postgres 17's bin dir: LOCAL_DB_PG_BIN, else Homebrew's keg, else PATH if it is 17
  local d
  for d in "${LOCAL_DB_PG_BIN:-}" /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    [ -n "$d" ] && [ -x "$d/postgres" ] && { echo "$d"; return 0; }
  done
  d="$(dirname "$(command -v postgres 2>/dev/null || echo /nonexistent/x)")"
  "$d/postgres" --version 2>/dev/null | grep -q ' 17\.' && { echo "$d"; return 0; }
  return 1
}
PGBIN="$(pg_bin)" || PGBIN=""
need_tools() {
  [ -n "$PGBIN" ] || { log "Postgres 17 not found — brew install postgresql@17 pgvector"; exit 4; }
  [ -f "$("$PGBIN/pg_config" --sharedir)/extension/vector.control" ] || { log "pgvector missing for Postgres 17 — brew install pgvector"; exit 4; }
  command -v postgrest >/dev/null 2>&1 || { log "postgrest not found — brew install postgrest"; exit 4; }
  command -v node >/dev/null 2>&1 || { log "node not found"; exit 4; }
}
psql_() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U postgres "$@"; }

cluster_up() {   # once per machine: init on first use, start if stopped
  mkdir -p "$LOCAL_DB_HOME"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    log "first use on this machine: initdb $PGDATA"
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C >"$LOCAL_DB_HOME/initdb.log" 2>&1 \
      || { log "initdb failed — $LOCAL_DB_HOME/initdb.log"; exit 5; }
  fi
  if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    # TCP on 127.0.0.1 only; no unix socket (a long $LOCAL_DB_HOME would overflow the socket path limit).
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOCAL_DB_HOME/postgres.log" -w -t 30 \
      -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      start >/dev/null 2>&1 || { log "postgres failed to start — $LOCAL_DB_HOME/postgres.log"; exit 5; }
  fi
}

golden_name() {   # golden_<12 hex of bootstrap + schema + seed>
  local h
  h=$(cat "$BOOTSTRAP" "$SCHEMA" "$([ -f "$SEED" ] && echo "$SEED" || echo /dev/null)" | shasum -a 256 | cut -c1-12)
  echo "golden_$h"
}

golden_ensure() {   # once per schema hash
  local g="$1" tmpdb="${1}_building"
  if [ "$(psql_ -d postgres -Atc "select 1 from pg_database where datname='$g'")" = "1" ]; then return 0; fi
  [ -f "$SCHEMA" ] || { log "no schema at $SCHEMA — run: local-db.sh baseline"; exit 6; }
  log "building $g (schema or seed changed since the last golden)"
  local t0=$SECONDS
  psql_ -d postgres -c "drop database if exists $tmpdb" >/dev/null
  psql_ -d postgres -c "create database $tmpdb" >/dev/null || exit 6
  # Roles are cluster-wide and never in a schema dump. Any role the schema grants to, or names in a policy
  # (portal_app_user, …), gets a NOLOGIN stand-in so the GRANT/POLICY applies; nothing can log in as it.
  local role
  for role in $(grep -hE '^(GRANT|REVOKE|CREATE POLICY|ALTER DEFAULT PRIVILEGES)' "$SCHEMA" \
                | grep -oE '\b(TO|FROM|FOR ROLE) [a-z_][a-z0-9_, ]*' | sed -E 's/^(TO|FROM|FOR ROLE) //' | tr ',' '\n' \
                | tr -d ' ;' | grep -vE '^(public|current_user|session_user)$' | sort -u); do
    psql_ -d postgres -c "do \$\$ begin if not exists (select from pg_roles where rolname='$role') then create role \"$role\" nologin; end if; end \$\$" >/dev/null || exit 6
  done
  local f files=("$BOOTSTRAP" "$SCHEMA")
  [ -f "$SEED" ] && files+=("$SEED")
  for f in "${files[@]}"; do
    psql_ -d "$tmpdb" -f "$f" >"$LOCAL_DB_HOME/golden.log" 2>&1 || { log "golden build failed applying $f:"; tail -5 "$LOCAL_DB_HOME/golden.log" >&2; exit 6; }
  done
  # Freeze it: a template nobody can connect to cannot be written by accident.
  psql_ -d postgres -c "alter database $tmpdb rename to $g" -c "alter database $g with is_template true allow_connections false" >/dev/null || exit 6
  # Old goldens are dead weight once their schema is gone.
  local old
  for old in $(psql_ -d postgres -Atc "select datname from pg_database where datname like 'golden\_%' and datname <> '$g'"); do
    psql_ -d postgres -c "alter database $old is_template false" -c "drop database $old" >/dev/null 2>&1 || true
  done
  log "built $g in $((SECONDS - t0))s"
}

jwt_secret() {   # one per machine, never leaves it
  local f="$LOCAL_DB_HOME/jwt-secret"
  [ -s "$f" ] || { (umask 077; openssl rand -hex 32 > "$f"); }
  cat "$f"
}
mint_key() {   # HS256 service_role JWT for supabase-js
  JWT_SECRET="$1" node -e '
    const c = require("crypto"); const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const body = b({ alg: "HS256", typ: "JWT" }) + "." + b({ role: "service_role", iss: "local-db", iat: now, exp: now + 86400 * 365 });
    process.stdout.write(body + "." + c.createHmac("sha256", process.env.JWT_SECRET).update(body).digest("base64url"));'
}

wait_http() {   # $1 url, $2 seconds
  local i
  for i in $(seq 1 $(( $2 * 5 ))); do curl -s -o /dev/null "$1" && return 0; sleep 0.2; done
  return 1
}

up() {
  local run_dir="${1:-}"
  [ -n "$run_dir" ] || { echo "usage: local-db.sh up <run_dir>" >&2; exit 2; }
  need_tools
  mkdir -p "$run_dir"; run_dir="$(cd "$run_dir" && pwd)"
  local t0=$SECONDS
  cluster_up
  local g; g=$(golden_name); golden_ensure "$g"
  local t1=$SECONDS
  local db="run_$(date +%s)_$$"
  psql_ -d postgres -c "create database $db template $g" >/dev/null 2>"$run_dir/db-clone.log" || { log "clone failed — $run_dir/db-clone.log"; exit 7; }
  local secret; secret=$(jwt_secret)
  cat > "$run_dir/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PG_PORT/$db"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
db-pool = 10
jwt-secret = "$secret"
server-host = "127.0.0.1"
server-port = $REST_PORT
log-level = "warn"
CONF
  ( exec postgrest "$run_dir/postgrest.conf" ) >"$run_dir/postgrest.log" 2>&1 &
  echo $! > "$run_dir/postgrest.pid"
  : > "$run_dir/requests.log"
  ( LOCAL_DB_REQUEST_LOG="$run_dir/requests.log" exec node "$HERE/local-db-proxy.js" "$API_PORT" "$REST_PORT" ) >"$run_dir/proxy.log" 2>&1 &
  echo $! > "$run_dir/proxy.pid"
  wait_http "http://127.0.0.1:$REST_PORT/" 20 || { log "PostgREST not healthy — $run_dir/postgrest.log"; tail -5 "$run_dir/postgrest.log" >&2; down "$run_dir"; exit 8; }
  wait_http "http://127.0.0.1:$API_PORT/health" 10 || { log "proxy not healthy — $run_dir/proxy.log"; down "$run_dir"; exit 8; }
  local url="http://127.0.0.1:$API_PORT"
  case "$url" in http://127.0.0.1:*) ;; *) log "refusing a non-local SUPABASE_URL"; exit 8;; esac
  { echo "# local-db run database $db (template $g) — written by local-db.sh, gone after down"
    echo "SUPABASE_URL=$url"
    echo "SUPABASE_SERVICE_ROLE_KEY=$(mint_key "$secret")"
    echo "LOCAL_DB_NAME=$db"; } > "$run_dir/db.env"
  echo "$db" > "$run_dir/db.name"
  log "up: $db from $g · $url → PostgREST :$REST_PORT → postgres :$PG_PORT · golden ${t1-t0}s, clone+serve $((SECONDS - t1))s"
}

down() {
  local run_dir="${1:-}"
  [ -n "$run_dir" ] || { echo "usage: local-db.sh down <run_dir>" >&2; exit 2; }
  local p
  for p in postgrest proxy; do
    [ -f "$run_dir/$p.pid" ] && { kill "$(cat "$run_dir/$p.pid")" 2>/dev/null || true; rm -f "$run_dir/$p.pid"; }
  done
  if [ -f "$run_dir/db.name" ] && [ -n "$PGBIN" ]; then
    psql_ -d postgres -c "drop database if exists $(cat "$run_dir/db.name") with (force)" >/dev/null 2>&1 || true
    rm -f "$run_dir/db.name"
  fi
  return 0
}

sandbox_ref() {   # one source of truth with the DB tooling (same lookup as provision-local-keys.sh)
  local line
  line=$(grep -E '^ENV_REFS' "$REPO/.claude/qa/shared/niete_training_db.py" 2>/dev/null | head -1)
  printf '%s' "$line" | sed -nE 's/.*"sandbox": "([a-z0-9]+)".*/\1/p'
}

baseline() {
  local out="${1:-$REPO/supabase/baseline/schema.sql}" url="${LOCAL_DB_BASELINE_URL:-}"
  if [ -z "$url" ]; then
    # -p names the project, so this works from any checkout (a worktree is not `railway link`ed).
    url=$(railway variables -p "${LOCAL_DB_RAILWAY_PROJECT:-NIETE-Rumi Staging}" -s bot --environment sandbox --kv 2>/dev/null \
      | sed -nE 's/^DATABASE_URL=(.*)$/\1/p' | tr -d '"') || true
  fi
  [ -n "$url" ] || { log "no source: set LOCAL_DB_BASELINE_URL or log in to railway (sandbox DATABASE_URL)"; exit 3; }
  local want ref
  want=$(sandbox_ref); [ -n "$want" ] || want="olvritwoqujtjvwfulbh"
  ref=$(printf '%s' "$url" | sed -nE 's#^postgres(ql)?://postgres\.([a-z0-9]+):.*#\2#p')
  [ -n "$ref" ] || ref=$(printf '%s' "$url" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
  if [ "$ref" != "$want" ]; then log "REFUSED: baseline source is project '${ref:-?}', not the sandbox ($want). Nothing written."; exit 3; fi
  local dump; dump="$(command -v pg_dump)"
  [ -x /opt/homebrew/opt/libpq/bin/pg_dump ] && dump=/opt/homebrew/opt/libpq/bin/pg_dump
  url=$(printf '%s' "$url" | sed -E 's#(pooler\.supabase\.com):6543#\1:5432#')   # session pooler: pg_dump needs a session
  mkdir -p "$(dirname "$out")"
  local tmp="$out.tmp.$$"
  {
    echo "-- NIETE sandbox schema baseline (project $want), schema only — no rows."
    echo "-- Regenerate: bash bot/scripts/e2e/local-db.sh baseline · dumped $(date -u +%Y-%m-%dT%H:%MZ)"
    "$dump" "$url" --schema-only --schema=public --no-owner --no-comments --no-publications --no-subscriptions \
      | grep -vE '^\\(un)?restrict ' \
      | grep -vE '^CREATE SCHEMA public;$|^COMMENT ON SCHEMA public '
  } > "$tmp" || { rm -f "$tmp"; log "pg_dump failed"; exit 3; }
  mv "$tmp" "$out"
  log "baseline: $(grep -c '^CREATE TABLE' "$out") tables, $(grep -c '^CREATE FUNCTION' "$out") functions → $out"
}

status() {
  [ -n "$PGBIN" ] || { echo "no Postgres 17"; return 1; }
  "$PGBIN/pg_ctl" -D "$PGDATA" status 2>&1 | head -1
  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && psql_ -d postgres -Atc "select datname from pg_database where datname like 'golden\_%' or datname like 'run\_%'"
}
stop() { [ -n "$PGBIN" ] && "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1; return 0; }

CMD="${1:-}"; shift || true
case "$CMD" in
  up) up "$@";; down) down "$@";; baseline) baseline "$@";; status) status;; stop) stop;;
  *) sed -n '2,7p' "$0" >&2; exit 2;;
esac
