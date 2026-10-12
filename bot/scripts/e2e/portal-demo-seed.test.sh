#!/usr/bin/env bash
# portal-demo-seed.test.sh — `local-db.sh demo-seed` fills ONE run's database with a made-up school
# network so the local teacher + coach portal has something to show (bd-hnhlgn).
#
# Runs against this machine's real cluster, schema and seed (the demo rows lean on the seeded training
# catalogue), on its own PostgREST/proxy ports so a running local stack is left alone. Proves:
#   AC1  3 schools, 1 coach linked to all 3, 1 principal, 9 teachers — activated, demo password, demo phones
#   AC2  each teacher has classes, students, lesson plans, LP opens, completed FICO sessions with scores,
#        training assignment + progress; the coach has upcoming visits and observations in every stage
#   AC3  running it twice changes nothing
#   AC4  the golden template is untouched: a run cloned afterwards has no demo users
#   AC5  refuses a run_dir that has no local database
# Needs: Postgres 17 + postgrest + a pulled seed (local-db.sh doctor / seed-pull). Skips without them.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LDB="$HERE/local-db.sh"
fails=0
t() { if [ "$2" = "$3" ]; then echo "  ok  $1"; else echo "  FAIL $1: want [$3] got [$2]"; fails=$((fails+1)); fi; }

[ "$(bash "$LDB" seed-status 2>/dev/null)" = ok ] || { echo "skip: no seed on this machine (local-db.sh seed-pull)"; exit 0; }
export LOCAL_DB_REST_PORT=55530 E2E_SUPABASE_PORT=55531
PGBIN="$(bash -c ". '$HERE/portable.sh' 2>/dev/null; for d in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do [ -x \$d/psql ] && { echo \$d; break; }; done")"
tmp="$(mktemp -d)/run dir"; run2="$tmp-2"
cleanup() { bash "$LDB" down "$tmp" >/dev/null 2>&1; bash "$LDB" down "$run2" >/dev/null 2>&1; rm -rf "$(dirname "$tmp")"; }
trap cleanup EXIT

bash "$LDB" up "$tmp" >/dev/null 2>&1 || { echo "  FAIL up"; exit 1; }
db=$(cat "$tmp/db.name")
q() { "$PGBIN/psql" -X -At -h 127.0.0.1 -p "${LOCAL_DB_PG_PORT:-54329}" -U postgres -d "$1" -c "$2"; }
D="phone_number like '9230000009%'"

echo "AC5 refuses a run_dir without a database"
bash "$LDB" demo-seed "$(dirname "$tmp")/nowhere" >/dev/null 2>&1; t "exit code" "$?" "2"

echo "AC1 people"
bash "$LDB" demo-seed "$tmp" >"$tmp/seed.out" 2>&1; t "demo-seed exit" "$?" "0"
t "schools"   "$(q $db "select count(*) from schools where emis like 'DEMO-%'")" "3"
t "teachers"  "$(q $db "select count(*) from users where $D and role='teacher'")" "9"
t "coach"     "$(q $db "select count(*) from users where $D and role='coach'")" "1"
t "principal" "$(q $db "select count(*) from users where $D and role='principal'")" "1"
t "all can log in" "$(q $db "select count(*) from users where $D and portal_activated and portal_password_hash like '\$2%'")" "11"
t "teachers have a school" "$(q $db "select count(*) from users where $D and role='teacher' and school_id is not null")" "9"
t "coach covers 3 schools" "$(q $db "select count(*) from leader_schools ls join users u on u.id=ls.leader_user_id where u.$D")" "3"

echo "AC2 activity"
per_teacher() { q $db "select count(*) from users u where u.$D and u.role='teacher' and exists ($1)"; }
t "classes"        "$(per_teacher "select 1 from class_teachers ct join class_enrollments e on e.class_id=ct.class_id where ct.teacher_user_id=u.id and ct.is_active")" "9"
t "lesson plans"   "$(per_teacher "select 1 from lesson_plans l where l.user_id=u.id")" "9"
t "LP opens"       "$(per_teacher "select 1 from niete_lp_opens o where o.user_id=u.id")" "9"
t "scored sessions" "$(per_teacher "select 1 from coaching_sessions c where c.user_id=u.id and c.status='completed' and (c.analysis_data->'scores'->>'overall_percentage') is not null and c.analysis_data->'domains' ? 'high_leverage_practices'")" "9"
t "training"       "$(per_teacher "select 1 from teacher_training_assignments a join teacher_training_progress p on p.user_id=a.user_id where a.user_id=u.id and a.is_active")" "9"
t "upcoming visits" "$(q $db "select (count(*)>=3)::text from observation_schedules s join users u on u.id=s.leader_user_id where u.$D and s.status='upcoming'")" "true"
t "observation stages" "$(q $db "select count(distinct c.status||'/'||coalesce(c.debrief_status,'')) from coaching_sessions c join users u on u.id=c.observer_user_id where u.$D and c.observation_type='leader_observation'")" "3"
t "portal flags" "$(q $db "select count(*) from app_settings where key in ('portal_coach_v2','portal_teacher_v2')")" "2"

echo "AC3 idempotent"
before=$(q $db "select (select count(*) from users)||'/'||(select count(*) from coaching_sessions)||'/'||(select count(*) from students)||'/'||(select count(*) from lesson_plans)")
bash "$LDB" demo-seed "$tmp" >/dev/null 2>&1; t "second run exit" "$?" "0"
t "same counts" "$(q $db "select (select count(*) from users)||'/'||(select count(*) from coaching_sessions)||'/'||(select count(*) from students)||'/'||(select count(*) from lesson_plans)")" "$before"

echo "AC4 golden untouched"
bash "$LDB" up "$run2" >/dev/null 2>&1 || echo "  FAIL second up"
t "fresh run has no demo users" "$(q "$(cat "$run2/db.name")" "select count(*) from users where $D")" "0"

[ $fails = 0 ] && echo "PASS" || { echo "$fails failed"; exit 1; }
