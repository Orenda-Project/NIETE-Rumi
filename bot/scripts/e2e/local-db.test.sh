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
# The staging FILES a run reads (bd-z3ze4.5): a stand-in R2 (local-r2.js) plays staging's bucket for the pull.
export LOCAL_DB_SEED_FILES="$tmp/seed-files.txt"
printf '# fixture\nlp612/page-truth/g7.json\n' > "$LOCAL_DB_SEED_FILES"
R2UP_PORT=55479; mkdir -p "$tmp/r2up"
MAIN_NM="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")/bot/node_modules"
( NODE_PATH="$MAIN_NM" exec node "$HERE/local-r2.js" $R2UP_PORT "$tmp/r2up" ) >/dev/null 2>&1 & R2UP_PID=$!
for i in $(seq 1 25); do curl -sf "http://127.0.0.1:$R2UP_PORT/__health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -s -X PUT --data-binary '{"page":7}' -H 'content-type: application/json' "http://127.0.0.1:$R2UP_PORT/test-bucket/lp612/page-truth/g7.json" >/dev/null
export LOCAL_DB_SEED_R2_ENDPOINT="http://127.0.0.1:$R2UP_PORT" LOCAL_DB_SEED_R2_BUCKET=test-bucket LOCAL_DB_SEED_R2_KEY_ID=local LOCAL_DB_SEED_R2_SECRET=local
export LOCAL_DB_SEED_OVERRIDES="$tmp/seed-overrides.sql"; : > "$LOCAL_DB_SEED_OVERRIDES"   # hermetic: never the repo's file
# The fixture runs below run BEFORE any seed pull, on purpose; a real run without one is refused (AC11).
export LOCAL_DB_ALLOW_NO_SEED=1
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

# ---- AC11: no seed snapshot on this machine → `up` REFUSES rather than run every scenario on an empty
# database (training scored 21 pass there vs 59 seeded — silently). It names the fix and the opt-out.
out=$(LOCAL_DB_ALLOW_NO_SEED= bash "$LDB" up "$tmp/run0" 2>&1); rc=$?
t "AC11 up without a seed snapshot is refused (exit 9)" "$rc" "9"
case "$out" in *seed-pull*E2E_LOCAL_DB=0*|*E2E_LOCAL_DB=0*seed-pull*) n11=yes;; *) n11="no: $(printf '%s' "$out" | tail -1)";; esac
t "AC11 …naming seed-pull and the sandbox opt-out" "$n11" "yes"
t "AC11 …and no run database or env file was made" "$([ -e "$tmp/run0/db.env" ] && echo made || echo none)" "none"
bash "$LDB" down "$tmp/run0" >/dev/null 2>&1   # only matters if the refusal regressed: free the ports for run 1

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
# bd-z3ze4.6: the FULL query too — which reference ROWS a run reads is measured by replaying these.
t "query log keeps the filter and select, not just the table" "$(grep -c '^GET items?select=label' "$r1/queries.log" 2>/dev/null)" "1"

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
t "AC13 seed-pull also pulls the listed staging FILES into the base snapshot (bd-z3ze4.5)" \
  "$(cat "$LOCAL_DB_HOME/seed/files/test-bucket/lp612/page-truth/g7.json" 2>/dev/null)" '{"page":7}'
t "AC13 …and the manifest records them" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("files",{}).get("lp612/page-truth/g7.json"))' "$LOCAL_DB_HOME/seed/manifest.json" 2>/dev/null)" "10"

# ---- AC12 (bd-z3ze4.3): schema drift. Run 1's database plays the sandbox again.
SRC="postgresql://postgres@127.0.0.1:$LOCAL_DB_PG_PORT/$db1"
LOCAL_DB_BASELINE_URL="$SRC" LOCAL_DB_TEST_LOCAL_SOURCE=1 bash "$LDB" baseline "$tmp/base/schema.sql" >/dev/null 2>&1
t "AC12 baseline also writes the object list" "$(grep -c '^catalog.title:text$' "$tmp/base/schema.objects.txt" 2>/dev/null)" "1"
t "AC12 …functions are listed with their arguments" "$(grep -c '^fn:count_items()$' "$tmp/base/schema.objects.txt" 2>/dev/null)" "1"
t "AC12 …extension-owned functions are not (vector's are noise)" "$(grep -c '^fn:vector_' "$tmp/base/schema.objects.txt" 2>/dev/null)" "0"
out=$(LOCAL_DB_BASELINE_URL="$SRC" LOCAL_DB_TEST_LOCAL_SOURCE=1 bash "$LDB" drift "$tmp/base/schema.objects.txt" 2>&1); rc=$?
t "AC12 drift: an unchanged source is no drift (exit 0)" "$rc" "0"
"$PSQL17" -X -q -h 127.0.0.1 -p "$LOCAL_DB_PG_PORT" -U postgres -d "$db1" -c "alter table public.catalog add column extra int" \
  -c "create function public.newer_fn(n int) returns int language sql as \$\$ select n \$\$"
out=$(LOCAL_DB_BASELINE_URL="$SRC" LOCAL_DB_TEST_LOCAL_SOURCE=1 bash "$LDB" drift "$tmp/base/schema.objects.txt" 2>&1); rc=$?
t "AC12 drift: a new column/function on the source is drift (exit 10)" "$rc" "10"
case "$out" in *"+ catalog.extra:integer"*) d1=yes;; *) d1="no: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-120)";; esac
t "AC12 …naming the added column" "$d1" "yes"
case "$out" in *"+ fn:newer_fn(n integer)"*) d2=yes;; *) d2=no;; esac
t "AC12 …and the added function" "$d2" "yes"
case "$out" in *"local-db.sh baseline"*) d3=yes;; *) d3=no;; esac
t "AC12 …and the fix" "$d3" "yes"
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
# Lane overrides go on top of the snapshot (seed-overrides.sql: a global switch copied from the sandbox —
# app_redirect_* — must not decide what the lane tests). Changing the file rebuilds the golden.
echo "update public.catalog set title = title || '+o' where id = 2;" > "$LOCAL_DB_SEED_OVERRIDES"
r3="$tmp/run3"
bash "$LDB" up "$r3" >"$tmp/up3.log" 2>&1
t "AC8 run 3 up exits 0" "$?" "0"
got=$(client "$r3/db.env" "$JS_CATALOG"); t "AC8 seeded reference rows are there, with the lane overrides applied" "$got" "cat-1,cat-2+o"
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

# ---- AC10: parallel slots. Two `up`s at the SAME moment, on their own ports, while the golden must be
# (re)built (the schema changed): exactly one build, both runs come up, each on its own database.
echo "-- changed for the parallel case" >> "$LOCAL_DB_SCHEMA"
pa="$tmp/par-a"; pb="$tmp/par-b"
( E2E_SUPABASE_PORT=55440 LOCAL_DB_REST_PORT=55441 bash "$LDB" up "$pa" >"$tmp/par-a.log" 2>&1; echo $? > "$tmp/par-a.rc" ) & PA=$!
( E2E_SUPABASE_PORT=55450 LOCAL_DB_REST_PORT=55451 bash "$LDB" up "$pb" >"$tmp/par-b.log" 2>&1; echo $? > "$tmp/par-b.rc" ) & PB=$!
wait $PA $PB   # only these two: a bare `wait` would also wait on the stand-in R2 server, which never exits
t "AC10 slot A up exits 0" "$(cat "$tmp/par-a.rc")" "0"
t "AC10 slot B up exits 0" "$(cat "$tmp/par-b.rc")" "0"
[ "$(cat "$tmp/par-a.rc")" = 0 ] || tail -5 "$tmp/par-a.log" | sed 's/^/      /'
[ "$(cat "$tmp/par-b.rc")" = 0 ] || tail -5 "$tmp/par-b.log" | sed 's/^/      /'
t "AC10 the golden was built exactly once" "$(cat "$tmp/par-a.log" "$tmp/par-b.log" | grep -c 'built golden_')" "1"
t "AC10 each slot has its own database" "$([ "$(cat "$pa/db.name" 2>/dev/null)" != "$(cat "$pb/db.name" 2>/dev/null)" ] && [ -s "$pa/db.name" ] && echo distinct || echo same)" "distinct"
got=$(client "$pa/db.env" "$JS_INSERT"); t "AC10 slot A writes" "$got" "ok"
got=$(client "$pb/db.env" "$JS_LABELS"); t "AC10 slot B does not see slot A's row" "$got" "seeded"
bash "$LDB" down "$pa" >/dev/null 2>&1; bash "$LDB" down "$pb" >/dev/null 2>&1

kill $R2UP_PID 2>/dev/null
bash "$LDB" stop >/dev/null 2>&1
rm -rf "$tmp_root"
echo; if [ "$fails" -eq 0 ]; then echo "local-db: all passed"; else echo "local-db: $fails failed"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
