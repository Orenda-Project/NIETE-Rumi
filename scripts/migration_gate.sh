#!/usr/bin/env bash
# migration_gate.sh <migration.sql> [rollback.sql]
#
# Proves a migration the way infrastructure/scripts/migrate.js applies it, on a throwaway local Postgres.
#
# WHY (SPEC v2.1 §11.4, COACHIP fix-r5). MigrationRunner.applyMigration sends the WHOLE file as one
# `rpc/exec_sql` call, a plpgsql `EXECUTE`. Postgres refuses transaction control there (0A000), and a psql run
# accepts it, which is how V1.8.0 passed three psql gates and then failed on sandbox. So this gate never lets psql
# run a migration file: every file goes through a local `exec_sql` whose definition is read out of migrate.js
# itself, one call per file, exactly as the runner sends it.
#
# Steps (each prints PASS/FAIL; any FAIL exits non-zero):
#   0. negative control   a file with a top-level BEGIN; through exec_sql must FAIL with SQLSTATE 0A000
#   1. base               every guarded migration (V1.8.0 onward, not ROLLBACK_) older than <file>, in order
#   2. apply 1            <file>
#   3. apply 2            <file> again (idempotent)
#   4. rollback           [rollback] (default: ROLLBACK_<file> beside it); the schema must equal the pre-apply schema
#   5. re-apply           <file>; the schema must equal the one after apply 1
#
# The base tables the COACHIP migrations reference (users, schools, coaching_sessions, observation_schedules,
# leader_schools, app_settings) are cut from supabase/baseline/schema.sql, plus the Supabase shims they need
# (extensions.uuid_generate_v4, roles anon/authenticated/service_role, auth.role(), update_updated_at_column).
#
# Local only: the cluster lives in a mktemp dir, listens on a unix socket in that dir and on no TCP address, and is
# stopped and deleted on exit. Nothing here reads a DATABASE_URL or SUPABASE_URL. Postgres binaries: $PG_BIN, else
# Homebrew/apt postgresql@17..15, else `initdb` on PATH (only if a `postgres` server sits beside it).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGDIR="$REPO/infrastructure/supabase/migrations"
RUNNER="$REPO/infrastructure/scripts/migrate.js"
BASELINE="$REPO/supabase/baseline/schema.sql"
FIRST_GUARDED="1.8.0"   # same floor as tests/setup/migrations-no-transaction-control.test.js

die() { echo "FAIL  $*"; echo "MIGRATION GATE FAILED"; exit 1; }
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS + 1)); }

[ $# -ge 1 ] && [ $# -le 2 ] || { echo "usage: $0 <migration.sql> [rollback.sql]"; exit 2; }
FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -f "$FILE" ] || die "no such file: $1"
if [ $# -eq 2 ]; then RB="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; else RB="$(dirname "$FILE")/ROLLBACK_$(basename "$FILE")"; fi
[ -f "$RB" ] || die "no rollback file: $RB (pass it as the second argument)"

# ── Postgres binaries ────────────────────────────────────────────────────────────────────────────────────
PG=""
# PATH comes last: Homebrew's libpq ships an initdb with no postgres server beside it.
for c in "${PG_BIN:-}" \
         /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin \
         /opt/homebrew/opt/postgresql@16/bin /usr/lib/postgresql/16/bin /opt/homebrew/opt/postgresql@15/bin /usr/lib/postgresql/15/bin \
         "$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")"; do
  if [ -n "$c" ] && [ -x "$c/initdb" ] && [ -x "$c/postgres" ] && [ -x "$c/pg_ctl" ] && [ -x "$c/psql" ]; then PG="$c"; break; fi
done
[ -n "$PG" ] || die "no Postgres server binaries (initdb, postgres, pg_ctl, psql in one dir) found: set PG_BIN or install postgresql@17"

# ── the runner's exec_sql, read out of migrate.js (its doc comment is the definition the runner requires) ───────
EXEC_SQL="$(sed -n 's/^[[:space:]]*\*[[:space:]]*//p' "$RUNNER" | awk '/^CREATE OR REPLACE FUNCTION exec_sql\(/{p=1} p{printf "%s ", $0} p&&/LANGUAGE plpgsql;/{exit}')"
case "$EXEC_SQL" in
  "CREATE OR REPLACE FUNCTION exec_sql("*"EXECUTE query;"*"LANGUAGE plpgsql;"*) ;;
  *) die "could not read the exec_sql definition out of $RUNNER" ;;
esac

# ── throwaway cluster ────────────────────────────────────────────────────────────────────────────────────
# /tmp, not $TMPDIR: a unix socket path must stay under ~100 bytes and macOS's per-user TMPDIR is long.
D="$(mktemp -d /tmp/mgate.XXXXXX)" || die "mktemp failed"
S="$D/s"; mkdir -p "$S"
cleanup() { "$PG/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"; }
trap cleanup EXIT INT TERM
# The socket lives in a private dir and no TCP address is opened, so any port is collision-free; take a free one anyway.
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || echo 54399)"
LC_ALL=C LANG=C "$PG/initdb" -D "$D/data" -U postgres -A trust --no-sync >"$D/initdb.log" 2>&1 || { tail -5 "$D/initdb.log"; die "initdb"; }
LC_ALL=C LANG=C "$PG/pg_ctl" -D "$D/data" -w -o "-k $S -p $PORT -c listen_addresses=''" -l "$D/log" start >/dev/null 2>&1 \
  || { cat "$D/log"; die "pg_ctl start"; }
echo "gate: $("$PG/postgres" --version), socket $S port $PORT"
echo "file: ${FILE#"$REPO/"}"
echo "rollback: ${RB#"$REPO/"}"

export PGOPTIONS="-c client_min_messages=warning"
Q() { "$PG/psql" -h "$S" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -q -X "$@"; }
# RUN <file>: ONE exec_sql call with the whole file as its argument, as applyMigration sends it (one transaction).
RUN() { echo "SELECT exec_sql(:'q');" | Q -v "q=$(cat "$1")" >/dev/null 2>"$D/run.err"; }
runerr() { grep -m1 -E 'ERROR' "$D/run.err" || head -3 "$D/run.err"; }

# A schema signature: everything a migration can add or drop in public, sorted; equal signatures = same schema.
# Keyed by name, never by attnum: a column dropped and re-added comes back with a new attnum and is the same schema.
SIG="SELECT string_agg(x, E'\n' ORDER BY x) FROM (
  SELECT 'col ' || c.table_name || '.' || c.column_name || ' ' || c.udt_name || ' ' || c.is_nullable || ' ' || coalesce(c.column_default, '') AS x
    FROM information_schema.columns c WHERE c.table_schema = 'public'
  UNION ALL SELECT 'type ' || t.typname || ' ' || coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid), '')
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')
  UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'con ' || conrelid::regclass || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'fn ' || p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'trg ' || tgrelid::regclass || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'pol ' || tablename || ' ' || policyname FROM pg_policies WHERE schemaname = 'public'
  UNION ALL SELECT 'cmt ' || d.objoid::regclass || '.' || coalesce(a.attname, '') || ' ' || d.description FROM pg_description d
    JOIN pg_class k ON k.oid = d.objoid AND d.classoid = 'pg_class'::regclass
    LEFT JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid AND d.objsubid > 0
    WHERE k.relnamespace = 'public'::regnamespace
  UNION ALL SELECT 'cmt type ' || t.typname || ' ' || d.description FROM pg_description d
    JOIN pg_type t ON t.oid = d.objoid AND d.classoid = 'pg_type'::regclass WHERE t.typnamespace = 'public'::regnamespace
) s;"
sig() { Q -At -c "$SIG" > "$1"; }

# ── baseline tables + Supabase shims ─────────────────────────────────────────────────────────────────────────
python3 - "$BASELINE" > "$D/base.sql" <<'PY' || die "could not cut the base tables from supabase/baseline/schema.sql"
import sys, re
sql = open(sys.argv[1]).read()
print("""CREATE SCHEMA IF NOT EXISTS extensions;
CREATE FUNCTION extensions.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
CREATE SEQUENCE IF NOT EXISTS public.student_code_seq;""")
m = re.search(r"CREATE FUNCTION public\.update_updated_at_column\(\).*?\n\$\$;", sql, re.S) or re.search(r"CREATE FUNCTION public\.update_updated_at_column\(\).*?\$_?\$;", sql, re.S)
print(m.group(0) if m else "CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;")
for t in ["users", "schools", "coaching_sessions", "observation_schedules", "leader_schools", "app_settings"]:
    s = sql.index(f"CREATE TABLE public.{t} ("); e = sql.index("\n);", s)
    print(sql[s:e+3]); print(f"ALTER TABLE public.{t} ADD PRIMARY KEY ({'key' if t == 'app_settings' else 'id'});")
PY
Q -f "$D/base.sql" >/dev/null 2>"$D/base.err" || { cat "$D/base.err"; die "load base tables"; }
Q -c "$EXEC_SQL" >/dev/null 2>"$D/x.err" || { cat "$D/x.err"; die "create exec_sql"; }
pass "setup: base tables $(Q -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'") + shims + exec_sql (from ${RUNNER#"$REPO/"})"

# ── 0. negative control ──────────────────────────────────────────────────────────────────────────────────
printf 'BEGIN;\nCREATE TABLE gate_negative_control (a int);\nCOMMIT;\n' > "$D/neg.sql"
if RUN "$D/neg.sql"; then
  fail "negative control: a top-level BEGIN; APPLIED through exec_sql; this gate cannot see transaction control"
elif grep -q '0A000' "$D/run.err"; then
  pass "negative control: top-level BEGIN; refused with 0A000 ($(runerr | sed 's/^psql:[^E]*//' | head -c 120))"
else
  fail "negative control: failed, but not with 0A000: $(runerr)"
fi
[ "$(Q -At -c "SELECT count(*) FROM pg_tables WHERE tablename = 'gate_negative_control'")" = 0 ] \
  || fail "negative control left its table behind"

# ── 1. base: every guarded migration older than FILE ─────────────────────────────────────────────────────
ver() { basename "$1" | sed -nE 's/^V([0-9]+)\.([0-9]+)\.([0-9]+)__.*\.sql$/\1 \2 \3/p'; }
key() { local v; v="$(ver "$1")"; [ -n "$v" ] && printf '%05d%05d%05d' $v; }
FKEY="$(key "$FILE")"
GKEY="$(printf '%05d%05d%05d' ${FIRST_GUARDED//./ })"
NBASE=0
if [ -n "$FKEY" ]; then
  while IFS= read -r b; do
    k="$(key "$b")"; [ -n "$k" ] || continue
    [[ "$k" < "$GKEY" ]] && continue
    [[ "$k" < "$FKEY" ]] || continue
    [ "$b" -ef "$FILE" ] && continue
    if RUN "$b"; then pass "base: $(basename "$b")"; NBASE=$((NBASE + 1)); else fail "base: $(basename "$b"): $(runerr)"; fi
  done < <(for f in "$MIGDIR"/V*.sql; do printf '%s\t%s\n' "$(key "$f")" "$f"; done | sort | cut -f2)
fi
[ "$NBASE" -gt 0 ] || echo "info  base: no guarded migration older than $(basename "$FILE")"
[ "$FAILS" -eq 0 ] || die "the base did not apply; nothing below would mean anything"

# ── 2-5. apply, apply again, rollback, re-apply ───────────────────────────────────────────────────────────
sig "$D/sig.before"
if RUN "$FILE"; then pass "apply 1 (exec_sql): $(basename "$FILE")"; else die "apply 1 (exec_sql) refused $(basename "$FILE"): $(runerr)"; fi
sig "$D/sig.applied"
if RUN "$FILE"; then pass "apply 2 (exec_sql, idempotent)"; else fail "apply 2 (not idempotent): $(runerr)"; fi
sig "$D/sig.applied2"
if cmp -s "$D/sig.applied" "$D/sig.applied2"; then pass "apply 2 left the schema unchanged"; else fail "apply 2 changed the schema:"; diff "$D/sig.applied" "$D/sig.applied2" | head -20; fi
if cmp -s "$D/sig.before" "$D/sig.applied"; then echo "info  apply 1 changed nothing in public (a data-only or non-public migration?)"
else
  echo "info  apply 1 added/changed $(diff "$D/sig.before" "$D/sig.applied" | grep -c '^>') schema items ($(diff "$D/sig.before" "$D/sig.applied" | grep -c '^> cmt ') of them comments); first 40 others:"
  diff "$D/sig.before" "$D/sig.applied" | grep '^[<>]' | grep -v '^> cmt ' | head -40 | sed 's/^/        /'
fi
if RUN "$RB"; then pass "rollback (exec_sql): $(basename "$RB")"; else fail "rollback: $(runerr)"; fi
sig "$D/sig.rolledback"
if cmp -s "$D/sig.before" "$D/sig.rolledback"; then pass "rollback restored the pre-apply schema exactly"
else fail "rollback left the schema different from before apply 1:"; diff "$D/sig.before" "$D/sig.rolledback" | head -20; fi
if RUN "$FILE"; then pass "re-apply after rollback (exec_sql)"; else fail "re-apply: $(runerr)"; fi
sig "$D/sig.reapplied"
if cmp -s "$D/sig.applied" "$D/sig.reapplied"; then pass "re-apply produced the same schema as apply 1"
else fail "re-apply differs from apply 1:"; diff "$D/sig.applied" "$D/sig.reapplied" | head -20; fi

if [ "$FAILS" -eq 0 ]; then echo "MIGRATION GATE OK"; exit 0; fi
echo "MIGRATION GATE FAILED ($FAILS step(s))"; exit 1
