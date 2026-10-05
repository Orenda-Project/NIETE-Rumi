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
SQL
echo "insert into public.items(label) values ('seeded');" > "$LOCAL_DB_SEED"

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
bash "$LDB" down "$r1" >/dev/null 2>&1
t "down exits 0" "$?" "0"

# ---- run 2: clean slate
r2="$tmp/run2"
bash "$LDB" up "$r2" >"$tmp/up2.log" 2>&1
t "AC2 run 2 up exits 0" "$?" "0"
got=$(client "$r2/db.env" "$JS_LABELS"); t "AC2 run 1's row is gone in run 2" "$got" "seeded"
bash "$LDB" down "$r2" >/dev/null 2>&1

# ---- AC3: baseline refuses a non-sandbox ref before it connects
out=$(LOCAL_DB_BASELINE_URL="postgresql://postgres.ihzciabopbttygxxgrkm:x@127.0.0.1:1/postgres" bash "$LDB" baseline "$tmp/never.sql" 2>&1); rc=$?
t "AC3 baseline refuses a non-sandbox ref (exit 3)" "$rc" "3"
t "AC3 nothing written" "$([ -e "$tmp/never.sql" ] && echo written || echo none)" "none"

bash "$LDB" stop >/dev/null 2>&1
rm -rf "$tmp_root"
echo; if [ "$fails" -eq 0 ]; then echo "local-db: all passed"; else echo "local-db: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
