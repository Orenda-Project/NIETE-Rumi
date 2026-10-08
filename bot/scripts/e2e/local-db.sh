#!/usr/bin/env bash
# local-db.sh — a clean local database for every mock-lane run, instead of the shared sandbox Supabase (bd-z3ze4).
#
#   bash bot/scripts/e2e/local-db.sh up <run_dir>          # clone a fresh run database; writes <run_dir>/db.env
#   bash bot/scripts/e2e/local-db.sh down <run_dir>        # stop this run's PostgREST + proxy, drop its database
#   bash bot/scripts/e2e/local-db.sh baseline [out.sql]    # re-dump the sandbox schema (schema only, no rows)
#   bash bot/scripts/e2e/local-db.sh seed-pull             # install the small seed named by seed-release.txt (gh; no Railway)
#   bash bot/scripts/e2e/local-db.sh seed-pull --from-sandbox   # maintainers: the FULL reference rows from the sandbox
#   bash bot/scripts/e2e/local-db.sh seed-publish          # maintainers: trim to seed-keep.json, release it privately, write the pointer
#   bash bot/scripts/e2e/local-db.sh seed-status           # missing | stale | ok  (the readiness check reads it)
#   bash bot/scripts/e2e/local-db.sh doctor                # one line per thing this machine lacks; exit 0 iff none
#   bash bot/scripts/e2e/local-db.sh install-tools         # Linux: Postgres 17 + pgvector + gh via apt, PostgREST as a binary
#   bash bot/scripts/e2e/local-db.sh drift [objects.txt]   # does the live sandbox still match schema.sql? exit 10 if not
#   bash bot/scripts/e2e/local-db.sh status | stop          # the machine's cluster
#
# Three tiers, the same split the lane already uses for redis and node_modules:
#   once per machine   a Postgres 17 cluster under $LOCAL_DB_HOME, started on first use and left running
#                      (brew install postgresql@17 pgvector postgrest on a Mac; `install-tools` on Linux — no Docker).
#   once per schema    a GOLDEN database = bootstrap + schema + seed snapshot, named by the hash of all three.
#                      A changed baseline or a new snapshot builds a new one; an unchanged one is reused.
#
# The seed snapshot (seed-pull): rows of the tables named in supabase/baseline/seed-tables.txt — reference
# content only (lesson-plan and training catalogues, settings), never a per-teacher table. The LIST is
# committed; the DATA is not: each machine pulls its own into $LOCAL_DB_HOME/seed (part of it is the
# restricted ICT corpus). seed-status says `stale` when the committed list no longer matches the pull.
#   every run          CREATE DATABASE … TEMPLATE golden — a file-level copy, so every run starts from the
#                      same state and nothing a run writes survives it. Then PostgREST on that database and a
#                      proxy that adds the /rest/v1 prefix supabase-js expects.
#
# Safety: `up` only ever writes a 127.0.0.1 SUPABASE_URL; `baseline` refuses any project ref but the sandbox
# one before it connects (the same ENV_REFS the DB tooling asserts).
#
# Exit codes: 2 usage · 3 baseline/seed source is not the sandbox, or the pull failed · 4 no Postgres 17 / pgvector / postgrest ·
# 5 cluster failed to start · 6 golden build failed · 7 run database clone failed · 8 PostgREST/proxy not healthy ·
# 9 no seed snapshot on this machine (refused — a run on an empty database passes far less, silently).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
. "$HERE/portable.sh"

LOCAL_DB_HOME="${LOCAL_DB_HOME:-$HOME/.cache/niete-e2e-db}"
# Tools this script installs without root (PostgREST on Linux) live here, ahead of everything else.
export PATH="$LOCAL_DB_HOME/bin:$PATH"
POSTGREST_VERSION="${LOCAL_DB_POSTGREST_VERSION:-v16.4}"
# The PGDG apt-repo setup script that ships with postgresql-common (Debian/Ubuntu).
PGDG_SCRIPT="${LOCAL_DB_PGDG_SCRIPT:-/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh}"
PG_PORT="${LOCAL_DB_PG_PORT:-54329}"
REST_PORT="${LOCAL_DB_REST_PORT:-54330}"
API_PORT="${E2E_SUPABASE_PORT:-54321}"
SCHEMA="${LOCAL_DB_SCHEMA:-$REPO/supabase/baseline/schema.sql}"
SEED="${LOCAL_DB_SEED:-$REPO/supabase/baseline/seed.sql}"
SEED_TABLES="${LOCAL_DB_SEED_TABLES:-$REPO/supabase/baseline/seed-tables.txt}"
SEED_DIR="$LOCAL_DB_HOME/seed"
# Staging FILES the runs read (bd-z3ze4.4 measured 4, 0.3 MB): pulled with the seed into $SEED_DIR/files, which
# local-r2.js serves as its read-only BASE layer — so a run needs no staging credential and no network for them.
SEED_FILES="${LOCAL_DB_SEED_FILES:-$REPO/supabase/baseline/seed-files.txt}"
# The small seed (bd-z3ze4.7): the measured rows only, released as one asset on a PRIVATE GitHub repo. The public
# NIETE-Rumi repo commits just the POINTER (repo, tag, asset, sha256) and the keep-list of row ids, never content.
SEED_RELEASE="${LOCAL_DB_SEED_RELEASE:-$REPO/supabase/baseline/seed-release.txt}"
SEED_KEEP="${LOCAL_DB_SEED_KEEP:-$REPO/supabase/baseline/seed-keep.json}"
FIXTURES_REPO="${LOCAL_DB_FIXTURES_REPO:-Orenda-Project/niete-e2e-fixtures}"
SEED_ASSET="niete-e2e-seed.tar.gz"
GH="${LOCAL_DB_GH:-gh}"
# Applied on top of the snapshot: the lane's own state for GLOBAL switches the sandbox happens to have set
# (app_redirect_* was on there from 2026-10-01, which turned every lesson-plan scenario into a Play Store card).
SEED_OVERRIDES="${LOCAL_DB_SEED_OVERRIDES:-$REPO/supabase/baseline/seed-overrides.sql}"
BOOTSTRAP="$HERE/local-db-bootstrap.sql"
PGDATA="$LOCAL_DB_HOME/pg17"

log() { echo "[local-db] $*" >&2; }

pg_bin() {   # Postgres 17's bin dir: LOCAL_DB_PG_BIN, else Homebrew's keg or Debian's, else PATH if it is 17
  local d
  for d in "${LOCAL_DB_PG_BIN:-}" ${LOCAL_DB_PG_SEARCH:-/opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin}; do
    [ -n "$d" ] && [ -x "$d/postgres" ] && { echo "$d"; return 0; }
  done
  d="$(dirname "$(command -v postgres 2>/dev/null || echo /nonexistent/x)")"
  "$d/postgres" --version 2>/dev/null | grep -q ' 17\.' && { echo "$d"; return 0; }
  return 1
}
PGBIN="$(pg_bin)" || PGBIN=""
# How to get a missing tool on THIS machine: brew on a Mac, `install-tools` on Linux.
hint() {
  if [ "$(uname -s)" = Linux ]; then echo "bash bot/scripts/e2e/local-db.sh install-tools"; else echo "brew install $1"; fi
}
has_pgvector() { [ -n "$PGBIN" ] && [ -f "$("$PGBIN/pg_config" --sharedir)/extension/vector.control" ]; }
need_tools() {
  [ -n "$PGBIN" ] || { log "Postgres 17 not found — $(hint 'postgresql@17 pgvector')"; exit 4; }
  has_pgvector || { log "pgvector missing for Postgres 17 — $(hint pgvector)"; exit 4; }
  command -v postgrest >/dev/null 2>&1 || { log "postgrest not found — $(hint postgrest)"; exit 4; }
  command -v node >/dev/null 2>&1 || { log "node not found"; exit 4; }
}
psql_() { "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U postgres "$@"; }

# mkdir is atomic on every filesystem (no flock on macOS). A lock whose holder is gone is taken over.
SETUP_LOCK="$LOCAL_DB_HOME/.setup.lock"
setup_lock() {
  mkdir -p "$LOCAL_DB_HOME"
  local waited=0 holder
  until mkdir "$SETUP_LOCK" 2>/dev/null; do
    holder=$(cat "$SETUP_LOCK/pid" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then rm -rf "$SETUP_LOCK"; continue; fi
    [ "$waited" -ge 600 ] && { log "setup lock held by pid ${holder:-?} for 10 min — giving up ($SETUP_LOCK)"; exit 6; }
    sleep 1; waited=$((waited + 1))
  done
  echo $$ > "$SETUP_LOCK/pid"
  trap 'rm -rf "$SETUP_LOCK"' EXIT   # an exit mid-build (exit 5/6) must not leave the lock behind
}
setup_unlock() { rm -rf "$SETUP_LOCK"; trap - EXIT; }

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

# Roles are cluster-wide and never in a schema dump. Any role the schema grants to, or names in a policy
# (portal_app_user, …), gets a NOLOGIN stand-in so the GRANT/POLICY applies; nothing can log in as it.
ensure_schema_roles() {
  local role
  for role in $(grep -hE '^(GRANT|REVOKE|CREATE POLICY|ALTER DEFAULT PRIVILEGES)' "$SCHEMA" \
                | grep -oE '\b(TO|FROM|FOR ROLE) [a-z_][a-z0-9_, ]*' | sed -E 's/^(TO|FROM|FOR ROLE) //' | tr ',' '\n' \
                | tr -d ' ;' | grep -vE '^(public|current_user|session_user|anon|authenticated|service_role|authenticator)$' | sort -u); do
    # (the four API roles are local-db-bootstrap.sql's: a bare stand-in here would lack BYPASSRLS / LOGIN)
    psql_ -d postgres -c "do \$\$ begin if not exists (select from pg_roles where rolname='$role') then create role \"$role\" nologin; end if; end \$\$" >/dev/null || return 1
  done
}

golden_name() {   # golden_<12 hex of bootstrap + schema + seed>
  local h
  h=$(cat "$BOOTSTRAP" "$SCHEMA" "$([ -f "$SEED" ] && echo "$SEED" || echo /dev/null)" \
        "$([ -f "$SEED_DIR/manifest.json" ] && echo "$SEED_DIR/manifest.json" || echo /dev/null)" \
        "$([ -f "$SEED_OVERRIDES" ] && echo "$SEED_OVERRIDES" || echo /dev/null)" | sha256_of | cut -c1-12)
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
  ensure_schema_roles || exit 6
  local f files=("$BOOTSTRAP" "$SCHEMA")
  [ -f "$SEED" ] && files+=("$SEED")
  for f in "${files[@]}"; do
    psql_ -d "$tmpdb" -f "$f" >"$LOCAL_DB_HOME/golden.log" 2>&1 || { log "golden build failed applying $f:"; tail -5 "$LOCAL_DB_HOME/golden.log" >&2; exit 6; }
  done
  if [ -f "$SEED_DIR/seed.dump" ]; then
    # Data only, triggers off: the snapshot is a subset of tables, so a foreign key into a table it does not
    # carry (a catalogue row's author, say) must not reject the row. postgres is superuser here.
    "$(dump_bin)/pg_restore" --data-only --disable-triggers --no-owner -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$tmpdb" \
      "$SEED_DIR/seed.dump" >>"$LOCAL_DB_HOME/golden.log" 2>&1 || { log "golden build failed restoring the seed snapshot:"; tail -5 "$LOCAL_DB_HOME/golden.log" >&2; exit 6; }
  fi
  if [ -f "$SEED_OVERRIDES" ]; then
    psql_ -d "$tmpdb" -f "$SEED_OVERRIDES" >>"$LOCAL_DB_HOME/golden.log" 2>&1 || { log "golden build failed applying $SEED_OVERRIDES:"; tail -5 "$LOCAL_DB_HOME/golden.log" >&2; exit 6; }
  fi
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
  # No seed snapshot = every scenario would run on an EMPTY database (training: 21 pass instead of 59) and look
  # like a regression. Refuse and say how to fix it; the readiness check / run-suite.sh pull it automatically.
  case "$(seed_status)" in
    missing) [ "${LOCAL_DB_ALLOW_NO_SEED:-}" = 1 ] || {
      log "no seed snapshot on this machine — refusing to run on an empty database."
      log "  fix: bash bot/scripts/e2e/local-db.sh seed-pull   (needs \`railway login\`; run-suite.sh / commit-e2e.sh do it for you)"
      log "  or run this once on the shared sandbox instead: E2E_LOCAL_DB=0"
      exit 9; } ;;
    stale) log "warning: the seed snapshot predates the committed table list — run: bash bot/scripts/e2e/local-db.sh seed-pull" ;;
  esac
  # Parallel slots share ONE cluster: starting it and building the golden happen under one lock, so two
  # slots never both initdb, both pg_ctl start, or both build golden_<hash> (run-suite.sh --parallel).
  setup_lock
  cluster_up
  local g; g=$(golden_name); golden_ensure "$g"
  setup_unlock
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
  ( LOCAL_DB_REQUEST_LOG="$run_dir/requests.log" LOCAL_DB_QUERY_LOG="$run_dir/queries.log" exec node "$HERE/local-db-proxy.js" "$API_PORT" "$REST_PORT" ) >"$run_dir/proxy.log" 2>&1 &
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

dump_bin() {   # pg_dump/pg_restore at least as new as the sandbox's Postgres 17: libpq's (18) when present
  local d
  for d in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin "$PGBIN"; do
    [ -n "$d" ] && [ -x "$d/pg_dump" ] && [ -x "$d/pg_restore" ] && { echo "$d"; return 0; }
  done
  dirname "$(command -v pg_dump)"
}

# The sandbox's Postgres URL, asserted to BE the sandbox before anything connects. $1 = an explicit URL
# (an env override), else the Railway sandbox environment's DATABASE_URL. Prints it (session pooler port);
# exits 3 for any other project. LOCAL_DB_TEST_LOCAL_SOURCE=1 also admits a 127.0.0.1 URL — the tests' seam.
sandbox_source() {
  local url="${1:-}" what="$2"
  if [ -z "$url" ]; then
    # -p names the project, so this works from any checkout (a worktree is not `railway link`ed).
    url=$(railway variables -p "${LOCAL_DB_RAILWAY_PROJECT:-NIETE-Rumi Staging}" -s bot --environment sandbox --kv 2>/dev/null \
      | sed -nE 's/^DATABASE_URL=(.*)$/\1/p' | tr -d '"') || true
  fi
  [ -n "$url" ] || { log "no $what source: log in to railway (the sandbox DATABASE_URL) — railway login"; exit 3; }
  if [ "${LOCAL_DB_TEST_LOCAL_SOURCE:-}" = 1 ] && printf '%s' "$url" | grep -qE '^postgres(ql)?://[^@]*@127\.0\.0\.1:'; then
    printf '%s' "$url"; return 0
  fi
  local want ref
  want=$(sandbox_ref); [ -n "$want" ] || want="olvritwoqujtjvwfulbh"
  ref=$(printf '%s' "$url" | sed -nE 's#^postgres(ql)?://postgres\.([a-z0-9]+):.*#\2#p')
  [ -n "$ref" ] || ref=$(printf '%s' "$url" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
  if [ "$ref" != "$want" ]; then log "REFUSED: $what source is project '${ref:-?}', not the sandbox ($want). Nothing written."; exit 3; fi
  printf '%s' "$url" | sed -E 's#(pooler\.supabase\.com):6543#\1:5432#'   # session pooler: pg_dump needs a session
}

# Every column and function in public, one sorted line each — what drift compares. Extension-owned functions
# (btree_gist in public) are excluded: they come from CREATE EXTENSION, not from the app's schema.
OBJECTS_SQL="select c.table_name||'.'||c.column_name||':'||c.data_type from information_schema.columns c
  join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
  where c.table_schema='public' and t.table_type in ('BASE TABLE','VIEW')
union all
select 'fn:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
order by 1"
schema_objects() { "$(dump_bin)/psql" "$1" -X -At -c "$OBJECTS_SQL"; }

drift() {
  local objs="${1:-$(dirname "$SCHEMA")/schema.objects.txt}"
  [ -f "$objs" ] || { log "no $objs — run: bash bot/scripts/e2e/local-db.sh baseline"; exit 2; }
  local url; url=$(sandbox_source "${LOCAL_DB_BASELINE_URL:-}" drift) || exit 3
  local live; live=$(schema_objects "$url") || { log "could not read the live schema"; exit 3; }
  local diffs; diffs=$(diff <(grep -v '^#' "$objs") <(printf '%s\n' "$live") | sed -nE 's/^> /+ /p; s/^< /- /p')
  if [ -z "$diffs" ]; then log "no drift: the live sandbox matches $(basename "$objs")"; return 0; fi
  echo "schema drift — the live sandbox differs from the committed baseline (+ only on the sandbox, - only in the baseline):"
  printf '%s\n' "$diffs"
  echo "fix: bash bot/scripts/e2e/local-db.sh baseline   (then commit supabase/baseline/schema.sql + schema.objects.txt)"
  return 10
}

seed_tables() { grep -vE '^[[:space:]]*(#|$)' "$SEED_TABLES" 2>/dev/null | tr -d ' \t\r' | sort -u; }
seed_files() { grep -vE '^[[:space:]]*(#|$)' "$SEED_FILES" 2>/dev/null | tr -d ' \t\r' | sort -u; }
seed_tables_sha() { { seed_tables; echo '--files--'; seed_files; } | sha256_of | cut -c1-16; }

# Node modules for the S3 client: this checkout's, else the main checkout's (a worktree has none of its own).
node_path() {
  local main; main="$(dirname "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$REPO/.git")")"
  printf '%s' "$REPO/bot/node_modules:$REPO/node_modules:$main/bot/node_modules:$main/node_modules"
}

# Staging R2 read credentials, at SEED time only (never during a run): LOCAL_DB_SEED_R2_*, else the keys file's
# R2_*, else the Railway staging environment. Prints four lines endpoint/bucket/id/secret, or nothing.
seed_r2_creds() {
  if [ -n "${LOCAL_DB_SEED_R2_ENDPOINT:-}" ]; then
    printf '%s\n' "$LOCAL_DB_SEED_R2_ENDPOINT" "${LOCAL_DB_SEED_R2_BUCKET:-}" "${LOCAL_DB_SEED_R2_KEY_ID:-}" "${LOCAL_DB_SEED_R2_SECRET:-}"; return 0
  fi
  local main kf kv=""
  main="$(dirname "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$REPO/.git")")"
  for kf in "$main/keys/niete-local.env" "$(dirname "$main")/keys/niete-local.env"; do [ -f "$kf" ] && { kv=$(cat "$kf"); break; }; done
  [ -n "$kv" ] || kv=$(railway variables -p "${LOCAL_DB_RAILWAY_PROJECT:-NIETE-Rumi Staging}" -s bot --environment staging --kv 2>/dev/null || true)
  local k; for k in R2_ENDPOINT R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
    printf '%s\n' "$(printf '%s\n' "$kv" | sed -nE "s/^$k=(.*)$/\\1/p" | head -1 | tr -d "\"'")"
  done
}

ptr() { sed -nE "s/^$1=//p" "$SEED_RELEASE" 2>/dev/null | head -1; }

# Install the small seed the committed pointer names: download the private release asset with gh, verify its
# sha256 against the pointer, unpack. No Railway, no sandbox, no staging — only access to the fixtures repo.
seed_pull_release() {
  local repo tag asset sha; repo=$(ptr repo); tag=$(ptr tag); asset=$(ptr asset); sha=$(ptr sha256)
  [ -n "$repo" ] && [ -n "$tag" ] && [ -n "$asset" ] && [ -n "$sha" ] || { log "incomplete pointer $SEED_RELEASE (repo/tag/asset/sha256)"; exit 2; }
  command -v "$GH" >/dev/null 2>&1 || [ -x "$GH" ] || { log "gh not found — brew install gh, then gh auth login (needs access to $repo)"; exit 3; }
  mkdir -p "$SEED_DIR"
  local tmp="$SEED_DIR/.pull.$$" t0=$SECONDS; rm -rf "$tmp"; mkdir -p "$tmp/x"
  "$GH" release download "$tag" -R "$repo" -p "$asset" -D "$tmp" >"$tmp/gh.log" 2>&1 \
    || { log "could not download $asset from $repo release $tag: $(tail -1 "$tmp/gh.log") — gh auth login with access to $repo"; rm -rf "$tmp"; exit 3; }
  local got; got=$(sha256_of "$tmp/$asset" | cut -c1-64)
  [ "$got" = "$sha" ] || { log "REFUSED: $asset sha256 $got does not match the pointer's $sha — nothing installed"; rm -rf "$tmp"; exit 3; }
  tar -xzf "$tmp/$asset" -C "$tmp/x" || { log "could not unpack $asset"; rm -rf "$tmp"; exit 3; }
  [ -f "$tmp/x/seed.dump" ] && [ -f "$tmp/x/manifest.json" ] || { log "$asset lacks seed.dump/manifest.json"; rm -rf "$tmp"; exit 3; }
  python3 - "$tmp/x/manifest.json" "$tag" <<'MANIFEST'
import json, sys
p, tag = sys.argv[1:]; m = json.load(open(p)); m["release"] = tag; json.dump(m, open(p, "w"), indent=1)
MANIFEST
  rm -rf "$SEED_DIR/seed.dump" "$SEED_DIR/manifest.json" "$SEED_DIR/files"
  mv "$tmp/x/seed.dump" "$SEED_DIR/seed.dump" && mv "$tmp/x/manifest.json" "$SEED_DIR/manifest.json"
  [ -d "$tmp/x/files" ] && mv "$tmp/x/files" "$SEED_DIR/files"
  chmod 600 "$SEED_DIR/seed.dump"; rm -rf "$tmp"
  log "seed: release $tag from $repo ($(du -h "$SEED_DIR/seed.dump" | cut -f1)) in $((SECONDS - t0))s → $SEED_DIR"
}

seed_pull() {
  if [ "${1:-}" != "--from-sandbox" ] && [ -f "$SEED_RELEASE" ]; then
    # Parallel slots on a fresh machine all reach this at once: one pulls, the rest wait and find it done.
    setup_lock
    if [ "$(seed_status)" = ok ]; then setup_unlock; log "seed: already current (another run pulled it)"; return 0; fi
    seed_pull_release; setup_unlock; return
  fi
  [ -f "$SEED_TABLES" ] || { log "no seed table list at $SEED_TABLES"; exit 2; }
  local url; url=$(sandbox_source "${LOCAL_DB_SEED_SOURCE_URL:-}" seed) || exit 3
  local bin; bin=$(dump_bin)
  local tables; tables=$(seed_tables)
  [ -n "$tables" ] || { log "the seed table list is empty"; exit 2; }
  mkdir -p "$SEED_DIR"
  local tmp="$SEED_DIR/.pull.$$" t0=$SECONDS args=() t
  mkdir -p "$tmp"
  for t in $tables; do args+=(-t "public.$t"); done
  log "pulling $(echo "$tables" | wc -l | tr -d ' ') reference tables from the sandbox (data only)…"
  "$bin/pg_dump" "$url" --data-only --format=custom --no-owner "${args[@]}" -f "$tmp/seed.dump" 2>"$tmp/pull.err" \
    || { log "pg_dump failed: $(tail -2 "$tmp/pull.err")"; rm -rf "$tmp"; exit 3; }
  # Row counts, for the manifest and for anyone checking what a machine actually holds.
  local counts=""
  for t in $tables; do
    counts="$counts$t=$("$bin/psql" "$url" -X -Atc "select count(*) from public.\"$t\"" 2>/dev/null || echo '?')"$'\n'
  done
  # The staging files the runs read, into $tmp/files/<bucket>/<key>; their sizes go in the manifest.
  local files_json="{}" flist; flist=$(seed_files)
  if [ -n "$flist" ]; then
    local creds; creds=$(seed_r2_creds)
    local ep bk id sc; ep=$(sed -n 1p <<<"$creds"); bk=$(sed -n 2p <<<"$creds"); id=$(sed -n 3p <<<"$creds"); sc=$(sed -n 4p <<<"$creds")
    [ -n "$ep" ] && [ -n "$bk" ] || { log "seed files listed but no R2 read credentials (railway login, or keys/niete-local.env)"; rm -rf "$tmp"; exit 3; }
    files_json=$(printf '%s\n' "$flist" | R2E="$ep" R2B="$bk" R2I="$id" R2S="$sc" OUT="$tmp/files" NODE_PATH="$(node_path)" node -e '
      const fs = require("fs"), path = require("path"); const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
      const e = process.env; const s3 = new S3Client({ region: "auto", endpoint: e.R2E, credentials: { accessKeyId: e.R2I, secretAccessKey: e.R2S } });
      const keys = fs.readFileSync(0, "utf8").split("\n").filter(Boolean); const out = {};
      (async () => { for (const k of keys) {
        const r = await s3.send(new GetObjectCommand({ Bucket: e.R2B, Key: k })); const b = Buffer.from(await r.Body.transformToByteArray());
        const f = path.join(e.OUT, e.R2B, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); out[k] = b.length;
      } process.stdout.write(JSON.stringify(out)); })().catch((x) => { console.error("seed files: " + x.name + " " + x.message); process.exit(1); });') \
      || { log "pulling the seed files failed"; rm -rf "$tmp"; exit 3; }
  fi
  PULL_FILES="$files_json" PULL_COUNTS="$counts" python3 - "$tmp/manifest.json" "$(seed_tables_sha)" "$(sandbox_ref)" "$(sha256_of "$tmp/seed.dump" | cut -c1-16)" <<'MANIFEST'
import json, os, sys, datetime
out, tsha, ref, dsha = sys.argv[1:]
rows = {}
for line in os.environ["PULL_COUNTS"].splitlines():
    if "=" in line:
        k, v = line.split("=", 1); rows[k] = int(v) if v.isdigit() else v
json.dump({"source": "sandbox:" + ref, "pulled_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
           "tables_sha": tsha, "dump_sha": dsha, "rows": rows,
           "files": json.loads(os.environ.get("PULL_FILES") or "{}")}, open(out, "w"), indent=1)
MANIFEST
  rm -rf "$SEED_DIR/seed.dump" "$SEED_DIR/manifest.json" "$SEED_DIR/files"
  mv "$tmp/seed.dump" "$SEED_DIR/seed.dump" && mv "$tmp/manifest.json" "$SEED_DIR/manifest.json"
  [ -d "$tmp/files" ] && mv "$tmp/files" "$SEED_DIR/files"
  chmod 600 "$SEED_DIR/seed.dump"
  rm -rf "$tmp"
  log "seed: $(du -h "$SEED_DIR/seed.dump" | cut -f1) in $((SECONDS - t0))s → $SEED_DIR (the next up rebuilds the golden)"
}

doctor() {   # what this machine lacks for `up`, one line each — e2e_mock_lane_ready / autofix read it
  local rc=0 s
  if [ -z "$PGBIN" ]; then echo "postgres17 missing ($(hint postgresql@17))"; rc=1
  elif ! has_pgvector; then echo "pgvector missing ($(hint pgvector))"; rc=1; fi
  command -v postgrest >/dev/null 2>&1 || { echo "postgrest missing ($(hint postgrest))"; rc=1; }
  s=$(seed_status); [ "$s" = ok ] || { echo "seed $s (local-db.sh seed-pull)"; rc=1; }
  return $rc
}

# Maintainers: from the FULL seed on this machine (seed-pull --from-sandbox), keep every row of every seed table
# except the tables seed-keep.json names, which are trimmed to the listed primary keys (the rows the tests read,
# measured with seed-rows-used.js). Package it with the staging files, release it on the PRIVATE fixtures repo,
# and write the pointer for NIETE-Rumi to commit.
seed_publish() {
  need_tools
  [ -f "$SEED_DIR/seed.dump" ] && [ -f "$SEED_DIR/manifest.json" ] || { log "no seed here — run: local-db.sh seed-pull --from-sandbox"; exit 2; }
  [ -f "$SEED_KEEP" ] || { log "no keep-list at $SEED_KEEP"; exit 2; }
  command -v "$GH" >/dev/null 2>&1 || [ -x "$GH" ] || { log "gh not found"; exit 3; }
  setup_lock; cluster_up; setup_unlock
  local db="publish_$$" out="$SEED_DIR/.publish.$$" bin; bin=$(dump_bin)
  rm -rf "$out"; mkdir -p "$out/pkg"
  psql_ -d postgres -c "create database $db" >/dev/null || exit 6
  ensure_schema_roles || exit 6
  { psql_ -d "$db" -f "$BOOTSTRAP" && psql_ -d "$db" -f "$SCHEMA"; } >"$out/build.log" 2>&1 || { log "publish: schema failed — $out/build.log"; exit 6; }
  "$bin/pg_restore" --data-only --disable-triggers --no-owner -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$db" "$SEED_DIR/seed.dump" >>"$out/build.log" 2>&1 \
    || { log "publish: restoring the full seed failed — $out/build.log"; exit 6; }
  # trim: delete every row of a kept table whose primary key is not on the list (plain SQL, one DELETE per table)
  local pkmap; pkmap=$(psql_ -d "$db" -At -F'|' -c "select c.relname, string_agg(a.attname, ',' order by array_position(i.indkey::int2[], a.attnum))
      from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
     where i.indisprimary and n.nspname='public' group by c.relname")
  PKMAP="$pkmap" python3 - "$SEED_KEEP" > "$out/trim.sql" <<'TRIM' || { log "publish: bad keep-list"; exit 2; }
import json, os, sys
pk = dict(l.split("|", 1) for l in os.environ["PKMAP"].splitlines() if "|" in l)
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
for table, rows in json.load(open(sys.argv[1])).items():
    if table.startswith("_"): continue
    cols = pk[table].split(",")
    if not rows:
        print(f'delete from public."{table}";'); continue
    key = "(" + ", ".join(f'"{c}"::text' for c in cols) + ")" if len(cols) > 1 else f'"{cols[0]}"::text'
    vals = ", ".join("(" + ", ".join(lit(v) for v in r) + ")" if len(cols) > 1 else lit(r[0]) for r in rows)
    print(f'delete from public."{table}" where {key} not in ({vals});')
TRIM
  psql_ -d "$db" -f "$out/trim.sql" >>"$out/build.log" 2>&1 || { log "publish: trimming failed — $out/build.log"; exit 6; }
  local args=() t; for t in $(seed_tables); do args+=(-t "public.$t"); done
  "$bin/pg_dump" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$db" --data-only --format=custom --no-owner "${args[@]}" -f "$out/pkg/seed.dump" \
    || { log "publish: dump failed"; exit 6; }
  [ -d "$SEED_DIR/files" ] && cp -R "$SEED_DIR/files" "$out/pkg/files"
  local counts=""; for t in $(seed_tables); do counts="$counts$t=$(psql_ -d "$db" -Atc "select count(*) from public.\"$t\"")"$'\n'; done
  PUB_COUNTS="$counts" python3 - "$SEED_DIR/manifest.json" "$out/pkg/manifest.json" "$SEED_KEEP" <<'MANIFEST'
import json, os, sys, datetime, hashlib
src, dst, keep = sys.argv[1:]
m = json.load(open(src))
rows = {k: int(v) for k, v in (l.split("=", 1) for l in os.environ["PUB_COUNTS"].splitlines() if "=" in l)}
json.dump({"source": m.get("source"), "pulled_at": m.get("pulled_at"), "tables_sha": m.get("tables_sha"),
           "published_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "rows": rows,
           "files": m.get("files", {}), "trimmed": sorted(k for k in json.load(open(keep)) if not k.startswith("_")),
           "keep_sha": hashlib.sha256(open(keep, "rb").read()).hexdigest()[:16]}, open(dst, "w"), indent=1)
MANIFEST
  psql_ -d postgres -c "drop database if exists $db with (force)" >/dev/null 2>&1
  tar -czf "$out/$SEED_ASSET" -C "$out/pkg" . || { log "publish: tar failed"; exit 6; }
  local sha tag; sha=$(sha256_of "$out/$SEED_ASSET" | cut -c1-64); tag="seed-$(date -u +%Y%m%d-%H%M%S)"
  "$GH" release create "$tag" -R "$FIXTURES_REPO" "$out/$SEED_ASSET" --title "$tag" \
    --notes "NIETE mock-lane seed (measured rows only, restricted content — keep private). sha256 $sha" >"$out/gh.log" 2>&1 \
    || { log "publish: gh release create failed: $(tail -1 "$out/gh.log")"; exit 3; }
  { echo "# The small seed of the mock lane's local database (bd-z3ze4.7). The CONTENT is a private release asset;"
    echo "# this file only names it. Operators' machines download it with gh when this file changes — no Railway."
    echo "repo=$FIXTURES_REPO"; echo "tag=$tag"; echo "asset=$SEED_ASSET"; echo "sha256=$sha"; } > "$SEED_RELEASE"
  log "published $tag on $FIXTURES_REPO ($(du -h "$out/$SEED_ASSET" | cut -f1), sha256 ${sha:0:16}…) → commit $SEED_RELEASE"
  rm -rf "$out"
}

seed_status() {   # missing | stale | ok
  { [ -f "$SEED_DIR/manifest.json" ] && [ -f "$SEED_DIR/seed.dump" ]; } || { echo missing; return 0; }
  if [ -f "$SEED_RELEASE" ]; then   # the pointer decides: the installed release must be the one it names
    local rel; rel=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("release",""))' "$SEED_DIR/manifest.json" 2>/dev/null)
    if [ -n "$rel" ] && [ "$rel" = "$(ptr tag)" ]; then echo ok; else echo stale; fi
    return 0
  fi
  local have; have=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tables_sha",""))' "$SEED_DIR/manifest.json" 2>/dev/null)
  if [ "$have" = "$(seed_tables_sha)" ]; then echo ok; else echo stale; fi
}

baseline() {
  local out="${1:-$REPO/supabase/baseline/schema.sql}"
  local url; url=$(sandbox_source "${LOCAL_DB_BASELINE_URL:-}" baseline) || exit 3
  local want; want=$(sandbox_ref); [ -n "$want" ] || want="olvritwoqujtjvwfulbh"
  local dump; dump="$(dump_bin)/pg_dump"
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
  local objs; objs="$(dirname "$out")/schema.objects.txt"
  { echo "# every public column + function in the sandbox schema, from local-db.sh baseline — what local-db.sh drift compares"
    schema_objects "$url"; } > "$objs.tmp.$$" && mv "$objs.tmp.$$" "$objs"
  log "baseline: $(grep -c '^CREATE TABLE' "$out") tables, $(grep -c '^CREATE FUNCTION' "$out") functions → $out (+ $(basename "$objs"))"
}

status() {
  [ -n "$PGBIN" ] || { echo "no Postgres 17"; return 1; }
  "$PGBIN/pg_ctl" -D "$PGDATA" status 2>&1 | head -1
  "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 && psql_ -d postgres -Atc "select datname from pg_database where datname like 'golden\_%' or datname like 'run\_%'"
}
# install-tools — the Linux counterpart of `brew install postgresql@17 pgvector postgrest gh` (bd-z3ze4.8).
# PostgREST is one static binary from its GitHub release, into $LOCAL_DB_HOME/bin: no root. Postgres 17 + pgvector
# (from the PGDG apt repo, which carries 17 on every supported Ubuntu/Debian) and gh need root, so they install
# only when this already runs as root, sudo works WITHOUT a password, or a person is at the terminal (stdin is a
# tty, so sudo may ask). From a hook or an agent there is no tty: it never prompts, and prints the commands instead. Prints one "installed …" line per thing it installed;
# exit 0 iff nothing is still missing.
install_tools() {
  [ "$(uname -s)" = Linux ] || { log "install-tools is for Linux; on a Mac: brew install postgresql@17 pgvector postgrest gh"; return 4; }
  local rc=0 as_root="" arch tmp manual=""
  if [ "$(id -u)" = 0 ]; then as_root="env"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then as_root="sudo -n"
  elif command -v sudo >/dev/null 2>&1 && [ -t 0 ]; then as_root="sudo"; fi

  if ! command -v postgrest >/dev/null 2>&1; then
    case "$(uname -m)" in x86_64|amd64) arch=x86-64;; aarch64|arm64) arch=aarch64;; *) arch="";; esac
    if [ -z "$arch" ]; then echo "postgrest: no Linux build for $(uname -m)"; rc=1
    else
      tmp=$(mktemp -d)
      local asset="postgrest-$POSTGREST_VERSION-linux-static-$arch.tar.xz"
      if curl -fsSL -o "$tmp/$asset" "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/$asset" \
         && tar -xJf "$tmp/$asset" -C "$tmp" && [ -f "$tmp/postgrest" ]; then
        mkdir -p "$LOCAL_DB_HOME/bin" && mv "$tmp/postgrest" "$LOCAL_DB_HOME/bin/postgrest" && chmod 755 "$LOCAL_DB_HOME/bin/postgrest"
        echo "installed postgrest $POSTGREST_VERSION → $LOCAL_DB_HOME/bin"
      else echo "postgrest download failed ($asset)"; rc=1; fi
      rm -rf "$tmp"
    fi
  fi

  if [ -z "$PGBIN" ] || ! has_pgvector; then
    if [ -n "$as_root" ] && command -v apt-get >/dev/null 2>&1 \
       && $as_root apt-get install -y postgresql-common >/dev/null 2>&1 \
       && $as_root "$PGDG_SCRIPT" -y >/dev/null 2>&1 \
       && $as_root apt-get install -y postgresql-17 postgresql-17-pgvector >/dev/null 2>&1; then
      PGBIN="$(pg_bin)" || PGBIN=""
      echo "installed postgresql-17 + pgvector via apt (PGDG)"
    else
      manual="sudo apt-get install -y postgresql-common && sudo $PGDG_SCRIPT -y && sudo apt-get install -y postgresql-17 postgresql-17-pgvector"
    fi
    if ! { [ -n "$PGBIN" ] && has_pgvector; }; then
      if [ -n "$manual" ]; then echo "postgres17 + pgvector missing — run once: $manual"
      else echo "postgres17 + pgvector installed by apt but not found in /usr/lib/postgresql/17/bin (set LOCAL_DB_PG_BIN)"; fi
      rc=1
    fi
  fi

  if [ -f "$SEED_RELEASE" ] && ! command -v "$GH" >/dev/null 2>&1; then
    if [ -n "$as_root" ] && command -v apt-get >/dev/null 2>&1 && $as_root apt-get install -y gh >/dev/null 2>&1; then
      echo "installed gh via apt (then: gh auth login, once)"
    else echo "gh missing — run once: sudo apt-get install -y gh && gh auth login"; rc=1; fi
  fi
  return $rc
}

stop() { [ -n "$PGBIN" ] && "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1; return 0; }

CMD="${1:-}"; shift || true
case "$CMD" in
  up) up "$@";; down) down "$@";; baseline) baseline "$@";; status) status;; stop) stop;;
  seed-pull) seed_pull "$@";; seed-publish) seed_publish;; seed-status) seed_status;; doctor) doctor;; install-tools) install_tools;; drift) drift "$@";;
  *) sed -n '2,15p' "$0" >&2; exit 2;;
esac
