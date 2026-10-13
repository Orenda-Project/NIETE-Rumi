#!/usr/bin/env bash
# refresh-views.test.sh — `local-db.sh refresh-views` populates a run's materialized views wherever Postgres 17
# lives, and dev-portal.sh uses it instead of a Postgres path of its own (bd-hnhlgn.3: on Linux dev-portal's
# hard-coded Homebrew psql was missing, the refresh failed with a warning, and every dashboard number was empty).
#   AC1  views populated with Postgres found only in a Debian-style bin dir (nothing Postgres on PATH)
#   AC2  dev-portal.sh names no Postgres path and refreshes through local-db.sh
#   AC3  a refresh that fails exits non-zero
# Needs: Postgres 17 + postgrest + a pulled seed. Skips without them.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LDB="$HERE/local-db.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

[ "$(bash "$LDB" seed-status 2>/dev/null)" = ok ] || { echo "skip: no seed on this machine (local-db.sh seed-pull)"; exit 0; }
export LOCAL_DB_REST_PORT=55550 E2E_SUPABASE_PORT=55551
PGBIN=""; for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x "$d/psql" ] && { PGBIN=$d; break; }; done
root="$(mktemp -d)"; R="$root/run"
cleanup() { bash "$LDB" down "$R" >/dev/null 2>&1; rm -rf "$root"; }
trap cleanup EXIT
q() { "$PGBIN/psql" -X -At -h 127.0.0.1 -p "${LOCAL_DB_PG_PORT:-54329}" -U postgres -d "$1" -c "$2"; }

bash "$LDB" up "$R" >/dev/null 2>&1 || { echo "  FAIL up"; exit 1; }
db=$(cat "$R/db.name")
mvs=$(q "$db" "select count(*) from pg_matviews where schemaname='public'")
[ "$mvs" -gt 0 ] || { echo "  FAIL the golden has no materialized views to test with"; exit 1; }
q "$db" "select format('refresh materialized view public.%I with no data;', matviewname) from pg_matviews where schemaname='public'" | "$PGBIN/psql" -X -q -h 127.0.0.1 -p "${LOCAL_DB_PG_PORT:-54329}" -U postgres -d "$db" >/dev/null

echo "AC1 Debian layout, nothing on PATH"
deb="$root/usr/lib/postgresql/17/bin"; mkdir -p "$deb"
for f in "$PGBIN"/*; do ln -s "$f" "$deb/$(basename "$f")"; done
env PATH=/usr/bin:/bin LOCAL_DB_PG_SEARCH="$deb" bash "$LDB" refresh-views "$R" >"$root/refresh.log" 2>&1
t "exit" "$?" "0"
t "all $mvs views populated" "$(q "$db" "select count(*) from pg_matviews where schemaname='public' and ispopulated")" "$mvs"

echo "AC2 dev-portal.sh delegates"
grep -qE 'postgresql@17|/usr/lib/postgresql' "$HERE/../../../scripts/dev-portal.sh"; t "no Postgres path in dev-portal.sh" "$?" "1"
grep -qF 'local-db.sh" refresh-views' "$HERE/../../../scripts/dev-portal.sh"; t "refreshes through local-db.sh" "$?" "0"

echo "AC3 failure is loud"
bad="$root/bad"; mkdir -p "$bad"; echo run_does_not_exist >"$bad/db.name"
bash "$LDB" refresh-views "$bad" >/dev/null 2>&1; t "missing database exits non-zero" "$([ $? -ne 0 ] && echo yes)" "yes"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
