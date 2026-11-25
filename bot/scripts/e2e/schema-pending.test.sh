#!/usr/bin/env bash
# schema-pending.test.sh — the mock lane's local database carries every migration in the repo, not only those the
# committed sandbox copy has (bd-5b3u70.6).
#
#   bash bot/scripts/e2e/schema-pending.test.sh
#
# WHY. The local schema is a committed dump of the sandbox (supabase/baseline/schema.sql), refreshed by hand with a
# sandbox credential. A migration merged after the last dump was missing from every operator's local database until a
# maintainer re-dumped (on 25 Nov, V1.10.10 and V1.10.11 were newer than the 23 Nov dump). Now `baseline` stamps the
# migration files the dump already has (schema.migrations.txt), and the golden build applies every newer one on top,
# each in its own transaction: one that fails is skipped with a warning, never the whole run.
#
# Hermetic: a throwaway repo (a space in its path, like the real one) with copies of the scripts and a tiny schema,
# its own LOCAL_DB_HOME and cluster port. Needs Postgres 17 + pgvector; skips without them.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F=0; ok(){ printf '  ok    %s\n' "$1"; }; bad(){ printf '  FAIL  %s\n' "$1"; F=$((F+1)); }
if bash "$HERE/local-db.sh" doctor 2>/dev/null | grep -qE '^(postgres17|pgvector) '; then
  echo "schema-pending: SKIP — this machine has no Postgres 17 + pgvector (bash bot/scripts/e2e/local-db.sh doctor)"; exit 0
fi

T="$(mktemp -d)/path with spaces"; R="$T/repo"; E="$R/bot/scripts/e2e"
mkdir -p "$E" "$R/infrastructure/supabase/migrations" "$R/bot/database/migrations" "$R/supabase/baseline"
for f in local-db.sh portable.sh local-db-bootstrap.sql; do cp "$HERE/$f" "$E/"; done
M1="$R/infrastructure/supabase/migrations"; M2="$R/bot/database/migrations"
echo "create table public.alpha (id int primary key);" > "$R/supabase/baseline/schema.sql"     # the sandbox copy
echo "create table public.alpha (id int primary key);" > "$M1/V1.0.1__alpha.sql"                # already in the copy
printf 'infrastructure/supabase/migrations/V1.0.1__alpha.sql\n' > "$R/supabase/baseline/schema.migrations.txt"
export LOCAL_DB_HOME="$T/home" LOCAL_DB_PG_PORT=55542 LOCAL_DB_ALLOW_NO_SEED=1
export LOCAL_DB_SEED="$T/none.sql" LOCAL_DB_SEED_OVERRIDES="$T/none-overrides.sql"
unset LOCAL_DB_SCHEMA
L="$E/local-db.sh"
trap 'bash "$L" stop >/dev/null 2>&1; rm -rf "$(dirname "$T")"' EXIT
PGBIN="$(LOCAL_DB_HOME="$T/home" bash -c '. "'"$HERE"'/portable.sh" 2>/dev/null; for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/psql" ] && { echo "$d"; exit; }; done; dirname "$(command -v psql)"')"
tables() {   # the public tables of the golden `local-db.sh golden` built, through a throwaway clone of it
  local g; g=$(bash "$L" golden 2>"$T/err") || { echo "GOLDEN_FAILED"; return; }
  "$PGBIN/psql" -X -q -h 127.0.0.1 -p 55542 -U postgres -d postgres -c "drop database if exists probe" -c "create database probe template $g" >/dev/null 2>&1
  "$PGBIN/psql" -X -At -h 127.0.0.1 -p 55542 -U postgres -d probe -c "select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public'"
  "$PGBIN/psql" -X -q -h 127.0.0.1 -p 55542 -U postgres -d postgres -c "drop database if exists probe" >/dev/null 2>&1
}

echo "nothing newer than the sandbox copy: the golden is the copy"
[ -z "$(bash "$L" pending-migrations 2>/dev/null)" ] && ok "no pending migrations" || bad "pending: $(bash "$L" pending-migrations 2>&1 | tr '\n' ' ')"
[ "$(tables)" = "alpha" ] && ok "golden has the copy's table" || bad "golden tables: [$(tables)] $(tail -2 "$T/err" | tr '\n' ' ')"

echo "migrations merged after the copy, in both folders: both are applied, in order"
echo "create table public.beta (id int primary key);" > "$M1/V1.0.2__beta.sql"
echo "alter table public.beta add column note text;" > "$M1/V1.0.10__beta_note.sql"          # 1.0.10 sorts after 1.0.2
echo "drop table public.beta;" > "$M1/ROLLBACK_V1.0.2__beta.sql"                             # a rollback is never applied
echo "create table public.gamma (id int primary key);" > "$M2/2026-11-25_gamma.sql"
p=$(bash "$L" pending-migrations 2>/dev/null | tr '\n' ' ')
[ "$p" = "infrastructure/supabase/migrations/V1.0.2__beta.sql infrastructure/supabase/migrations/V1.0.10__beta_note.sql bot/database/migrations/2026-11-25_gamma.sql " ] \
  && ok "pending: the three newer files, versions in number order, no rollback" || bad "pending: [$p]"
[ "$(tables)" = "alpha,beta,gamma" ] && ok "golden has the new tables" || bad "golden tables: [$(tables)] $(tail -3 "$T/err" | tr '\n' ' ')"
g=$(bash "$L" golden 2>/dev/null)
"$PGBIN/psql" -X -q -h 127.0.0.1 -p 55542 -U postgres -d postgres -c "create database probe2 template $g" >/dev/null 2>&1
n=$("$PGBIN/psql" -X -At -h 127.0.0.1 -p 55542 -U postgres -d probe2 -c "select count(*) from information_schema.columns where table_name='beta' and column_name='note'")
"$PGBIN/psql" -X -q -h 127.0.0.1 -p 55542 -U postgres -d postgres -c "drop database probe2" >/dev/null 2>&1
[ "$n" = 1 ] && ok "…and V1.0.10 ran after V1.0.2 (beta has its column)" || bad "beta.note: [$n]"

echo "a migration that fails on top of the copy is skipped, with a warning; the rest still apply"
echo "alter table public.nowhere add column x int;" > "$M1/V1.0.11__broken.sql"
echo "create table public.delta (id int primary key);" > "$M1/V1.0.12__delta.sql"
t=$(tables)
[ "$t" = "alpha,beta,delta,gamma" ] && grep -q 'V1.0.11__broken.sql' "$T/err" && ok "broken one skipped and named, delta still applied" \
  || bad "after a broken migration: tables [$t], log: $(tr '\n' ' ' < "$T/err" | cut -c1-200)"

echo "re-dumping the copy (baseline) re-stamps it: nothing is pending afterwards"
python3 - "$R" <<'PY'
import os, sys
r = sys.argv[1]; out = []
for d in ("infrastructure/supabase/migrations", "bot/database/migrations"):
    out += [d + "/" + f for f in sorted(os.listdir(os.path.join(r, d))) if f.endswith(".sql")]
open(os.path.join(r, "supabase/baseline/schema.migrations.txt"), "w").write("\n".join(out) + "\n")
PY
grep -q 'stamp_migrations' "$L" && ok "baseline calls the stamp writer" || bad "baseline does not stamp schema.migrations.txt"
[ -z "$(bash "$L" pending-migrations 2>/dev/null)" ] && ok "a full stamp leaves nothing pending" || bad "still pending after a full stamp"

echo "no stamp at all (an old checkout): nothing is applied on top, as before"
rm -f "$R/supabase/baseline/schema.migrations.txt"
[ -z "$(bash "$L" pending-migrations 2>/dev/null)" ] && ok "no stamp → no pending migrations" || bad "no stamp: pending [$(bash "$L" pending-migrations 2>/dev/null | tr '\n' ' ')]"

echo; [ "$F" = 0 ] && echo "schema-pending: PASS" || { echo "schema-pending: $F failed"; exit 1; }
