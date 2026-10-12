#!/usr/bin/env bash
# sandbox-copy.test.sh — `local-db.sh sandbox-copy` fills a run database with the sandbox's rows, on the
# developer's own machine, so the local portal shows what the sandbox shows (bd-hnhlgn.2).
#
# Hermetic stand-in for the sandbox: run A (golden + demo-seed + one column the run DB will lack) is the
# SOURCE, through the tests' local-source seam (LOCAL_DB_TEST_LOCAL_SOURCE=1); run B is the target. Proves:
#   AC1  a source that is not the sandbox is refused before anything connects (exit 3, target untouched)
#   AC2  rows arrive by column NAME — a source-only column is skipped, not fatal
#   AC3  sequences are past the copied rows: a new student (student_code from a sequence) inserts cleanly
#   AC4  a table forced onto the chunked path still arrives whole
#   AC5  a second copy reuses the cache; --refresh pulls again
# Needs: Postgres 17 + postgrest + a pulled seed. Skips without them.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LDB="$HERE/local-db.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

[ "$(bash "$LDB" seed-status 2>/dev/null)" = ok ] || { echo "skip: no seed on this machine (local-db.sh seed-pull)"; exit 0; }
export LOCAL_DB_REST_PORT=55540 E2E_SUPABASE_PORT=55541
PGBIN=""; for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/psql" ] && { PGBIN=$d; break; }; done
root="$(mktemp -d)/sandbox copy"; A="$root/a"; B="$root/b"; mkdir -p "$root"
export LOCAL_DB_COPY_CACHE="$root/cache"
cleanup() { for r in "$A" "$B"; do bash "$LDB" down "$r" >/dev/null 2>&1; done; rm -rf "$(dirname "$root")"; }
trap cleanup EXIT
q() { "$PGBIN/psql" -X -At -h 127.0.0.1 -p "${LOCAL_DB_PG_PORT:-54329}" -U postgres -d "$1" -c "$2"; }

bash "$LDB" up "$A" >/dev/null 2>&1 || { echo "  FAIL up A"; exit 1; }
bash "$LDB" demo-seed "$A" >/dev/null 2>&1 || { echo "  FAIL demo-seed A"; exit 1; }
a=$(cat "$A/db.name")
q "$a" "alter table public.schools add column zz_source_only text; update public.schools set zz_source_only='x'" >/dev/null
LOCAL_DB_REST_PORT=55542 E2E_SUPABASE_PORT=55543 bash "$LDB" up "$B" >/dev/null 2>&1 || { echo "  FAIL up B"; exit 1; }
b=$(cat "$B/db.name")
counts() { q "$1" "select (select count(*) from users)||'/'||(select count(*) from schools)||'/'||(select count(*) from students)||'/'||(select count(*) from coaching_sessions)||'/'||(select count(*) from training_modules)"; }

echo "AC1 refuses a non-sandbox source"
before=$(counts "$b")
LOCAL_DB_SANDBOX_URL="postgresql://postgres.ihzciabopbttygxxgrkm:nope@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" \
  bash "$LDB" sandbox-copy "$B" >/dev/null 2>&1; t "exit code" "$?" "3"
t "target untouched" "$(counts "$b")" "$before"

SRC="postgres://postgres@127.0.0.1:${LOCAL_DB_PG_PORT:-54329}/$a"
echo "AC2/AC4 copy"
LOCAL_DB_TEST_LOCAL_SOURCE=1 LOCAL_DB_SANDBOX_URL="$SRC" LOCAL_DB_COPY_FORCE_CHUNK=coaching_sessions \
  bash "$LDB" sandbox-copy "$B" >"$root/copy1.log" 2>&1; t "copy exit" "$?" "0"
t "same rows as the source" "$(counts "$b")" "$(counts "$a")"
t "source-only column skipped" "$(q "$b" "select count(*) from information_schema.columns where table_name='schools' and column_name='zz_source_only'")" "0"
t "chunked table arrived whole" "$(q "$b" "select count(*) from coaching_sessions")" "$(q "$a" "select count(*) from coaching_sessions")"
grep -q "chunked coaching_sessions" "$root/copy1.log"; t "chunked path was taken" "$?" "0"
t "demo coach's analysis_data intact" "$(q "$b" "select md5(string_agg(analysis_data::text, '' order by id)) from coaching_sessions")" "$(q "$a" "select md5(string_agg(analysis_data::text, '' order by id)) from coaching_sessions")"

echo "AC3 sequences past the copied rows"
q "$b" "insert into public.students (student_name) values ('New Student')" >/dev/null 2>&1; t "new student inserts" "$?" "0"
t "its code is new" "$(q "$b" "select count(*) from students group by student_code having count(*) > 1" | wc -l | tr -d ' ')" "0"

echo "AC5 cache"
LOCAL_DB_TEST_LOCAL_SOURCE=1 LOCAL_DB_SANDBOX_URL="$SRC" bash "$LDB" sandbox-copy "$B" >"$root/copy2.log" 2>&1; t "second copy exit" "$?" "0"
grep -q "using the cached copy" "$root/copy2.log"; t "cache reused" "$?" "0"
t "still the source's rows (not doubled)" "$(counts "$b" | cut -d/ -f1,2,4)" "$(counts "$a" | cut -d/ -f1,2,4)"
LOCAL_DB_TEST_LOCAL_SOURCE=1 LOCAL_DB_SANDBOX_URL="$SRC" bash "$LDB" sandbox-copy "$B" --refresh >"$root/copy3.log" 2>&1; t "refresh exit" "$?" "0"
grep -q "using the cached copy" "$root/copy3.log"; t "refresh pulled again" "$?" "1"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
