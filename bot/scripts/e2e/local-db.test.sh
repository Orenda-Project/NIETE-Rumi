#!/usr/bin/env bash
# local-db.sh — the mock lane's per-run local database (bd-z3ze4).
#
# Hermetic: a small fixture schema (table + RLS policy on auth.uid() + an RPC + a vector column), never
# the real baseline, on throwaway ports and a throwaway LOCAL_DB_HOME. Proves:
#   AC1  `up` hands back a localhost SUPABASE_URL + service-role key that @supabase/supabase-js can
#        select / insert / rpc against.
#   AC2  every run starts clean: a row written in run 1 is absent in run 2.
#   AC3  `baseline` refuses any project ref but the sandbox one, before connecting.
# Needs: Postgres 17 (brew install postgresql@17 pgvector), postgrest, node + supabase-js.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LDB="$HERE/local-db.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

tmp_root="$(mktemp -d)"; tmp="$tmp_root/path with spaces"; mkdir -p "$tmp"   # the real repo lives under "Rumi 10 April 2026"
export LOCAL_DB_HOME="$tmp/home" LOCAL_DB_PG_PORT=55432 LOCAL_DB_REST_PORT=55433 E2E_SUPABASE_PORT=55434
export LOCAL_DB_SCHEMA="$tmp/schema.sql" LOCAL_DB_SEED="$tmp/seed.sql"
cat > "$LOCAL_DB_SCHEMA" <<'SQL'
create extension if not exists vector with schema extensions;
create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner uuid,
  label text not null,
  embedding extensions.vector(3)
);
alter table public.items enable row level security;
create policy items_owner on public.items using (owner = auth.uid());
grant all on public.items to service_role, authenticated;
create function public.count_items() returns integer language sql stable as $$ select count(*)::int from public.items $$;
grant execute on function public.count_items() to service_role;
-- reference content (pulled into the seed) vs a per-teacher table (never pulled)
create table public.catalog (id int primary key, title text not null);
create table public.private_notes (id int primary key, note text not null);
grant all on public.catalog, public.private_notes to service_role;
SQL
echo "insert into public.items(label) values ('seeded');" > "$LOCAL_DB_SEED"
export LOCAL_DB_SEED_TABLES="$tmp/seed-tables.txt"
printf '# reference tables only\ncatalog\n' > "$LOCAL_DB_SEED_TABLES"
PSQL17="$(ls -d /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin 2>/dev/null | head -1)/psql"

# Resolve supabase-js from the main checkout (worktrees carry no node_modules).
MAIN="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")"
export NODE_PATH="${NODE_PATH:-$MAIN/bot/node_modules:$MAIN/node_modules}"

client() {   # $1 = env file from `up`; $2 = js body using `sb`; prints the result (or NOENV / ERR …)
  [ -f "$1" ] || { echo NOENV; return; }
  ( set -a; . "$1"; set +a
    node -e "
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      (async () => { $2 })().catch(e => { console.log('ERR ' + (e.message || e)); });
    " 2>&1 )
}

# ---- run 1
r1="$tmp/run1"
bash "$LDB" up "$r1" >"$tmp/up1.log" 2>&1; rc=$?
t "AC1 up exits 0" "$rc" "0"
[ "$rc" -eq 0 ] || sed 's/^/      /' "$tmp/up1.log" | tail -15
env1="$r1/db.env"
url=$(sed -nE 's/^SUPABASE_URL=(.*)$/\1/p' "$env1" 2>/dev/null)
case "$url" in http://127.0.0.1:*) local_url=yes;; *) local_url="no ($url)";; esac
t "AC1 SUPABASE_URL is localhost" "$local_url" "yes"
# JS bodies live in variables: macOS bash 3.2 mis-parses quoted parens inside $( ).
JS_LABELS="const {data,error}=await sb.from('items').select('label').order('label'); console.log(error?('ERR '+error.message):data.map(r=>r.label).join(','))"
JS_INSERT="const {error}=await sb.from('items').insert({label:'run1-only', embedding:'[1,2,3]'}); console.log(error?('ERR '+error.message):'ok')"
JS_RPC="const {data,error}=await sb.rpc('count_items'); console.log(error?('ERR '+error.message):data)"
got=$(client "$env1" "$JS_LABELS"); t "AC1 select sees the seed" "$got" "seeded"
got=$(client "$env1" "$JS_INSERT"); t "AC1 insert as service_role (bypasses RLS)" "$got" "ok"
got=$(client "$env1" "$JS_RPC");    t "AC1 rpc" "$got" "2"
# The proxy records every table/RPC a run touches — the inventory the seed list is drafted from.
t "request log names the table read" "$(grep -c '^GET items$' "$r1/requests.log" 2>/dev/null)" "1"
t "request log names the table written" "$(grep -c '^POST items$' "$r1/requests.log" 2>/dev/null)" "1"
t "request log names the rpc" "$(grep -c '^POST rpc/count_items$' "$r1/requests.log" 2>/dev/null)" "1"

# ---- AC6–AC9: the seed snapshot. Run 1's database stands in for the sandbox (test-only seam).
db1=$(cat "$r1/db.name")
"$PSQL17" -X -q -h 127.0.0.1 -p "$LOCAL_DB_PG_PORT" -U postgres -d "$db1" \
  -c "insert into public.catalog values (1,'cat-1'),(2,'cat-2')" -c "insert into public.private_notes values (1,'a teacher wrote this')"
t "AC9 seed-status before any pull is missing" "$(bash "$LDB" seed-status 2>/dev/null)" "missing"
out=$(LOCAL_DB_SEED_SOURCE_URL="postgresql://postgres.ihzciabopbttygxxgrkm:x@127.0.0.1:1/postgres" bash "$LDB" seed-pull 2>&1); rc=$?
t "AC6 seed-pull refuses a non-sandbox ref (exit 3)" "$rc" "3"
t "AC6 nothing written" "$(ls "$LOCAL_DB_HOME/seed" 2>/dev/null | wc -l | tr -d ' ')" "0"
LOCAL_DB_SEED_SOURCE_URL="postgresql://postgres@127.0.0.1:$LOCAL_DB_PG_PORT/$db1" LOCAL_DB_TEST_LOCAL_SOURCE=1 \
  bash "$LDB" seed-pull >"$tmp/pull.log" 2>&1; rc=$?
t "AC7 seed-pull from the source exits 0" "$rc" "0"
[ "$rc" -eq 0 ] || tail -5 "$tmp/pull.log" | sed 's/^/      /'
t "AC7 manifest lists only the seed tables, with row counts" \
  "$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(",".join("%s=%s"%(k,v) for k,v in sorted(m["rows"].items())))' "$LOCAL_DB_HOME/seed/manifest.json" 2>/dev/null)" "catalog=2"
t "AC9 seed-status after a pull is ok" "$(bash "$LDB" seed-status 2>/dev/null)" "ok"
out=$(bash "$LDB" doctor 2>&1); rc=$?
t "doctor: a machine with the tools and a fresh seed lacks nothing" "$rc:$out" "0:"
bash "$LDB" down "$r1" >/dev/null 2>&1
t "down exits 0" "$?" "0"

# ---- run 2: clean slate
r2="$tmp/run2"
bash "$LDB" up "$r2" >"$tmp/up2.log" 2>&1
t "AC2 run 2 up exits 0" "$?" "0"
got=$(client "$r2/db.env" "$JS_LABELS"); t "AC2 run 1's row is gone in run 2" "$got" "seeded"
bash "$LDB" down "$r2" >/dev/null 2>&1

# ---- AC8: a run after the pull carries the reference rows and NONE of the per-teacher rows
JS_CATALOG="const {data,error}=await sb.from('catalog').select('title').order('id'); console.log(error?('ERR '+error.message):data.map(r=>r.title).join(','))"
JS_NOTES="const {data,error}=await sb.from('private_notes').select('id'); console.log(error?('ERR '+error.message):data.length)"
r3="$tmp/run3"
bash "$LDB" up "$r3" >"$tmp/up3.log" 2>&1
t "AC8 run 3 up exits 0" "$?" "0"
got=$(client "$r3/db.env" "$JS_CATALOG"); t "AC8 seeded reference rows are there" "$got" "cat-1,cat-2"
got=$(client "$r3/db.env" "$JS_NOTES");   t "AC8 per-teacher rows were never pulled" "$got" "0"
bash "$LDB" down "$r3" >/dev/null 2>&1
printf 'catalog\nprivate_notes\n' > "$LOCAL_DB_SEED_TABLES"
t "AC9 seed-status after the table list changes is stale" "$(bash "$LDB" seed-status 2>/dev/null)" "stale"
out=$(bash "$LDB" doctor 2>&1); rc=$?
t "doctor names the stale seed" "$rc:$out" "1:seed stale (local-db.sh seed-pull)"

# ---- AC3: baseline refuses a non-sandbox ref before it connects
out=$(LOCAL_DB_BASELINE_URL="postgresql://postgres.ihzciabopbttygxxgrkm:x@127.0.0.1:1/postgres" bash "$LDB" baseline "$tmp/never.sql" 2>&1); rc=$?
t "AC3 baseline refuses a non-sandbox ref (exit 3)" "$rc" "3"
t "AC3 nothing written" "$([ -e "$tmp/never.sql" ] && echo written || echo none)" "none"

bash "$LDB" stop >/dev/null 2>&1
rm -rf "$tmp_root"
echo; if [ "$fails" -eq 0 ]; then echo "local-db: all passed"; else echo "local-db: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
