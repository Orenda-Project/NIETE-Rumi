-- bd-60104 — users.phone_number must hold the shell-merge tombstone.
-- Plus: leader_roster_audit must admit 'edit_role' (the V1.4.7 sequel).
--
-- WHY (measured on production `ihzciabopbttygxxgrkm`, 2026-09-21)
--
--   The shell-merge path retires the destination account by parking it on a
--   sentinel phone before the survivor takes the number:
--
--     .update({ ...retireMergedPatch(userId), phone_number: `merged:${target.id}` })
--     -- observe-visit-flow.handler.js, the teacher_edit_phone_commit step
--
--   'merged:' + a uuid is 43 characters. `users.phone_number` is VARCHAR(20),
--   so that write died every time with 22001 (value too long). The retire runs
--   FIRST — phone_number is UNIQUE, the number has to be freed before the
--   survivor can claim it — so the handler hit `if (error) return
--   _refuse('failed')` and returned "This did not go through". Nothing after it
--   ran: no phone move, no audit row, not even an escalation.
--
--   Production evidence: 13 `teacher_edit_phone_commit` taps by 7 coaches
--   between 14–21 Sep, ONE success. That one was CASE_FREE, which skips the
--   retire block entirely. So every `free` merge worked and no `shell` merge
--   ever could — `edit_phone` with case='shell' has zero rows in the table's
--   whole history. Reproduced end-to-end on the ZZTEST sandbox school.
--
--   The operator's `phone-merge-apply.py` worked around the cap by truncating
--   to 8 hex chars ('merged:1bd856ef', 15 chars). That fits, but it is not
--   collision-proof and it loses the pointer back to the retired row, so the
--   column is widened instead of the code being truncated to match.
--
-- WIDTH: 64, not 43. 43 fits exactly today and breaks on any change to the
-- prefix; 64 leaves room for the next sentinel without another DDL.
--
-- SAFETY: widening a varchar is a metadata-only change in Postgres — no table
-- rewrite, no lock beyond a brief ACCESS EXCLUSIVE, safe on a live table.
-- Narrowing later would NOT be, which is the other reason to overshoot once.
--
-- THREE MATERIALIZED VIEWS BLOCK THE ALTER, and Postgres refuses to change a
-- column a view depends on ("cannot alter type of a column used by a view or
-- rule", first attempt 2026-09-21). They are dropped and rebuilt around the
-- ALTER, in ONE transaction so a failure can never leave a view missing:
--
--   mv_users_activity              23 MB, 18,010 rows, 6 indexes — reads phone_number
--   mv_dashboard_stats_by_country  64 kB, 10 rows,     1 index   — reads phone_number
--   mv_view_refresh_status         tiny,  4 rows,      1 index   — reads the two above,
--                                  so it must be dropped FIRST and rebuilt LAST
--
-- `mv_dashboard_stats` and `mv_retention_cohorts` also read `users`, but not
-- `phone_number`, so they are NOT touched — confirmed by a rolled-back dry run
-- on production: dropping only these three let the ALTER through.
--
-- Definitions below are pg_get_viewdef() output captured from production
-- immediately before the drop — not reconstructed from memory. None of the
-- three carries a non-owner GRANT (checked), so none is reissued.
--
-- COST: the rebuild is cheap — the largest view scans in ~70ms.
--
-- IDEMPOTENT: re-running is a no-op for the type; the views are dropped and
-- recreated either way, which costs one rebuild.

BEGIN;

-- dependency order: the dependent view first
DROP MATERIALIZED VIEW IF EXISTS mv_view_refresh_status;
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_stats_by_country;
DROP MATERIALIZED VIEW IF EXISTS mv_users_activity;

ALTER TABLE users
  ALTER COLUMN phone_number TYPE varchar(64);

-- ── rebuild: mv_dashboard_stats_by_country ────────────────────────────
CREATE MATERIALIZED VIEW public.mv_dashboard_stats_by_country AS
 WITH user_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(*) AS total_users,
            count(*) FILTER (WHERE u.registration_completed = true) AS registered_users,
            count(*) FILTER (WHERE u.created_at >= (now() - '1 day'::interval)) AS new_users_today,
            count(*) FILTER (WHERE u.created_at >= (now() - '7 days'::interval)) AS new_users_week
           FROM users u
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        ), message_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(c.id) AS total_messages,
            count(c.id) FILTER (WHERE c.created_at >= (now() - '1 day'::interval)) AS messages_today,
            count(DISTINCT c.user_id) FILTER (WHERE c.created_at >= (now() - '1 day'::interval)) AS dau,
            count(DISTINCT c.user_id) FILTER (WHERE c.created_at >= (now() - '7 days'::interval)) AS wau
           FROM users u
             LEFT JOIN conversations c ON c.user_id = u.id
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        ), feature_stats AS (
         SELECT "left"(u.phone_number::text, 2) AS country_code,
            count(DISTINCT lp.id) AS lesson_plans,
            count(DISTINCT cs.id) AS coaching_sessions,
            count(DISTINCT ra.id) AS reading_assessments,
            count(DISTINCT vr.id) AS video_requests
           FROM users u
             LEFT JOIN lesson_plan_requests lp ON lp.user_id = u.id
             LEFT JOIN coaching_sessions cs ON cs.user_id = u.id
             LEFT JOIN reading_assessments ra ON ra.user_id = u.id
             LEFT JOIN video_requests vr ON vr.user_id = u.id
          WHERE COALESCE(u.is_test_user, false) = false
          GROUP BY ("left"(u.phone_number::text, 2))
        )
 SELECT us.country_code,
    us.total_users,
    us.registered_users,
    us.new_users_today,
    us.new_users_week,
    COALESCE(ms.total_messages, 0::bigint) AS total_messages,
    COALESCE(ms.messages_today, 0::bigint) AS messages_today,
    COALESCE(ms.dau, 0::bigint) AS daily_active_users,
    COALESCE(ms.wau, 0::bigint) AS weekly_active_users,
    COALESCE(fs.lesson_plans, 0::bigint) AS total_lesson_plans,
    COALESCE(fs.coaching_sessions, 0::bigint) AS total_coaching_sessions,
    COALESCE(fs.reading_assessments, 0::bigint) AS total_reading_assessments,
    COALESCE(fs.video_requests, 0::bigint) AS total_video_requests,
    now() AS last_refreshed
   FROM user_stats us
     LEFT JOIN message_stats ms ON ms.country_code = us.country_code
     LEFT JOIN feature_stats fs ON fs.country_code = us.country_code;

CREATE UNIQUE INDEX idx_mv_dashboard_stats_by_country_pk
  ON public.mv_dashboard_stats_by_country USING btree (country_code);

-- ── rebuild: mv_users_activity ────────────────────────────────────────
CREATE MATERIALIZED VIEW public.mv_users_activity AS
 SELECT u.id,
    u.phone_number,
    "left"(u.phone_number::text, 2) AS country_code,
    lower(COALESCE(u.school_name, ''::character varying)::text) AS school_name_lower,
    COALESCE(u.is_test_user, false) AS is_test_user,
    u.name,
    u.preferred_language,
    u.registration_completed,
    u.registration_state,
    u.registration_started_at,
    u.registration_completed_at,
    u.registration_state_updated_at,
    u.created_at,
    max(c.created_at) AS last_activity,
    count(c.id) AS total_messages,
    count(c.id) FILTER (WHERE c.role::text = 'user'::text) AS user_messages,
    count(c.id) FILTER (WHERE c.message_type::text = 'voice'::text) AS voice_messages,
    now() AS last_refreshed
   FROM users u
     LEFT JOIN conversations c ON c.user_id = u.id
  GROUP BY u.id;

CREATE UNIQUE INDEX idx_mv_users_activity_id
  ON public.mv_users_activity USING btree (id);
CREATE INDEX idx_mv_users_activity_country
  ON public.mv_users_activity USING btree (country_code) WHERE (is_test_user = false);
CREATE INDEX idx_mv_users_activity_school
  ON public.mv_users_activity USING btree (school_name_lower)
  WHERE ((is_test_user = false) AND (school_name_lower <> ''::text));
CREATE INDEX idx_mv_users_activity_phone
  ON public.mv_users_activity USING btree (phone_number);
CREATE INDEX idx_mv_users_activity_last_activity
  ON public.mv_users_activity USING btree (last_activity DESC NULLS LAST);
CREATE INDEX idx_mv_users_activity_created
  ON public.mv_users_activity USING btree (created_at DESC);

-- ── rebuild: mv_view_refresh_status (depends on the two above) ────────
CREATE MATERIALIZED VIEW public.mv_view_refresh_status AS
 SELECT 'mv_dashboard_stats'::text AS view_name,
    ( SELECT mv_dashboard_stats.last_refreshed
           FROM mv_dashboard_stats
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_dashboard_stats) AS row_count
UNION ALL
 SELECT 'mv_users_activity'::text AS view_name,
    ( SELECT mv_users_activity.last_refreshed
           FROM mv_users_activity
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_users_activity) AS row_count
UNION ALL
 SELECT 'mv_retention_cohorts'::text AS view_name,
    ( SELECT mv_retention_cohorts.last_refreshed
           FROM mv_retention_cohorts
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_retention_cohorts) AS row_count
UNION ALL
 SELECT 'mv_dashboard_stats_by_country'::text AS view_name,
    ( SELECT mv_dashboard_stats_by_country.last_refreshed
           FROM mv_dashboard_stats_by_country
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM mv_dashboard_stats_by_country) AS row_count;

CREATE UNIQUE INDEX idx_mv_view_refresh_status_pk
  ON public.mv_view_refresh_status USING btree (view_name);

COMMENT ON COLUMN users.phone_number IS
  'E.164 without the +, e.g. 923001234567. Also holds the merge tombstone '
  '''merged:<uuid>'' (43 chars) written when a shell account is retired by a '
  'phone change — which is why this is varchar(64) and not varchar(20).';

-- ── the V1.4.7 sequel: 'edit_role' was left out ───────────────────────
--
-- V1.4.7 widened this CHECK for edit_name/edit_level/edit_phone/
-- edit_phone_escalated but not `edit_role`, which the same Edit flow emits.
-- Measured: 23 role changes between 17–19 Sep by 9 coaches all raised 23514
-- and wrote nothing. `_editAudit` swallows its own errors by design (a lost
-- audit row must never fail the edit), so this was silent in exactly the way
-- V1.4.7 set out to stop. The role change itself applied; only the record was
-- lost, and those rows are not recoverable.

ALTER TABLE leader_roster_audit
  DROP CONSTRAINT IF EXISTS leader_roster_audit_action_check;

ALTER TABLE leader_roster_audit
  ADD CONSTRAINT leader_roster_audit_action_check
  CHECK (action = ANY (ARRAY[
    'add', 'remove', 'move',
    'edit_name', 'edit_level', 'edit_phone', 'edit_role',
    'edit_phone_escalated'
  ]));

COMMIT;

-- ------------------------------------------------------------ prove it took
DO $$
DECLARE
  len  integer;
  def  text;
  want text;
BEGIN
  SELECT character_maximum_length INTO len
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name = 'phone_number';

  -- NULL = the column is unbounded text, which also satisfies the requirement.
  IF len IS NOT NULL AND len < 43 THEN
    RAISE EXCEPTION 'users.phone_number is varchar(%) — too narrow for the 43-char tombstone', len;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint WHERE conname = 'leader_roster_audit_action_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'leader_roster_audit_action_check is missing after the migration';
  END IF;

  FOREACH want IN ARRAY ARRAY['add','remove','move','edit_name','edit_level',
                              'edit_phone','edit_role','edit_phone_escalated'] LOOP
    IF def NOT LIKE ('%' || quote_literal(want) || '%') THEN
      RAISE EXCEPTION 'the widened CHECK does not admit %  (def: %)', want, def;
    END IF;
  END LOOP;

  -- the two matviews must be back, populated, and carrying their indexes
  FOREACH want IN ARRAY ARRAY['mv_dashboard_stats_by_country','mv_users_activity',
                              'mv_view_refresh_status'] LOOP
    IF to_regclass('public.' || want) IS NULL THEN
      RAISE EXCEPTION 'matview % was dropped and not recreated', want;
    END IF;
    IF NOT (SELECT relispopulated FROM pg_class WHERE oid = ('public.' || want)::regclass) THEN
      RAISE EXCEPTION 'matview % exists but is not populated', want;
    END IF;
  END LOOP;

  SELECT count(*) INTO len FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename IN ('mv_dashboard_stats_by_country','mv_users_activity',
                       'mv_view_refresh_status');
  IF len <> 8 THEN
    RAISE EXCEPTION 'expected 8 matview indexes after the rebuild, found %', len;
  END IF;
END $$;
