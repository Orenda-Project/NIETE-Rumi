-- NIETE sandbox schema baseline (project olvritwoqujtjvwfulbh), schema only — no rows.
-- Regenerate: bash bot/scripts/e2e/local-db.sh baseline · dumped 2026-10-07T06:20Z
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: training_attempt_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.training_attempt_status AS ENUM (
    'in_progress',
    'passed',
    'failed',
    'abandoned',
    'pending_review'
);


--
-- Name: _bd_a21ks_probe(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._bd_a21ks_probe() RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'headers', current_setting('request.headers', true),
    'claims_role', (nullif(current_setting('request.jwt.claims', true),'')::jsonb) ->> 'role',
    'claims_sub',  (nullif(current_setting('request.jwt.claims', true),'')::jsonb) ->> 'sub',
    'app_actor', current_setting('app.actor', true),
    'session_user', session_user::text, 'current_user', current_user::text)
$$;


--
-- Name: acquire_assessment_lock(uuid, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acquire_assessment_lock(p_assessment_id uuid, p_expected_status character varying) RETURNS TABLE(locked boolean, assessment_data jsonb, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_assessment RECORD;
  v_locked BOOLEAN := FALSE;
  v_data JSONB;
  v_error TEXT := NULL;
BEGIN
  -- Attempt to acquire row-level lock with SKIP LOCKED
  -- If another worker already holds the lock, this will return immediately
  SELECT * INTO v_assessment
  FROM reading_assessments
  WHERE id = p_assessment_id
    AND status = p_expected_status
  FOR UPDATE SKIP LOCKED;

  IF v_assessment.id IS NULL THEN
    -- Lock not acquired (either assessment doesn't exist, status changed, or already locked)

    -- Check if assessment exists at all
    SELECT status INTO v_assessment
    FROM reading_assessments
    WHERE id = p_assessment_id;

    IF v_assessment.status IS NULL THEN
      v_error := 'Assessment not found';
    ELSIF v_assessment.status != p_expected_status THEN
      v_error := format('Status mismatch: expected %s, found %s', p_expected_status, v_assessment.status);
    ELSE
      v_error := 'Assessment locked by another worker';
    END IF;

    locked := FALSE;
    assessment_data := NULL;
    error_message := v_error;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock acquired successfully
  -- Validate assessment age (reject if >30 minutes old)
  IF v_assessment.created_at < NOW() - INTERVAL '30 minutes' THEN
    v_error := format('Assessment too old: %s minutes',
                     EXTRACT(EPOCH FROM (NOW() - v_assessment.created_at)) / 60);
    locked := FALSE;
    assessment_data := NULL;
    error_message := v_error;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Convert assessment record to JSONB
  v_data := jsonb_build_object(
    'id', v_assessment.id,
    'user_id', v_assessment.user_id,
    'session_id', v_assessment.session_id,
    'student_identifier', v_assessment.student_identifier,
    'grade_level', v_assessment.grade_level,
    'language', v_assessment.language,
    'passage_text', v_assessment.passage_text,
    'passage_word_count', v_assessment.passage_word_count,
    'audio_url', v_assessment.audio_url,
    'audio_duration_seconds', v_assessment.audio_duration_seconds,
    'status', v_assessment.status,
    'created_at', v_assessment.created_at,
    'processing_started_at', v_assessment.processing_started_at
  );

  -- Return success
  locked := TRUE;
  assessment_data := v_data;
  error_message := NULL;
  RETURN NEXT;
END;
$$;


--
-- Name: acquire_broadcast_lock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acquire_broadcast_lock(p_broadcast_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtext(p_broadcast_id::text));
  RETURN TRUE;
END;
$$;


--
-- Name: add_soft_delete(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_soft_delete(p_table text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RAISE EXCEPTION 'add_soft_delete: no such table %', p_table;
  END IF;

  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', p_table);
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_reason text', p_table);
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by text', p_table);

  -- Partial: almost every row is live, so the index only carries tombstones.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (deleted_at) WHERE deleted_at IS NOT NULL',
    'idx_' || p_table || '_deleted_at', p_table);

  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_at IS %L', p_table,
    'Soft delete: when this row was retired. NULL = live. Read it through '
    'bot/shared/utils/soft-delete.js (isDeleted/liveOnly), never by hand.');
  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_reason IS %L', p_table,
    'Soft delete: why, as a short machine token (e.g. phone_change_merge).');
  EXECUTE format(
    'COMMENT ON COLUMN %I.deleted_by IS %L', p_table,
    'Soft delete: who (actor id) or what (process name) retired it.');
END;
$$;


--
-- Name: auto_title_conversation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_title_conversation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_is_first_user_message BOOLEAN;
  v_conversation_title VARCHAR(255);
BEGIN
  -- Only process user messages
  IF NEW.role != 'user' THEN
    RETURN NEW;
  END IF;

  -- Check if this is the first user message in the conversation
  SELECT NOT EXISTS (
    SELECT 1 FROM ama_messages
    WHERE conversation_id = NEW.conversation_id
    AND role = 'user'
    AND id != NEW.id
  ) INTO v_is_first_user_message;

  IF v_is_first_user_message THEN
    -- Truncate content to create title (max 60 chars)
    v_conversation_title := CASE
      WHEN LENGTH(NEW.content) > 60 THEN LEFT(NEW.content, 57) || '...'
      ELSE NEW.content
    END;

    UPDATE ama_conversations
    SET title = v_conversation_title
    WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: backfill_chat_sessions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_chat_sessions(p_session_timeout_minutes integer DEFAULT 30) RETURNS TABLE(total_conversations bigint, sessions_created bigint, users_processed bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_user_record RECORD;
  v_conversation_record RECORD;
  v_current_session_id UUID;
  v_last_message_time TIMESTAMP;
  v_time_gap INTERVAL;
  v_sessions_created BIGINT := 0;
  v_conversations_processed BIGINT := 0;
  v_users_processed BIGINT := 0;
BEGIN
  -- Process each user
  FOR v_user_record IN
    SELECT DISTINCT user_id FROM conversations WHERE session_id IS NULL ORDER BY user_id
  LOOP
    v_users_processed := v_users_processed + 1;
    v_current_session_id := NULL;
    v_last_message_time := NULL;

    -- Process conversations for this user in chronological order
    FOR v_conversation_record IN
      SELECT id, created_at
      FROM conversations
      WHERE user_id = v_user_record.user_id AND session_id IS NULL
      ORDER BY created_at ASC
    LOOP
      -- Calculate time gap
      IF v_last_message_time IS NOT NULL THEN
        v_time_gap := v_conversation_record.created_at - v_last_message_time;
      END IF;

      -- Create new session if needed
      IF v_current_session_id IS NULL OR
         (v_time_gap IS NOT NULL AND v_time_gap > (p_session_timeout_minutes || ' minutes')::INTERVAL) THEN

        -- End previous session if exists
        IF v_current_session_id IS NOT NULL THEN
          UPDATE chat_sessions
          SET ended_at = v_last_message_time
          WHERE id = v_current_session_id;
        END IF;

        -- Create new session
        INSERT INTO chat_sessions (user_id, started_at, last_activity_at)
        VALUES (v_user_record.user_id, v_conversation_record.created_at, v_conversation_record.created_at)
        RETURNING id INTO v_current_session_id;

        v_sessions_created := v_sessions_created + 1;
      END IF;

      -- Assign conversation to current session
      UPDATE conversations
      SET session_id = v_current_session_id
      WHERE id = v_conversation_record.id;

      -- Update session's last_activity_at
      UPDATE chat_sessions
      SET last_activity_at = v_conversation_record.created_at,
          message_count = message_count + 1
      WHERE id = v_current_session_id;

      v_last_message_time := v_conversation_record.created_at;
      v_conversations_processed := v_conversations_processed + 1;
    END LOOP;

    -- Mark the last session as ended
    IF v_current_session_id IS NOT NULL THEN
      UPDATE chat_sessions
      SET ended_at = v_last_message_time
      WHERE id = v_current_session_id AND ended_at IS NULL;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_conversations_processed, v_sessions_created, v_users_processed;
END;
$$;


--
-- Name: calculate_attendance_percentage(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_attendance_percentage(p_present_count integer, p_total_students integer) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_total_students <= 0 THEN
    RETURN 0;
  END IF;
  RETURN ROUND((p_present_count::DECIMAL / p_total_students * 100), 2);
END;
$$;


--
-- Name: calculate_retention(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_retention(p_feature_type text DEFAULT 'overall'::text, p_start_date date DEFAULT (CURRENT_DATE - '84 days'::interval), p_end_date date DEFAULT CURRENT_DATE) RETURNS TABLE(cohort_week date, cohort_size bigint, day0_activation_pct numeric, week1_users bigint, week1_pct numeric, week2_users bigint, week2_pct numeric, week3_users bigint, week3_pct numeric, week4_users bigint, week4_pct numeric, week5_8_users bigint, week5_8_pct numeric, week9_12_users bigint, week9_12_pct numeric, has_week2_data boolean, has_week3_data boolean, has_week4_data boolean, has_week5_8_data boolean, has_week9_12_data boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH cohorts AS (
    -- Define weekly cohorts using created_at (ALL users)
    SELECT
      u.id as user_id,
      DATE_TRUNC('week', u.created_at)::DATE as cohort_week,
      u.created_at as user_start_date
    FROM users u
    WHERE u.created_at IS NOT NULL
      AND u.created_at >= p_start_date
      AND u.created_at <= p_end_date
  ),
  activity_timeline AS (
    -- Build activity timeline based on feature type
    SELECT
      user_id,
      created_at as activity_date,
      'coaching' as activity_type
    FROM coaching_sessions
    WHERE status = 'completed'
      AND (p_feature_type = 'overall' OR p_feature_type = 'coaching')

    UNION ALL

    SELECT
      user_id,
      created_at as activity_date,
      'lesson_plan' as activity_type
    FROM lesson_plans
    WHERE (p_feature_type = 'overall' OR p_feature_type = 'lesson_plans')

    UNION ALL

    SELECT
      user_id,
      created_at as activity_date,
      'reading_assessment' as activity_type
    FROM reading_assessments
    WHERE status = 'completed'
      AND (p_feature_type = 'overall' OR p_feature_type = 'reading')

    UNION ALL

    -- Include conversations for overall activity tracking
    SELECT
      user_id,
      created_at as activity_date,
      'conversation' as activity_type
    FROM conversations
    WHERE p_feature_type = 'overall'
  ),
  retention_buckets AS (
    SELECT
      c.cohort_week,
      c.user_id,

      -- Day 0 (registration day) activity
      BOOL_OR(CASE
        WHEN a.activity_date::DATE = c.user_start_date::DATE
        THEN true ELSE false
      END) as active_day0,

      -- Week 1 (days 1-7) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '1 day'
          AND a.activity_date < c.user_start_date + INTERVAL '8 days'
        THEN true ELSE false
      END) as active_week1,

      -- Week 2 (days 8-14) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '8 days'
          AND a.activity_date < c.user_start_date + INTERVAL '15 days'
        THEN true ELSE false
      END) as active_week2,

      -- Week 3 (days 15-21) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '15 days'
          AND a.activity_date < c.user_start_date + INTERVAL '22 days'
        THEN true ELSE false
      END) as active_week3,

      -- Week 4 (days 22-28) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '22 days'
          AND a.activity_date < c.user_start_date + INTERVAL '29 days'
        THEN true ELSE false
      END) as active_week4,

      -- Week 5-8 (days 29-56) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '29 days'
          AND a.activity_date < c.user_start_date + INTERVAL '57 days'
        THEN true ELSE false
      END) as active_week5_8,

      -- Week 9-12 (days 57-84) activity
      BOOL_OR(CASE
        WHEN a.activity_date >= c.user_start_date + INTERVAL '57 days'
          AND a.activity_date < c.user_start_date + INTERVAL '85 days'
        THEN true ELSE false
      END) as active_week9_12

    FROM cohorts c
    LEFT JOIN activity_timeline a ON c.user_id = a.user_id
    GROUP BY c.cohort_week, c.user_id
  )
  SELECT
    rb.cohort_week,
    COUNT(DISTINCT rb.user_id) as cohort_size,

    -- Day 0 activation percentage (feature usage on registration day)
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_day0) / COUNT(DISTINCT rb.user_id), 1) as day0_activation_pct,

    -- Week 1 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week1) as week1_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week1) / COUNT(DISTINCT rb.user_id), 1) as week1_pct,

    -- Week 2 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week2) as week2_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week2) / COUNT(DISTINCT rb.user_id), 1) as week2_pct,

    -- Week 3 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week3) as week3_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week3) / COUNT(DISTINCT rb.user_id), 1) as week3_pct,

    -- Week 4 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week4) as week4_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week4) / COUNT(DISTINCT rb.user_id), 1) as week4_pct,

    -- Week 5-8 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week5_8) as week5_8_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week5_8) / COUNT(DISTINCT rb.user_id), 1) as week5_8_pct,

    -- Week 9-12 retention
    COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week9_12) as week9_12_users,
    ROUND(100.0 * COUNT(DISTINCT rb.user_id) FILTER (WHERE rb.active_week9_12) / COUNT(DISTINCT rb.user_id), 1) as week9_12_pct,

    -- Maturity flags (is cohort old enough for this time bucket?)
    (CURRENT_DATE >= rb.cohort_week + INTERVAL '14 days') as has_week2_data,
    (CURRENT_DATE >= rb.cohort_week + INTERVAL '21 days') as has_week3_data,
    (CURRENT_DATE >= rb.cohort_week + INTERVAL '28 days') as has_week4_data,
    (CURRENT_DATE >= rb.cohort_week + INTERVAL '56 days') as has_week5_8_data,
    (CURRENT_DATE >= rb.cohort_week + INTERVAL '84 days') as has_week9_12_data

  FROM retention_buckets rb
  GROUP BY rb.cohort_week
  ORDER BY rb.cohort_week DESC;
END;
$$;


--
-- Name: calculate_wcpm(integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_wcpm(p_words_correct integer, p_time_seconds double precision) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
BEGIN
  IF p_time_seconds <= 0 THEN
    RETURN 0;
  END IF;

  RETURN ROUND((p_words_correct::FLOAT / p_time_seconds * 60)::NUMERIC, 2);
END;
$$;


--
-- Name: check_benchmark_status(double precision, integer, character varying, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_benchmark_status(p_wcpm double precision, p_grade integer, p_language character varying DEFAULT 'en'::character varying, p_is_l2 boolean DEFAULT true) RETURNS TABLE(benchmark_min integer, benchmark_max integer, on_track boolean, percentile_rank integer)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_season VARCHAR(10);
  v_language VARCHAR(5);
  v_wcpm INTEGER;
  v_percentile INTEGER;
  v_min INTEGER;
  v_max INTEGER;
  v_on_track BOOLEAN;
BEGIN
  -- Determine season based on current month (approximate)
  -- Fall: Aug-Nov, Winter: Dec-Feb, Spring: Mar-Jun
  CASE EXTRACT(MONTH FROM CURRENT_DATE)
    WHEN 8, 9, 10, 11 THEN v_season := 'fall';
    WHEN 12, 1, 2 THEN v_season := 'winter';
    ELSE v_season := 'spring';
  END CASE;

  -- Adjust language for lookup (Urdu uses L2-adjusted norms)
  IF p_language = 'ur' AND p_is_l2 THEN
    v_language := 'ur';
  ELSE
    v_language := 'en';
  END IF;

  -- Round WCPM for lookup
  v_wcpm := ROUND(p_wcpm);

  -- Get benchmark range (25th and 75th percentile)
  SELECT
    p25.wcpm_threshold,
    p75.wcpm_threshold
  INTO v_min, v_max
  FROM wcpm_percentiles p25
  CROSS JOIN wcpm_percentiles p75
  WHERE p25.grade_level = p_grade
    AND p25.language = v_language
    AND p25.season = v_season
    AND p25.percentile = 25
    AND p75.grade_level = p_grade
    AND p75.language = v_language
    AND p75.season = v_season
    AND p75.percentile = 75;

  -- If no data found, use fallback benchmarks
  IF v_min IS NULL THEN
    CASE p_grade
      WHEN 1 THEN v_min := 12; v_max := 34;
      WHEN 2 THEN v_min := 51; v_max := 89;
      WHEN 3 THEN v_min := 71; v_max := 107;
      ELSE v_min := 50; v_max := 100;
    END CASE;

    -- Adjust for Urdu L2
    IF v_language = 'ur' THEN
      v_min := ROUND(v_min * 0.70);
      v_max := ROUND(v_max * 0.70);
    END IF;
  END IF;

  -- Determine on-track status (25th percentile or above)
  v_on_track := v_wcpm >= v_min;

  -- Calculate percentile using lookup table
  -- Find highest percentile where student meets/exceeds threshold
  SELECT COALESCE(MAX(percentile), 10)
  INTO v_percentile
  FROM wcpm_percentiles
  WHERE grade_level = p_grade
    AND language = v_language
    AND season = v_season
    AND wcpm_threshold <= v_wcpm;

  -- Handle edge cases
  IF v_wcpm = 0 THEN
    v_percentile := 1;
  ELSIF v_percentile < 10 THEN
    v_percentile := 10;
  END IF;

  -- Return results
  benchmark_min := v_min;
  benchmark_max := v_max;
  on_track := v_on_track;
  percentile_rank := v_percentile;

  RETURN NEXT;
END;
$$;


--
-- Name: check_lcpm_benchmark_status(double precision, integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_lcpm_benchmark_status(p_lcpm double precision, p_grade integer, p_language character varying) RETURNS TABLE(benchmark_min integer, benchmark_max integer, on_track boolean, percentile_rank integer, metric_name character varying, metric_display_name character varying)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_benchmarks lcpm_benchmarks%ROWTYPE;
  v_percentile INTEGER;
BEGIN
  -- Get fall benchmarks (conservative, start of year)
  SELECT * INTO v_benchmarks
  FROM lcpm_benchmarks
  WHERE grade_level = p_grade
    AND language = COALESCE(p_language, 'en')
    AND season = 'fall'
  LIMIT 1;

  -- If no benchmark found, use defaults
  IF v_benchmarks IS NULL THEN
    benchmark_min := 20;
    benchmark_max := 60;
    on_track := p_lcpm >= 20;
    percentile_rank := 50;
    metric_name := 'LCPM';
    metric_display_name := 'Letters Correct Per Minute';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Calculate percentile
  IF p_lcpm < v_benchmarks.percentile_5 THEN
    v_percentile := 5;
  ELSIF p_lcpm < v_benchmarks.percentile_10 THEN
    v_percentile := 10;
  ELSIF p_lcpm < v_benchmarks.percentile_25 THEN
    v_percentile := 25;
  ELSIF p_lcpm < v_benchmarks.percentile_50 THEN
    v_percentile := 50;
  ELSIF p_lcpm < v_benchmarks.percentile_75 THEN
    v_percentile := 75;
  ELSIF p_lcpm < v_benchmarks.percentile_90 THEN
    v_percentile := 90;
  ELSE
    v_percentile := 95;
  END IF;

  -- Return results
  benchmark_min := v_benchmarks.percentile_25;  -- 25th percentile as minimum target
  benchmark_max := v_benchmarks.percentile_75;  -- 75th percentile as stretch goal
  on_track := p_lcpm >= v_benchmarks.percentile_25;  -- On track if above 25th percentile
  percentile_rank := v_percentile;
  metric_name := 'LCPM';
  metric_display_name := 'Letters Correct Per Minute';

  RETURN NEXT;
END;
$$;


--
-- Name: child_test_blocks_keep_marks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.child_test_blocks_keep_marks() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.ai_marks IS NOT NULL AND (
       NEW.ai_marks IS DISTINCT FROM OLD.ai_marks
    OR NEW.ai_status IS DISTINCT FROM OLD.ai_status
    OR NEW.ai_model_versions IS DISTINCT FROM OLD.ai_model_versions
    OR NEW.ai_scored_at IS DISTINCT FROM OLD.ai_scored_at
    OR NEW.transcript IS DISTINCT FROM OLD.transcript
    OR NEW.audio_r2_key IS DISTINCT FROM OLD.audio_r2_key
    OR NEW.photo_r2_key IS DISTINCT FROM OLD.photo_r2_key
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the AI marks are written once', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.checked_at IS NOT NULL AND (
       NEW.checked_at IS DISTINCT FROM OLD.checked_at
    OR NEW.coach_marks IS DISTINCT FROM OLD.coach_marks
    OR NEW.coach_edits IS DISTINCT FROM OLD.coach_edits
  ) THEN
    RAISE EXCEPTION 'child_test_blocks %: the coach check is submitted once', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: child_test_draws_keep_rank(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.child_test_draws_keep_rank() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.draw_rank IS DISTINCT FROM OLD.draw_rank
    OR NEW.frame_size IS DISTINCT FROM OLD.frame_size
    OR NEW.seed_digest IS DISTINCT FROM OLD.seed_digest
    OR NEW.algo_version IS DISTINCT FROM OLD.algo_version
    OR NEW.student_id IS DISTINCT FROM OLD.student_id
    OR NEW.class_id IS DISTINCT FROM OLD.class_id
    OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
    OR NEW.sample_role IS DISTINCT FROM OLD.sample_role
    OR NEW.form IS DISTINCT FROM OLD.form THEN
    RAISE EXCEPTION 'child_test_draws %: a drawn rank cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: child_test_draws_name_visit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.child_test_draws_name_visit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.list_slot IS NOT NULL AND NEW.status = 'listed'
    AND num_nonnulls(NEW.last_listed_visit_id, NEW.visit_key) = 0 THEN
    RAISE EXCEPTION 'child_test_draws %: a listed child must name its visit (last_listed_visit_id or visit_key)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: child_test_sessions_name_visit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.child_test_sessions_name_visit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF num_nonnulls(NEW.visit_id, NEW.visit_key) = 0 THEN
    RAISE EXCEPTION 'child_test_sessions: a session must name its visit (visit_id or visit_key)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: claim_next_coaching_job(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_next_coaching_job(p_worker_id text, p_max_attempts integer DEFAULT 3) RETURNS TABLE(id uuid, coaching_session_id uuid, job_type text, payload jsonb, status text, attempts integer, max_attempts integer, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- Find and claim next available job using SELECT FOR UPDATE SKIP LOCKED
  -- This prevents race conditions in distributed worker environments
  SELECT cj.id INTO v_job_id
  FROM coaching_jobs cj
  WHERE cj.status = 'pending'
    AND cj.scheduled_for <= now()
    AND cj.attempts < p_max_attempts
  ORDER BY cj.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- If no job found, return empty
  IF v_job_id IS NULL THEN
    RETURN;
  END IF;

  -- Update job status to processing
  UPDATE coaching_jobs
  SET
    status = 'processing',
    started_at = now(),
    worker_id = p_worker_id,
    attempts = coaching_jobs.attempts + 1
  WHERE coaching_jobs.id = v_job_id;

  -- Return the claimed job
  RETURN QUERY
  SELECT
    cj.id,
    cj.coaching_session_id,
    cj.job_type,
    cj.payload,
    cj.status,
    cj.attempts,
    cj.max_attempts,
    cj.created_at
  FROM coaching_jobs cj
  WHERE cj.id = v_job_id;
END;
$$;


--
-- Name: cleanup_old_coaching_jobs(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_coaching_jobs(p_days_old integer DEFAULT 30) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM coaching_jobs
  WHERE status IN ('completed', 'failed')
    AND completed_at < now() - (p_days_old || ' days')::interval;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN v_deleted_count;
END;
$$;


--
-- Name: complete_coaching_job(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_coaching_job(p_job_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE coaching_jobs
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = p_job_id;
END;
$$;


--
-- Name: exec_sql(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.exec_sql(query text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ BEGIN EXECUTE query; END; $$;


--
-- Name: fail_coaching_job(uuid, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_coaching_job(p_job_id uuid, p_error_message text, p_error_stack text DEFAULT NULL::text, p_retry_delay_seconds integer DEFAULT 60) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_attempts INTEGER;
  v_max_attempts INTEGER;
BEGIN
  -- Get current attempt count
  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM coaching_jobs
  WHERE id = p_job_id;

  -- Check if we should retry
  IF v_attempts < v_max_attempts THEN
    -- Retry: Set back to pending with delay
    UPDATE coaching_jobs
    SET
      status = 'pending',
      error_message = p_error_message,
      error_stack = p_error_stack,
      scheduled_for = now() + (p_retry_delay_seconds || ' seconds')::interval
    WHERE id = p_job_id;
  ELSE
    -- Max attempts reached: Mark as permanently failed
    UPDATE coaching_jobs
    SET
      status = 'failed',
      completed_at = now(),
      error_message = p_error_message,
      error_stack = p_error_stack
    WHERE id = p_job_id;
  END IF;
END;
$$;


--
-- Name: get_attendance_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_attendance_summary(p_list_id uuid, p_start_date date, p_end_date date) RETURNS TABLE(total_sessions integer, avg_attendance_percentage numeric, total_present integer, total_absent integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_sessions,
    ROUND(AVG(
      CASE WHEN total_students > 0
        THEN (present_count::DECIMAL / total_students * 100)
        ELSE 0
      END
    ), 2) as avg_attendance_percentage,
    SUM(present_count)::INTEGER as total_present,
    SUM(absent_count)::INTEGER as total_absent
  FROM attendance_sessions
  WHERE list_id = p_list_id
    AND session_date BETWEEN p_start_date AND p_end_date;
END;
$$;


--
-- Name: get_broadcast_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_broadcast_counts(p_broadcast_id uuid) RETURNS TABLE(delivered_count integer, read_count integer, failed_count integer, replied_count integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status IN ('delivered', 'read'))::INT AS delivered_count,
    COUNT(*) FILTER (WHERE status = 'read')::INT AS read_count,
    COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed_count,
    COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::INT AS replied_count
  FROM broadcast_messages
  WHERE broadcast_id = p_broadcast_id;
END;
$$;


--
-- Name: get_or_create_session(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_session(p_user_id uuid, p_session_timeout_minutes integer DEFAULT 30) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_session_id UUID;
  v_last_activity TIMESTAMP;
  v_time_since_last_activity INTERVAL;
BEGIN
  -- Get the most recent session for this user
  SELECT id, last_activity_at INTO v_session_id, v_last_activity
  FROM chat_sessions
  WHERE user_id = p_user_id
    AND ended_at IS NULL
  ORDER BY last_activity_at DESC
  LIMIT 1;

  -- Calculate time since last activity
  IF v_last_activity IS NOT NULL THEN
    v_time_since_last_activity := NOW() - v_last_activity;
  END IF;

  -- If no session exists or session timed out, create new session
  IF v_session_id IS NULL OR v_time_since_last_activity > (p_session_timeout_minutes || ' minutes')::INTERVAL THEN
    -- End the old session if it exists
    IF v_session_id IS NOT NULL THEN
      UPDATE chat_sessions
      SET ended_at = v_last_activity
      WHERE id = v_session_id;
    END IF;

    -- Create new session
    INSERT INTO chat_sessions (user_id, started_at, last_activity_at)
    VALUES (p_user_id, NOW(), NOW())
    RETURNING id INTO v_session_id;
  ELSE
    -- Update last_activity_at for existing session
    UPDATE chat_sessions
    SET last_activity_at = NOW()
    WHERE id = v_session_id;
  END IF;

  RETURN v_session_id;
END;
$$;


--
-- Name: get_portal_users(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_portal_users(p_portal_user_id uuid) RETURNS TABLE(id uuid, phone_number text, name text, school_name text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM set_config('app.portal_user_id', p_portal_user_id::text, true);
  RETURN QUERY
  SELECT
    u.id,
    u.phone_number::text,
    u.name::text,
    u.school_name::text
  FROM users u;
END;
$$;


--
-- Name: get_users_with_last_activity(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_users_with_last_activity(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, phone_number text, name text, registration_completed boolean, registration_state text, registration_started_at timestamp with time zone, registration_completed_at timestamp with time zone, registration_state_updated_at timestamp with time zone, created_at timestamp with time zone, last_conversation_at timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    u.id,
    u.phone_number,
    u.name,
    u.registration_completed,
    u.registration_state,
    u.registration_started_at,
    u.registration_completed_at,
    u.registration_state_updated_at,
    u.created_at,
    MAX(c.created_at) as last_conversation_at
  FROM users u
  LEFT JOIN conversations c ON c.user_id = u.id
  GROUP BY
    u.id, u.phone_number, u.name, u.registration_completed, u.registration_state,
    u.registration_started_at, u.registration_completed_at,
    u.registration_state_updated_at, u.created_at
  ORDER BY COALESCE(MAX(c.created_at), u.created_at) DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;


--
-- Name: increment_broadcast_count(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_broadcast_count(p_broadcast_id uuid, p_column_name text) RETURNS void
    LANGUAGE plpgsql
    AS $_$
BEGIN
  -- Only allow specific column names for security
  IF p_column_name NOT IN ('sent_count', 'delivered_count', 'read_count', 'failed_count', 'replied_count') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column_name;
  END IF;

  EXECUTE format('UPDATE broadcast_logs SET %I = %I + 1 WHERE id = $1', p_column_name, p_column_name)
    USING p_broadcast_id;
END;
$_$;


--
-- Name: increment_quiz_completions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_quiz_completions(quiz_id_param uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE quizzes
  SET total_students_sent = COALESCE(total_students_sent, 0) + 1
  WHERE id = quiz_id_param;
END;
$$;


--
-- Name: increment_replied_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_replied_count(p_broadcast_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE broadcast_logs
  SET replied_count = replied_count + 1
  WHERE id = p_broadcast_id;
END;
$$;


--
-- Name: increment_share_code_uses(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_share_code_uses(code_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.quiz_share_codes
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE id = code_id;
END;
$$;


--
-- Name: increment_turn_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_turn_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only increment turn count when assistant responds (completing a turn)
  IF NEW.role = 'assistant' AND NEW.session_id IS NOT NULL THEN
    UPDATE chat_sessions
    SET turn_count = turn_count + 1
    WHERE id = NEW.session_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: increment_variant_impressions(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_variant_impressions(p_test_id uuid, p_variant_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE ab_test_variants
  SET impressions = COALESCE(impressions, 0) + 1,
      updated_at = now()
  WHERE test_id = p_test_id AND variant_name = p_variant_name;
END;
$$;


--
-- Name: is_invitation_valid(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_invitation_valid(p_token character varying) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_status VARCHAR;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT status, expires_at
  INTO v_status, v_expires_at
  FROM invitations
  WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_status != 'pending' THEN
    RETURN FALSE;
  END IF;

  IF v_expires_at < NOW() THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;


--
-- Name: log_broadcast_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_broadcast_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only log status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.audit_trail = COALESCE(OLD.audit_trail, '[]'::JSONB) ||
      jsonb_build_object(
        'timestamp', NOW(),
        'old_status', OLD.status,
        'new_status', NEW.status
      );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: log_row_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_row_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  key_col text := TG_ARGV[0];                        -- the row's primary key column
  watched text[] := TG_ARGV[1:array_upper(TG_ARGV,1)];
  changed text[] := '{}';
  o jsonb := '{}';
  n jsonb := '{}';
  col text;
  jold jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  jnew jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  rid text;
  claims_txt text := nullif(current_setting('request.jwt.claims', true), '');
  claims jsonb;
  jwt_sub text;
  jwt_role text;
  app_actor text := nullif(current_setting('app.actor', true), '');
  hdr_txt text := nullif(current_setting('request.headers', true), '');
  hdr_actor text;
  v_actor text;
  v_source text;
BEGIN
  rid := COALESCE(jnew -> key_col, jold -> key_col) #>> '{}';
  IF rid IS NULL THEN
    RAISE EXCEPTION 'log_row_changes: table %.% has no key column %',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, key_col;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH col IN ARRAY watched LOOP
      IF jold -> col IS DISTINCT FROM jnew -> col THEN
        changed := changed || col;
        o := o || jsonb_build_object(col, jold -> col);
        n := n || jsonb_build_object(col, jnew -> col);
      END IF;
    END LOOP;
    IF cardinality(changed) = 0 THEN
      RETURN NULL;                                   -- nothing watched moved
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, jnew -> k), '{}')
      INTO changed, n FROM unnest(watched) k WHERE jnew ? k;
  ELSE
    SELECT coalesce(array_agg(k), '{}'), coalesce(jsonb_object_agg(k, jold -> k), '{}')
      INTO changed, o FROM unnest(watched) k WHERE jold ? k;
  END IF;

  -- ── who ──
  -- Malformed claims/headers degrade to "unknown", never to a failed write: the
  -- ledger must never be the reason a roster did not save.
  BEGIN
    claims := claims_txt::jsonb;
  EXCEPTION WHEN others THEN
    claims := CASE WHEN claims_txt IS NULL THEN NULL ELSE '{}'::jsonb END;
  END;
  jwt_sub  := nullif(claims ->> 'sub', '');
  jwt_role := claims ->> 'role';
  BEGIN
    hdr_actor := lower(nullif(hdr_txt::jsonb ->> 'x-rumi-actor', ''));
  EXCEPTION WHEN others THEN
    hdr_actor := NULL;
  END;
  IF hdr_actor IS NOT NULL AND hdr_actor !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    hdr_actor := NULL;                               -- a users.id or nothing
  END IF;

  IF jwt_sub IS NOT NULL THEN
    v_actor := jwt_sub;            v_source := 'postgrest';
  ELSIF app_actor IS NOT NULL THEN
    v_actor := app_actor;          v_source := 'service_role';
  ELSIF hdr_actor IS NOT NULL AND jwt_role = 'service_role' THEN
    v_actor := hdr_actor;          v_source := 'service_role';
  ELSIF claims IS NOT NULL THEN
    v_actor := session_user::text; v_source := 'postgrest';   -- unchanged legacy shape
  ELSE
    v_actor := session_user::text; v_source := 'sql';
  END IF;

  INSERT INTO public.record_history
    (table_name, row_id, op, changed_cols, old_vals, new_vals, actor, actor_source)
  VALUES (TG_TABLE_NAME, rid, TG_OP, changed, nullif(o,'{}'), nullif(n,'{}'), v_actor, v_source);
  RETURN NULL;
END;
$_$;


--
-- Name: lp612_claim_waiters(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lp612_claim_waiters(p_render_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_waiters JSONB;
BEGIN
  -- Take the row lock FIRST and read under it. A concurrent lp612_join_waiters() blocks here
  -- until this transaction commits, so no append can slip between the read and the clear.
  SELECT waiters INTO v_waiters
    FROM niete_lp612_renders
   WHERE id = p_render_id
     FOR UPDATE;

  -- A render row deleted under a running job is not an error worth throwing: the job has nothing
  -- to deliver to and the caller must not crash on the way to saying so.
  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  UPDATE niete_lp612_renders
     SET waiters    = '[]'::jsonb,
         updated_at = NOW()
   WHERE id = p_render_id;

  -- The list as it stood the instant before it was emptied. This is the delivery audience.
  RETURN COALESCE(v_waiters, '[]'::jsonb);
END;
$$;


--
-- Name: lp612_join_waiters(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lp612_join_waiters(p_render_id uuid, p_entry jsonb) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_updated INTEGER;
  v_status  TEXT;
BEGIN
  -- ONE statement. The row lock serialises concurrent callers and `waiters` is re-read under it,
  -- so an append can never be computed from a stale copy.
  UPDATE niete_lp612_renders
     SET waiters    = waiters || jsonb_build_array(p_entry),
         updated_at = NOW()
   WHERE id = p_render_id
     AND status = 'authoring'
     -- Tapping twice must not mean being sent the lesson twice. Deduped on PHONE, because that is
     -- what delivery actually uses and it is present for every caller; user_id may be null.
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(waiters) AS w
        WHERE w->>'phone' IS NOT DISTINCT FROM p_entry->>'phone'
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 1 THEN
    RETURN 'joined';
  END IF;

  SELECT status INTO v_status FROM niete_lp612_renders WHERE id = p_render_id;
  IF v_status IS NULL       THEN RETURN 'missing';       END IF;
  IF v_status <> 'authoring' THEN RETURN 'not_authoring'; END IF;
  RETURN 'duplicate';
END;
$$;


--
-- Name: lp_latency_stats(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lp_latency_stats(p_source text, p_lookback_hours integer DEFAULT 168) RETURNS TABLE(p50_ms integer, p90_ms integer, sample_size integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY delivery_time_ms), 0)::int AS p50_ms,
    COALESCE(PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY delivery_time_ms), 0)::int AS p90_ms,
    COUNT(*)::int AS sample_size
  FROM lesson_plans
  WHERE source = p_source
    AND delivery_time_ms IS NOT NULL
    AND delivery_time_ms > 0
    AND created_at > NOW() - (p_lookback_hours || ' hours')::INTERVAL;
END;
$$;


--
-- Name: observation_field_forms_keep_seal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.observation_field_forms_keep_seal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.sealed_at IS NOT NULL AND (
       NEW.sealed_at IS DISTINCT FROM OLD.sealed_at
    OR NEW.answers IS DISTINCT FROM OLD.answers
    OR NEW.period_minutes IS DISTINCT FROM OLD.period_minutes
    OR NEW.part1_done_at IS DISTINCT FROM OLD.part1_done_at
    OR NEW.part2_done_at IS DISTINCT FROM OLD.part2_done_at
    OR NEW.observer_user_id IS DISTINCT FROM OLD.observer_user_id
  ) THEN
    RAISE EXCEPTION 'observation_field_forms %: a sealed record cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: queue_coaching_job(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_coaching_job(p_session_id uuid, p_job_type text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_job_id UUID;
BEGIN
  -- Insert job
  INSERT INTO coaching_jobs (
    coaching_session_id,
    job_type,
    payload,
    status,
    created_at,
    scheduled_for
  ) VALUES (
    p_session_id,
    p_job_type,
    p_payload,
    'pending',
    now(),
    now()
  )
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;


--
-- Name: refresh_dashboard_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_dashboard_views() RETURNS TABLE(view_name text, refresh_status text, duration_ms integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
BEGIN
  -- SINGLE-FLIGHT (bd-ri5o9.7). The dashboard runs multiple replicas and every
  -- one of them called this on the same ~5-minute tick: production logs show
  -- four invocations a second apart, ~1,150 a day. While the refresh failed
  -- instantly that was merely noisy; now that it actually runs, concurrent
  -- callers would stack long transactions on top of each other -- which is the
  -- precise mechanism that wedged this database on 24/25 Aug.
  --
  -- xact-scoped on purpose: the transaction pooler (6543) gives no session
  -- continuity, so a session-scoped lock could never be released reliably.
  -- Auto-releases at transaction end, including on error.
  IF NOT pg_try_advisory_xact_lock(hashtext('refresh_dashboard_views')::bigint) THEN
    RETURN QUERY SELECT 'all'::TEXT, 'skipped: refresh already running'::TEXT, 0;
    RETURN;
  END IF;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_dashboard_stats'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    -- Still caught so one bad view cannot stop the rest, but RAISE WARNING makes
    -- it visible: the silent swallow is why mv_dashboard_stats sat unrefreshed
    -- from 11 July to 28 August without anyone noticing.
    RAISE WARNING 'refresh_dashboard_views: mv_dashboard_stats failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_dashboard_stats'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_users_activity;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_users_activity'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_users_activity failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_users_activity'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_retention_cohorts;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_retention_cohorts'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_retention_cohorts failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_retention_cohorts'::TEXT, SQLERRM::TEXT, 0;
  END;

  start_time := clock_timestamp();
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_view_refresh_status;
    end_time := clock_timestamp();
    RETURN QUERY SELECT 'mv_view_refresh_status'::TEXT, 'success'::TEXT,
      EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'refresh_dashboard_views: mv_view_refresh_status failed: %', SQLERRM;
    RETURN QUERY SELECT 'mv_view_refresh_status'::TEXT, SQLERRM::TEXT, 0;
  END;
END;
$$;


--
-- Name: release_broadcast_lock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_broadcast_lock(p_broadcast_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(p_broadcast_id::text));
END;
$$;


--
-- Name: roster_apply_edits(uuid, text, uuid, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_apply_edits(p_class_id uuid, p_run_id text, p_edited_by uuid, p_updates jsonb DEFAULT '[]'::jsonb, p_moves jsonb DEFAULT '[]'::jsonb, p_adds jsonb DEFAULT '[]'::jsonb, p_removes jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_school uuid;
  v_list uuid;
  v_updated int := 0;
  v_moved int := 0;
  v_added int := 0;
  v_removed int := 0;
  v_deactivated int := 0;
BEGIN
  IF p_class_id IS NULL OR p_run_id IS NULL OR p_edited_by IS NULL THEN
    RAISE EXCEPTION 'roster_apply_edits: p_class_id, p_run_id and p_edited_by are required';
  END IF;

  PERFORM set_config('lock_timeout', '5000', true);
  -- bd-a21ks: the ledger names the coach. Transaction-local, so it is gone the
  -- moment this call ends and can never leak to the next borrower of a pooled
  -- connection. Wins over the x-rumi-actor header (same value from the bot) and
  -- holds even when this function is called from somewhere that sends no header.
  PERFORM set_config('app.actor', p_edited_by::text, true);
  -- THE SAME KEY as roster_import_students, deliberately.
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  -- One edit session applies once. Adds are the non-idempotent part; the whole
  -- session short-circuits so a double-tapped Save is a clean replay.
  IF EXISTS (SELECT 1 FROM students WHERE import_run_id = p_run_id) THEN
    RETURN jsonb_build_object('updated', 0, 'moved', 0, 'added', 0, 'removed', 0, 'replay', true);
  END IF;

  SELECT school_id INTO v_school FROM classes WHERE id = p_class_id;
  SELECT id INTO v_list FROM student_lists
  WHERE class_id = p_class_id AND is_active ORDER BY created_at LIMIT 1;

  -- Corrections. Only children actually enrolled in THIS class can be touched.
  WITH u AS (
    SELECT (x->>'id')::uuid AS id,
           nullif(btrim(coalesce(x->>'student_name', '')), '') AS student_name,
           nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name
    FROM jsonb_array_elements(p_updates) AS t(x)
  )
  UPDATE students s
  SET student_name = coalesce(u.student_name, s.student_name),
      father_name = u.father_name,
      updated_at = now()
  FROM u
  WHERE s.id = u.id
    AND EXISTS (SELECT 1 FROM class_enrollments ce
                WHERE ce.class_id = p_class_id AND ce.student_id = s.id AND ce.is_active);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Roll corrections: the SAME child moves. A roll already held by another
  -- active child is refused silently (the review screen shows the truth after).
  WITH m AS (
    SELECT (x->>'id')::uuid AS id,
           CASE WHEN coalesce(x->>'roll', '') ~ '^\d{1,3}$' THEN (x->>'roll')::int END AS roll
    FROM jsonb_array_elements(p_moves) AS t(x)
  ),
  moved AS (
    UPDATE class_enrollments ce
    SET roll_number = m.roll, updated_at = now()
    FROM m
    WHERE ce.class_id = p_class_id AND ce.student_id = m.id AND ce.is_active
      AND m.roll IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM class_enrollments o
                      WHERE o.class_id = p_class_id AND o.is_active
                        AND o.roll_number = m.roll AND o.student_id <> m.id)
    RETURNING ce.student_id, ce.roll_number
  )
  UPDATE students s
  SET roll_number = moved.roll_number, updated_at = now()
  FROM moved WHERE s.id = moved.student_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Children the register missed. Same insert shape as the import; a taken roll
  -- is refused rather than doubled (the layer-2 unique index will also refuse).
  WITH a AS (
    SELECT nullif(btrim(coalesce(x->>'student_name', '')), '') AS student_name,
           nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name,
           CASE WHEN coalesce(x->>'roll', '') ~ '^\d{1,3}$' THEN (x->>'roll')::int END AS roll
    FROM jsonb_array_elements(p_adds) AS t(x)
  ),
  ok AS (
    SELECT * FROM a
    WHERE a.student_name IS NOT NULL
      AND (a.roll IS NULL OR NOT EXISTS (
        SELECT 1 FROM class_enrollments o
        WHERE o.class_id = p_class_id AND o.is_active AND o.roll_number = a.roll))
  ),
  ins AS (
    INSERT INTO students
      (student_name, father_name, roll_number, list_id,
       enrolled_by_user_id, import_run_id, is_active, school_id)
    SELECT student_name, father_name, roll, v_list, p_edited_by, p_run_id, true, v_school
    FROM ok
    RETURNING id, roll_number
  )
  INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
  SELECT p_class_id, id, roll_number, current_date, true FROM ins
  ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  -- Not in this class: the enrolment closes. is_active = false, never DELETE.
  --
  -- `outcome` says WHY, and the honest answer here is 'roster_correction': the coach
  -- struck a line off the register view and was never asked for a reason. It used to
  -- be left NULL, which records nothing; the JS writer used to say 'left', which
  -- records a departure nobody witnessed. Both are read by attrition analysis, one
  -- as a gap and one as a lie.
  WITH r AS (SELECT (x->>'id')::uuid AS id FROM jsonb_array_elements(p_removes) AS t(x))
  UPDATE class_enrollments ce
  SET is_active = false, left_on = current_date, outcome = 'roster_correction',
      updated_at = now()
  FROM r
  WHERE ce.class_id = p_class_id AND ce.student_id = r.id AND ce.is_active;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- A removed child now enrolled nowhere was this roster's own creation (or
  -- unowned): deactivate the record so she stops appearing anywhere. Reversible.
  UPDATE students s
  SET is_active = false, status = 'inactive', updated_at = now()
  WHERE s.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_removes) AS t(x))
    AND NOT EXISTS (SELECT 1 FROM class_enrollments ce
                    WHERE ce.student_id = s.id AND ce.is_active)
    AND (s.list_id IS NULL OR v_list IS NULL OR s.list_id = v_list);
  GET DIAGNOSTICS v_deactivated = ROW_COUNT;

  IF v_list IS NOT NULL THEN
    UPDATE student_lists
    SET student_count = (SELECT count(*) FROM students
                         WHERE list_id = v_list AND is_active),
        updated_at = now()
    WHERE id = v_list;
  END IF;

  RETURN jsonb_build_object(
    'updated', v_updated, 'moved', v_moved, 'added', v_added,
    'removed', v_removed, 'deactivated', v_deactivated, 'replay', false);
END;
$_$;


--
-- Name: roster_change_class_details(uuid, uuid, text, text, text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_change_class_details(p_class_id uuid, p_school_id uuid, p_grade_code text, p_section text, p_shift_code text, p_actor uuid, p_merge boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_class classes%ROWTYPE;
  v_target classes%ROWTYPE;
  v_section text;
  v_shift text;
  v_ordinal int;
  v_label text;
  v_target_label text;
  v_source_count int;
  v_target_count int;
  v_mirrors int := 0;
  v_moved int := 0;
  v_closed int := 0;
  v_teachers int := 0;
  v_target_list uuid;
  v_target_ct uuid;
  v_first uuid;
  v_second uuid;
BEGIN
  IF p_class_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'roster_change_class_details: p_class_id and p_actor are required';
  END IF;

  PERFORM set_config('app.actor', p_actor::text, true);
  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  SELECT * INTO v_class FROM classes WHERE id = p_class_id AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_class'); END IF;
  IF p_school_id IS NOT NULL AND v_class.school_id <> p_school_id THEN
    RETURN jsonb_build_object('error', 'wrong_school');
  END IF;

  -- Vocabulary, exactly as createClass checks it: seeded grade, seeded section
  -- (normalised: upper, trimmed, NULL when blank), seeded shift.
  SELECT ordinal INTO v_ordinal FROM grade_levels WHERE code = p_grade_code AND is_active;
  IF v_ordinal IS NULL THEN RETURN jsonb_build_object('error', 'unknown_grade'); END IF;
  v_section := nullif(upper(btrim(coalesce(p_section, ''))), '');
  IF v_section IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE code = v_section AND is_active) THEN
    RETURN jsonb_build_object('error', 'unknown_section');
  END IF;
  v_shift := coalesce(nullif(btrim(coalesce(p_shift_code, '')), ''), 'morning');
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE code = v_shift AND is_active) THEN
    RETURN jsonb_build_object('error', 'unknown_shift');
  END IF;

  v_label := CASE WHEN v_ordinal = 0 THEN 'Early Years' ELSE 'Grade ' || v_ordinal END;
  IF v_section IS NOT NULL THEN v_label := v_label || ' - ' || v_section; END IF;
  IF v_shift <> 'morning' THEN v_label := v_label || ' (' || v_shift || ')'; END IF;

  IF v_class.grade_code = p_grade_code
     AND coalesce(v_class.section, '') = coalesce(v_section, '')
     AND v_class.shift_code = v_shift THEN
    RETURN jsonb_build_object('action', 'unchanged', 'class_id', p_class_id, 'label', v_label);
  END IF;

  SELECT count(*) INTO v_source_count FROM class_enrollments WHERE class_id = p_class_id AND is_active;

  SELECT * INTO v_target FROM classes
  WHERE school_id = v_class.school_id AND grade_code = p_grade_code
    AND coalesce(section, '') = coalesce(v_section, '')
    AND shift_code = v_shift AND session_code = v_class.session_code
    AND is_active AND id <> p_class_id
  LIMIT 1;

  -- ---------------------------------------------------------------- rename
  IF v_target.id IS NULL THEN
    UPDATE classes
    SET grade_code = p_grade_code, section = v_section, shift_code = v_shift, updated_at = now()
    WHERE id = p_class_id;

    -- The legacy lists follow the name, unless the owner already has an active
    -- list of that name in that year (the unique index would refuse it).
    UPDATE student_lists l
    SET class_name = v_label, section = v_section, updated_at = now()
    WHERE l.class_id = p_class_id AND l.is_active
      AND NOT EXISTS (SELECT 1 FROM student_lists o
                      WHERE o.user_id = l.user_id AND o.is_active AND o.id <> l.id
                        AND o.academic_year = l.academic_year
                        AND lower(o.class_name) = lower(v_label));
    GET DIAGNOSTICS v_mirrors = ROW_COUNT;

    RETURN jsonb_build_object('action', 'renamed', 'class_id', p_class_id, 'label', v_label,
      'mirrors_renamed', v_mirrors, 'source_count', v_source_count);
  END IF;

  -- ------------------------------------------------------------- collision
  SELECT count(*) INTO v_target_count FROM class_enrollments WHERE class_id = v_target.id AND is_active;
  v_target_label := v_label;

  IF NOT p_merge THEN
    RETURN jsonb_build_object('action', 'collision', 'class_id', p_class_id,
      'existing_class_id', v_target.id, 'existing_label', v_target_label,
      'existing_count', v_target_count, 'source_count', v_source_count);
  END IF;

  -- ----------------------------------------------------------------- merge
  -- Both classes locked, smaller id first, so two merges cannot deadlock.
  IF v_target.id < p_class_id THEN v_first := v_target.id; v_second := p_class_id;
  ELSE v_first := p_class_id; v_second := v_target.id; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || v_first::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || v_second::text, 0));

  -- A child already in the target: her source enrolment closes. She was scanned
  -- twice; closing is the correction, and it says so.
  UPDATE class_enrollments s
  SET is_active = false, left_on = current_date, outcome = 'roster_correction', updated_at = now()
  WHERE s.class_id = p_class_id AND s.is_active
    AND EXISTS (SELECT 1 FROM class_enrollments t
                WHERE t.class_id = v_target.id AND t.student_id = s.student_id AND t.is_active);
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  -- Everyone else moves. A roll the target already holds is dropped, not the child.
  UPDATE class_enrollments s
  SET class_id = v_target.id,
      roll_number = CASE WHEN s.roll_number IS NOT NULL AND EXISTS (
                      SELECT 1 FROM class_enrollments t
                      WHERE t.class_id = v_target.id AND t.is_active AND t.roll_number = s.roll_number)
                    THEN NULL ELSE s.roll_number END,
      updated_at = now()
  WHERE s.class_id = p_class_id AND s.is_active;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- The target's attendance list: its class teacher's, else any active one, else
  -- ONE of the source's is re-linked so the children keep a register.
  SELECT teacher_user_id INTO v_target_ct FROM class_teachers
  WHERE class_id = v_target.id AND is_active AND is_class_teacher LIMIT 1;
  SELECT id INTO v_target_list FROM student_lists
  WHERE class_id = v_target.id AND is_active
  ORDER BY (user_id = v_target_ct) DESC NULLS LAST, created_at
  LIMIT 1;
  IF v_target_list IS NULL THEN
    SELECT id INTO v_target_list FROM student_lists
    WHERE class_id = p_class_id AND is_active ORDER BY created_at LIMIT 1;
    IF v_target_list IS NOT NULL THEN
      UPDATE student_lists SET class_id = v_target.id, class_name = v_target_label, section = v_section, updated_at = now()
      WHERE id = v_target_list;
    END IF;
  END IF;

  -- The source's children follow the target's list; the source's other mirrors retire.
  IF v_target_list IS NOT NULL THEN
    UPDATE students st
    SET list_id = v_target_list, updated_at = now()
    FROM class_enrollments e
    WHERE e.class_id = v_target.id AND e.is_active AND e.student_id = st.id
      AND (st.list_id IS NULL OR st.list_id IN (SELECT id FROM student_lists WHERE class_id = p_class_id));
  END IF;
  UPDATE student_lists SET is_active = false, updated_at = now()
  WHERE class_id = p_class_id AND is_active AND id IS DISTINCT FROM v_target_list;
  UPDATE student_lists l
  SET student_count = (SELECT count(*) FROM students WHERE list_id = l.id AND is_active), updated_at = now()
  WHERE l.class_id IN (p_class_id, v_target.id) OR l.id = v_target_list;

  -- Teachers: a foothold on the target for each, never the class-teacher role
  -- when the target already has one; the source assignments close.
  INSERT INTO class_teachers (class_id, teacher_user_id, is_class_teacher, assigned_on, is_active)
  SELECT v_target.id, s.teacher_user_id,
         (v_target_ct IS NULL AND s.is_class_teacher), current_date, true
  FROM class_teachers s
  WHERE s.class_id = p_class_id AND s.is_active
    AND NOT EXISTS (SELECT 1 FROM class_teachers t
                    WHERE t.class_id = v_target.id AND t.teacher_user_id = s.teacher_user_id AND t.is_active);
  GET DIAGNOSTICS v_teachers = ROW_COUNT;
  UPDATE class_teachers
  SET is_active = false, is_class_teacher = false, ended_on = current_date, updated_at = now()
  WHERE class_id = p_class_id AND is_active;

  -- The source closes, and says where it went.
  UPDATE classes
  SET is_active = false, merged_into_class_id = v_target.id, updated_at = now()
  WHERE id = p_class_id;

  SELECT count(*) INTO v_target_count FROM class_enrollments WHERE class_id = v_target.id AND is_active;

  RETURN jsonb_build_object('action', 'merged', 'class_id', p_class_id,
    'target_class_id', v_target.id, 'label', v_target_label,
    'moved', v_moved, 'closed_duplicates', v_closed, 'teachers_moved', v_teachers,
    'target_count', v_target_count, 'target_list_id', v_target_list);
END;
$$;


--
-- Name: roster_class_timeline(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_class_timeline(p_class_id uuid) RETURNS TABLE(changed_at timestamp with time zone, txid bigint, table_name text, row_id text, op text, changed_cols text[], old_vals jsonb, new_vals jsonb, actor text, actor_source text, actor_name text, actor_role text, subject text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  WITH cid AS (SELECT p_class_id::text AS t),
  keys AS (
    SELECT 'classes'::text AS table_name, p_class_id::text AS row_id
    UNION ALL SELECT 'class_teachers',    ct.id::text FROM class_teachers ct    WHERE ct.class_id = p_class_id
    UNION ALL SELECT 'class_enrollments', ce.id::text FROM class_enrollments ce WHERE ce.class_id = p_class_id
    UNION ALL SELECT 'student_lists',     sl.id::text FROM student_lists sl     WHERE sl.class_id = p_class_id
    UNION ALL SELECT 'students',          ce.student_id::text FROM class_enrollments ce WHERE ce.class_id = p_class_id
  ),
  hits AS (
    SELECT h.* FROM record_history h JOIN keys k ON k.table_name = h.table_name AND k.row_id = h.row_id
    UNION
    SELECT h.* FROM record_history h, cid
     WHERE h.table_name IN ('class_teachers','class_enrollments','student_lists')
       AND (h.new_vals ->> 'class_id' = cid.t OR h.old_vals ->> 'class_id' = cid.t)
  )
  SELECT
    h.changed_at, h.txid, h.table_name, h.row_id, h.op, h.changed_cols, h.old_vals, h.new_vals,
    h.actor, h.actor_source,
    u.name AS actor_name, u.role AS actor_role,
    CASE h.table_name
      WHEN 'students'          THEN (SELECT s.student_name FROM students s WHERE s.id::text = h.row_id)
      WHEN 'class_enrollments' THEN (SELECT s.student_name FROM class_enrollments ce JOIN students s ON s.id = ce.student_id WHERE ce.id::text = h.row_id)
      WHEN 'class_teachers'    THEN (SELECT tu.name FROM class_teachers ct JOIN users tu ON tu.id = ct.teacher_user_id WHERE ct.id::text = h.row_id)
      WHEN 'student_lists'     THEN (SELECT lu.name FROM student_lists sl JOIN users lu ON lu.id = sl.user_id WHERE sl.id::text = h.row_id)
      ELSE NULL
    END AS subject
  FROM hits h
  -- CASE, not AND: the planner may evaluate the cast before the regex guard and
  -- fail on 'authenticator'. CASE guarantees the order.
  LEFT JOIN users u
    ON u.id = CASE WHEN h.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN h.actor::uuid END
  ORDER BY h.changed_at, h.id
$_$;


--
-- Name: roster_hand_over_class(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_hand_over_class(p_class_id uuid, p_school_id uuid, p_teacher_user_id uuid, p_actor uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_class classes%ROWTYPE;
  v_ordinal int;
  v_label text;
  v_role text;
  v_prev uuid;
  v_assignment uuid;
  v_list uuid;
  v_adopted boolean := false;
  v_adopted_from uuid;
  v_repointed int := 0;
  v_retired int := 0;
  v_already boolean := false;
BEGIN
  IF p_class_id IS NULL OR p_teacher_user_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'roster_hand_over_class: p_class_id, p_teacher_user_id and p_actor are required';
  END IF;

  -- Who is doing this, for the row-history ledger (transaction-local).
  PERFORM set_config('app.actor', p_actor::text, true);

  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  SELECT * INTO v_class FROM classes WHERE id = p_class_id AND is_active;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown_class');
  END IF;
  IF p_school_id IS NOT NULL AND v_class.school_id <> p_school_id THEN
    RETURN jsonb_build_object('error', 'wrong_school');
  END IF;

  SELECT role INTO v_role FROM users WHERE id = p_teacher_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'unknown_teacher');
  END IF;
  -- LEADER_ROLES minus 'principal' — see the header. Kept as a literal list rather
  -- than a lookup so this function stays self-contained and reviewable.
  IF v_role IN ('school_leader', 'supervisor', 'coach', 'aeo') THEN
    RETURN jsonb_build_object('error', 'not_a_teacher');
  END IF;

  SELECT ordinal INTO v_ordinal FROM grade_levels WHERE code = v_class.grade_code;
  IF v_ordinal IS NULL THEN
    RETURN jsonb_build_object('error', 'unknown_grade');
  END IF;

  -- The legacy list name, exactly as ClassService.mirrorLabel writes it.
  v_label := CASE WHEN v_ordinal = 0 THEN 'Early Years' ELSE 'Grade ' || v_ordinal END;
  IF v_class.section IS NOT NULL THEN v_label := v_label || ' - ' || v_class.section; END IF;
  IF v_class.shift_code <> 'morning' THEN v_label := v_label || ' (' || v_class.shift_code || ')'; END IF;

  -- 1. The role. Whoever held it before keeps their assignment, loses the flag.
  SELECT teacher_user_id INTO v_prev FROM class_teachers
  WHERE class_id = p_class_id AND is_active AND is_class_teacher
    AND teacher_user_id <> p_teacher_user_id
  LIMIT 1;
  IF v_prev IS NOT NULL THEN
    UPDATE class_teachers SET is_class_teacher = false, updated_at = now()
    WHERE class_id = p_class_id AND teacher_user_id = v_prev AND is_active;
  END IF;

  SELECT id, is_class_teacher INTO v_assignment, v_already FROM class_teachers
  WHERE class_id = p_class_id AND teacher_user_id = p_teacher_user_id AND is_active
  LIMIT 1;
  IF v_assignment IS NULL THEN
    INSERT INTO class_teachers (class_id, teacher_user_id, is_class_teacher, assigned_on, is_active)
    VALUES (p_class_id, p_teacher_user_id, true, current_date, true)
    RETURNING id INTO v_assignment;
    v_already := false;
  ELSIF NOT v_already THEN
    UPDATE class_teachers SET is_class_teacher = true, updated_at = now() WHERE id = v_assignment;
  END IF;

  -- 2. Her mirror: linked already → same-name list adopted → else written.
  SELECT id INTO v_list FROM student_lists
  WHERE user_id = p_teacher_user_id AND class_id = p_class_id AND is_active
  ORDER BY created_at LIMIT 1;
  IF v_list IS NULL THEN
    SELECT id, class_id INTO v_list, v_adopted_from FROM student_lists
    WHERE user_id = p_teacher_user_id AND is_active
      AND academic_year = v_class.session_code
      AND lower(class_name) = lower(v_label)
    ORDER BY created_at LIMIT 1;
    IF v_list IS NOT NULL THEN
      UPDATE student_lists SET class_id = p_class_id, updated_at = now() WHERE id = v_list;
      v_adopted := true;
    ELSE
      INSERT INTO student_lists (user_id, class_name, section, academic_year, class_id, is_active)
      VALUES (p_teacher_user_id, v_label, v_class.section, v_class.session_code, p_class_id, true)
      RETURNING id INTO v_list;
    END IF;
  END IF;

  -- 3. The children follow her list.
  UPDATE students s
  SET list_id = v_list, updated_at = now()
  FROM class_enrollments e
  WHERE e.class_id = p_class_id AND e.is_active AND e.student_id = s.id
    AND s.list_id IS DISTINCT FROM v_list;
  GET DIAGNOSTICS v_repointed = ROW_COUNT;

  -- 4. The fallback mirrors retire: any leader's, and the outgoing class teacher's.
  UPDATE student_lists l
  SET is_active = false, updated_at = now()
  FROM users u
  WHERE l.class_id = p_class_id AND l.is_active AND l.id <> v_list
    AND u.id = l.user_id
    AND (u.role IN ('school_leader', 'supervisor', 'coach', 'principal', 'aeo')
         OR (v_prev IS NOT NULL AND u.id = v_prev));
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  -- Counts from truth, on every list this touched.
  UPDATE student_lists l
  SET student_count = (SELECT count(*) FROM students WHERE list_id = l.id AND is_active),
      updated_at = now()
  WHERE l.id = v_list OR l.class_id = p_class_id;

  RETURN jsonb_build_object(
    'class_id', p_class_id,
    'teacher_user_id', p_teacher_user_id,
    'assignment_id', v_assignment,
    'already_class_teacher', v_already,
    'previous_class_teacher_user_id', v_prev,
    'list_id', v_list,
    'list_adopted', v_adopted,
    'list_adopted_from_class_id', v_adopted_from,
    'repointed', v_repointed,
    'retired_mirrors', v_retired,
    'label', v_label);
END;
$$;


--
-- Name: roster_import_students(uuid, uuid, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_named int := 0;
  v_added int := 0;
BEGIN
  IF p_class_id IS NULL OR p_run_id IS NULL OR p_enrolled_by IS NULL THEN
    RAISE EXCEPTION 'roster_import_students: p_class_id, p_run_id and p_enrolled_by are required';
  END IF;

  -- Wait at most 5s for another save on this class. PostgREST's statement
  -- timeout is ~8s, so we surface 55P03 (the caller maps it to an honest
  -- "already being saved" screen) rather than being killed opaquely.
  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  -- The run key. The second press serialized behind the first on the lock
  -- above; by the time it gets here, its own run is already applied.
  IF EXISTS (SELECT 1 FROM students WHERE import_run_id = p_run_id) THEN
    SELECT count(*) INTO v_named
    FROM jsonb_array_elements(p_students) AS t(x)
    WHERE btrim(coalesce(x->>'student_name', '')) <> '';
    RETURN jsonb_build_object('added', 0, 'skipped', coalesce(v_named, 0), 'replay', true);
  END IF;

  WITH named AS (
    SELECT
      btrim(x->>'student_name') AS student_name,
      nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name,
      nullif(btrim(coalesce(x->>'parent_phone', '')), '') AS parent_phone,
      CASE WHEN btrim(coalesce(x->>'roll_number', '')) ~ '^\d{1,3}$'
           THEN btrim(x->>'roll_number')::int END AS roll,
      ord
    FROM jsonb_array_elements(p_students) WITH ORDINALITY AS t(x, ord)
    WHERE btrim(coalesce(x->>'student_name', '')) <> ''
  ),
  first_occurrence AS (
    SELECT n.*, row_number() OVER (
      PARTITION BY CASE WHEN n.roll IS NOT NULL THEN 'r:' || n.roll::text
                        ELSE 'n:' || lower(n.student_name) END
      ORDER BY n.ord) AS rn
    FROM named n
  ),
  existing AS (
    SELECT ce.roll_number, lower(btrim(s.student_name)) AS name_key
    FROM class_enrollments ce
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = p_class_id AND ce.is_active
  ),
  fresh AS (
    SELECT f.student_name, f.father_name, f.parent_phone, f.roll
    FROM first_occurrence f
    WHERE f.rn = 1
      AND NOT (f.roll IS NOT NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.roll_number = f.roll))
      AND NOT (f.roll IS NULL AND EXISTS (
        SELECT 1 FROM existing e WHERE e.name_key = lower(f.student_name)))
  ),
  ins_students AS (
    INSERT INTO students
      (student_name, father_name, parent_phone, roll_number,
       list_id, enrolled_by_user_id, import_run_id, is_active)
    SELECT student_name, father_name, parent_phone, roll,
           p_list_id, p_enrolled_by, p_run_id, true
    FROM fresh
    RETURNING id, roll_number
  ),
  ins_enrollments AS (
    -- The partial unique idx_class_enrollments_unique backs this: even if a
    -- future edit breaks the dedupe above, the same child cannot be enrolled
    -- in one class twice.
    INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
    SELECT p_class_id, id, roll_number, current_date, true
    FROM ins_students
    ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING
    RETURNING id
  )
  SELECT (SELECT count(*) FROM named), (SELECT count(*) FROM ins_enrollments)
  INTO v_named, v_added;

  -- The legacy mirror count this write just changed. Set from truth, not by
  -- increment — it was measured wrong on 39 of 60 lists precisely because
  -- writers incremented instead of counting.
  IF p_list_id IS NOT NULL THEN
    UPDATE student_lists
    SET student_count = (SELECT count(*) FROM students
                         WHERE list_id = p_list_id AND is_active),
        updated_at = now()
    WHERE id = p_list_id;
  END IF;

  RETURN jsonb_build_object(
    'added', coalesce(v_added, 0),
    'skipped', coalesce(v_named, 0) - coalesce(v_added, 0),
    'replay', false);
END;
$_$;


--
-- Name: roster_import_students(uuid, uuid, text, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb, p_school_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_named int := 0;
  v_added int := 0;
BEGIN
  IF p_class_id IS NULL OR p_run_id IS NULL OR p_enrolled_by IS NULL THEN
    RAISE EXCEPTION 'roster_import_students: p_class_id, p_run_id and p_enrolled_by are required';
  END IF;

  PERFORM set_config('lock_timeout', '5000', true);
  -- bd-a21ks: the ledger names the coach (see roster_apply_edits).
  PERFORM set_config('app.actor', p_enrolled_by::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('roster_import:' || p_class_id::text, 0));

  IF EXISTS (SELECT 1 FROM students WHERE import_run_id = p_run_id) THEN
    SELECT count(*) INTO v_named
    FROM jsonb_array_elements(p_students) AS t(x)
    WHERE btrim(coalesce(x->>'student_name', '')) <> '';
    RETURN jsonb_build_object('added', 0, 'skipped', coalesce(v_named, 0), 'replay', true);
  END IF;

  WITH named AS (
    SELECT
      btrim(x->>'student_name') AS student_name,
      nullif(btrim(coalesce(x->>'father_name', '')), '') AS father_name,
      nullif(btrim(coalesce(x->>'parent_phone', '')), '') AS parent_phone,
      nullif(btrim(coalesce(x->>'admission_no', '')), '') AS admission_no,
      CASE WHEN coalesce(x->>'date_of_birth', '') ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (x->>'date_of_birth')::date END AS date_of_birth,
      CASE WHEN btrim(coalesce(x->>'roll_number', '')) ~ '^\d{1,3}$'
           THEN btrim(x->>'roll_number')::int END AS roll,
      ord
    FROM jsonb_array_elements(p_students) WITH ORDINALITY AS t(x, ord)
    WHERE btrim(coalesce(x->>'student_name', '')) <> ''
  ),
  -- TWO independent orderings, because a roll and a name mean different things.
  -- roll_rn is read only where the roll is present, so the NULLs sharing one
  -- partition below are never consulted.
  first_occurrence AS (
    SELECT n.*,
      row_number() OVER (PARTITION BY n.roll ORDER BY n.ord) AS roll_rn,
      row_number() OVER (PARTITION BY lower(n.student_name) ORDER BY n.ord) AS name_rn
    FROM named n
  ),
  existing AS (
    SELECT ce.roll_number, lower(btrim(s.student_name)) AS name_key
    FROM class_enrollments ce
    JOIN students s ON s.id = ce.student_id
    WHERE ce.class_id = p_class_id AND ce.is_active
  ),
  -- How many children of each name the class already holds. Evaluated once, before
  -- any insert in this statement, so the second same-name child of one payload
  -- cannot match the first one we are inserting alongside her.
  existing_names AS (
    SELECT e.name_key, count(*) AS held FROM existing e GROUP BY e.name_key
  ),
  fresh AS (
    SELECT f.ord, f.student_name, f.father_name, f.parent_phone,
           f.admission_no, f.date_of_birth, f.roll
    FROM first_occurrence f
    WHERE (
      (f.roll IS NOT NULL
        AND f.roll_rn = 1
        AND NOT EXISTS (SELECT 1 FROM existing e WHERE e.roll_number = f.roll))
      OR
      (f.roll IS NULL
        AND f.name_rn > coalesce(
          (SELECT n.held FROM existing_names n WHERE n.name_key = lower(f.student_name)), 0))
    )
  ),
  -- RECOGNITION: same school + same admission number = the same child. Unchanged.
  recognised AS (
    SELECT DISTINCT ON (f.ord) f.*, s.id AS existing_id
    FROM fresh f
    JOIN students s
      ON  p_school_id IS NOT NULL
      AND f.admission_no IS NOT NULL
      AND s.school_id = p_school_id
      AND s.admission_no = f.admission_no
      AND coalesce(s.status, 'active') = 'active'
      AND s.is_active
    ORDER BY f.ord, s.created_at
  ),
  recognised_new AS (
    SELECT r.* FROM recognised r
    WHERE NOT EXISTS (
      SELECT 1 FROM class_enrollments ce
      WHERE ce.class_id = p_class_id AND ce.student_id = r.existing_id AND ce.is_active)
  ),
  filled AS (
    UPDATE students s SET
      father_name   = coalesce(s.father_name, r.father_name),
      parent_phone  = coalesce(s.parent_phone, r.parent_phone),
      date_of_birth = coalesce(s.date_of_birth, r.date_of_birth),
      updated_at    = now()
    FROM recognised_new r
    WHERE s.id = r.existing_id
    RETURNING s.id
  ),
  to_create AS (
    SELECT f.* FROM fresh f
    WHERE NOT EXISTS (SELECT 1 FROM recognised r WHERE r.ord = f.ord)
  ),
  ins_students AS (
    INSERT INTO students
      (student_name, father_name, parent_phone, roll_number,
       list_id, enrolled_by_user_id, import_run_id, is_active,
       school_id, admission_no, date_of_birth)
    SELECT student_name, father_name, parent_phone, roll,
           p_list_id, p_enrolled_by, p_run_id, true,
           p_school_id, admission_no, date_of_birth
    FROM to_create
    RETURNING id, roll_number
  ),
  enrol_source AS (
    SELECT id, roll_number FROM ins_students
    UNION ALL
    SELECT existing_id AS id, roll AS roll_number FROM recognised_new
  ),
  ins_enrollments AS (
    INSERT INTO class_enrollments (class_id, student_id, roll_number, enrolled_on, is_active)
    SELECT p_class_id, id, roll_number, current_date, true
    FROM enrol_source
    ON CONFLICT (class_id, student_id) WHERE is_active DO NOTHING
    RETURNING id
  )
  SELECT (SELECT count(*) FROM named), (SELECT count(*) FROM ins_enrollments)
  INTO v_named, v_added;

  IF p_list_id IS NOT NULL THEN
    UPDATE student_lists
    SET student_count = (SELECT count(*) FROM students
                         WHERE list_id = p_list_id AND is_active),
        updated_at = now()
    WHERE id = p_list_id;
  END IF;

  RETURN jsonb_build_object(
    'added', coalesce(v_added, 0),
    'skipped', coalesce(v_named, 0) - coalesce(v_added, 0),
    'replay', false);
END;
$_$;


--
-- Name: set_portal_user_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_portal_user_context(p_portal_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF p_portal_user_id IS NULL THEN
    -- Clear the context
    PERFORM set_config('app.portal_user_id', '', false);
  ELSE
    PERFORM set_config('app.portal_user_id', p_portal_user_id::text, false);
  END IF;
END;
$$;


--
-- Name: update_access_scopes_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_access_scopes_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_assessment_status(uuid, character varying, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_assessment_status(p_assessment_id uuid, p_new_status character varying, p_error_message text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  UPDATE reading_assessments
  SET
    status = p_new_status,
    processing_started_at = CASE
      WHEN p_new_status = 'processing' THEN NOW()
      WHEN p_new_status IN ('completed', 'failed') THEN processing_started_at -- Preserve original
      ELSE processing_started_at
    END,
    completed_at = CASE
      WHEN p_new_status = 'completed' THEN NOW()
      ELSE completed_at
    END,
    error_message = p_error_message,
    updated_at = NOW()
  WHERE id = p_assessment_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


--
-- Name: update_byof_session_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_byof_session_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_conversation_on_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conversation_on_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE ama_conversations
  SET
    updated_at = NOW(),
    message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


--
-- Name: update_exam_checker_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_exam_checker_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_qa_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_qa_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: update_session_message_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_session_message_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Increment message count for the session
  IF NEW.session_id IS NOT NULL THEN
    UPDATE chat_sessions
    SET message_count = message_count + 1
    WHERE id = NEW.session_id;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: update_student_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_student_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE student_lists
    SET student_count = (
      SELECT COUNT(*) FROM students
      WHERE list_id = NEW.list_id AND is_active = TRUE
    )
    WHERE id = NEW.list_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE student_lists
    SET student_count = (
      SELECT COUNT(*) FROM students
      WHERE list_id = OLD.list_id AND is_active = TRUE
    )
    WHERE id = OLD.list_id;
    RETURN OLD;
  END IF;
END;
$$;


--
-- Name: update_student_videos_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_student_videos_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.grade, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.subject, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.topic, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.subtopic, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'D');
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _coltypes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._coltypes (
    column_name information_schema.sql_identifier,
    data_type information_schema.character_data,
    udt_name information_schema.sql_identifier
);


--
-- Name: ab_test_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_test_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid,
    variant_name text NOT NULL,
    user_id uuid,
    phone_number text,
    event_type text NOT NULL,
    event_data jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ab_test_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_test_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_id uuid,
    variant_name text NOT NULL,
    variant_content jsonb,
    successes integer DEFAULT 1,
    failures integer DEFAULT 1,
    impressions integer DEFAULT 0,
    conversions integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ab_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_tests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    test_name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text,
    test_type text DEFAULT 'bandit'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    winner_variant text
);


--
-- Name: academic_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_sessions (
    code text NOT NULL,
    kind text DEFAULT 'annual'::text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT academic_sessions_kind_check CHECK ((kind = ANY (ARRAY['annual'::text, 'semester'::text, 'term'::text]))),
    CONSTRAINT academic_sessions_span CHECK ((ends_on > starts_on))
);


--
-- Name: access_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_scopes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    dashboard_user_id uuid NOT NULL,
    scope_type character varying(20) NOT NULL,
    scope_value jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ama_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ama_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) DEFAULT 'New Conversation'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    message_count integer DEFAULT 0,
    context_summary text,
    is_archived boolean DEFAULT false
);


--
-- Name: ama_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ama_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    thinking_content text,
    created_at timestamp with time zone DEFAULT now(),
    tokens_used integer,
    model_used character varying(50),
    response_time_ms integer,
    sql_query text,
    query_result jsonb,
    chart_type character varying(50),
    chart_data jsonb,
    tracer_user_id uuid,
    tracer_report jsonb,
    chart_image_url text
);


--
-- Name: ama_query_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ama_query_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid,
    user_id uuid NOT NULL,
    original_question text NOT NULL,
    generated_sql text NOT NULL,
    sql_validated boolean DEFAULT false,
    validation_errors text[],
    execution_status character varying(20),
    execution_time_ms integer,
    row_count integer,
    error_message text,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: api_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service character varying(50) NOT NULL,
    operation_type character varying(50) NOT NULL,
    units_consumed numeric,
    estimated_cost numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: assessment_papers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_papers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    attempt smallint DEFAULT 1 NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    exam_json jsonb,
    original_exam_json jsonb,
    selected_question_ids jsonb,
    question_count integer,
    total_marks integer,
    file_r2_key text,
    error_code text,
    error_detail text,
    model text,
    input_tokens integer,
    output_tokens integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    edited_at timestamp with time zone,
    answer_key_r2_key text,
    edited_from uuid,
    CONSTRAINT assessment_papers_edited_from_not_self CHECK (((edited_from IS NULL) OR (edited_from <> id))),
    CONSTRAINT assessment_papers_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'generating'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: assessment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    surface text DEFAULT 'whatsapp'::text NOT NULL,
    grade_code text NOT NULL,
    subject_code text NOT NULL,
    textbook_id uuid NOT NULL,
    chapter_number integer,
    page_ranges text,
    content_source text DEFAULT 'unseen'::text NOT NULL,
    question_count integer NOT NULL,
    question_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    has_answer_key boolean DEFAULT false NOT NULL,
    has_answer_lines boolean DEFAULT true NOT NULL,
    output_format text DEFAULT 'pdf'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notice_seen_at timestamp with time zone,
    notice_opened_at timestamp with time zone,
    notice_whatsapp_at timestamp with time zone,
    CONSTRAINT assessment_requests_content_source_check CHECK ((content_source = ANY (ARRAY['seen'::text, 'unseen'::text, 'both'::text]))),
    CONSTRAINT assessment_requests_has_coverage CHECK (((chapter_number IS NOT NULL) OR (page_ranges IS NOT NULL))),
    CONSTRAINT assessment_requests_output_format_check CHECK ((output_format = ANY (ARRAY['pdf'::text, 'docx'::text]))),
    CONSTRAINT assessment_requests_question_count_check CHECK (((question_count >= 1) AND (question_count <= 60))),
    CONSTRAINT assessment_requests_surface_check CHECK ((surface = ANY (ARRAY['whatsapp'::text, 'portal'::text, 'api'::text])))
);


--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_records (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    session_id uuid,
    student_id uuid,
    student_name character varying(200),
    status character varying(20) NOT NULL,
    confidence numeric DEFAULT 1.00,
    detected_response text,
    was_manually_changed boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    list_id uuid,
    session_date date NOT NULL,
    session_type character varying(20) DEFAULT 'full_day'::character varying,
    audio_url text,
    transcript text,
    transcript_confidence numeric,
    excel_url text,
    total_students integer,
    present_count integer,
    absent_count integer,
    was_manually_edited boolean DEFAULT false,
    marking_method character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    leave_count integer DEFAULT 0
);


--
-- Name: audio_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    audio_url character varying(500),
    audio_duration_seconds integer,
    transcript text,
    analysis_report jsonb,
    voice_summary_url character varying(500),
    pdf_report_url character varying(500),
    status character varying(20) DEFAULT 'processing'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    completed_at timestamp without time zone
);


--
-- Name: broadcast_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid,
    admin_username text NOT NULL,
    admin_ip_address text,
    admin_user_agent text,
    message_content text NOT NULL,
    filters jsonb NOT NULL,
    template_id text,
    template_name text,
    template_status text,
    template_rejected_reason text,
    template_submitted_at timestamp with time zone,
    total_recipients integer NOT NULL,
    sent_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    delivered_count integer DEFAULT 0,
    read_count integer DEFAULT 0,
    replied_count integer DEFAULT 0,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    errors jsonb,
    error_message text,
    audit_trail jsonb DEFAULT '[]'::jsonb
);


--
-- Name: broadcast_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcast_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    broadcast_id uuid,
    user_id uuid,
    phone_number text NOT NULL,
    message_id text,
    status text DEFAULT 'pending'::text,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    replied_at timestamp with time zone
);


--
-- Name: byof_approval_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.byof_approval_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    performed_by uuid NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: byof_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.byof_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: byof_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.byof_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    affected_files text[] DEFAULT '{}'::text[],
    summary_embedding extensions.vector,
    status character varying(20) DEFAULT 'draft'::character varying,
    pr_url text,
    approved_by uuid,
    approved_at timestamp with time zone,
    staging_merged_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: byof_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.byof_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(20) NOT NULL,
    title text,
    status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: call_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_memory (
    caller_number text NOT NULL,
    user_id uuid,
    summary text NOT NULL,
    call_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_recall_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_recall_docs (
    id text NOT NULL,
    caller_number text NOT NULL,
    user_id uuid,
    kind text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone,
    embedded_at timestamp with time zone,
    embedding extensions.vector(512)
);


--
-- Name: call_trace; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_trace (
    id bigint NOT NULL,
    wa_call_id text NOT NULL,
    seq integer NOT NULL,
    kind text DEFAULT 'tool'::text NOT NULL,
    tool_name text,
    args_json jsonb,
    result_preview text,
    result_bytes integer,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_trace_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.call_trace_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: call_trace_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.call_trace_id_seq OWNED BY public.call_trace.id;


--
-- Name: calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wa_call_id text NOT NULL,
    caller_number text NOT NULL,
    caller_name text,
    user_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_seconds integer,
    status text,
    model text,
    voice text,
    transcript jsonb,
    context_snapshot jsonb,
    cost_estimate numeric(8,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    started_at timestamp without time zone NOT NULL,
    last_activity_at timestamp without time zone NOT NULL,
    ended_at timestamp without time zone,
    message_count integer DEFAULT 0,
    session_type character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    turn_count integer DEFAULT 0,
    registration_triggered boolean DEFAULT false,
    conversation_state jsonb
);


--
-- Name: chat_starts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_starts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    phone_number character varying(20) NOT NULL,
    session_id character varying(255),
    utm_source character varying(100),
    utm_medium character varying(100),
    utm_campaign character varying(100),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: child_test_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.child_test_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    block text NOT NULL,
    audio_r2_key text,
    photo_r2_key text,
    transcript jsonb,
    ai_marks jsonb,
    ai_status text DEFAULT 'pending'::text NOT NULL,
    ai_reason text,
    ai_model_versions jsonb,
    ai_scored_at timestamp with time zone,
    coach_marks jsonb,
    coach_edits jsonb,
    checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT child_test_blocks_ai_status_check CHECK ((ai_status = ANY (ARRAY['pending'::text, 'scoring'::text, 'scored'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT child_test_blocks_block_check CHECK ((block = ANY (ARRAY['urdu'::text, 'english'::text, 'maths'::text, 'ur.listening'::text, 'ur.letters'::text, 'ur.nonwords'::text, 'ur.words'::text, 'ur.story'::text, 'en.listening'::text, 'en.letters'::text, 'en.nonwords'::text, 'en.words'::text, 'en.story'::text, 'ma.number_id'::text, 'ma.discrimination'::text, 'ma.missing'::text, 'ma.add1'::text, 'ma.sub1'::text, 'ma.add2'::text, 'ma.sub2'::text, 'ma.word_problems'::text]))),
    CONSTRAINT child_test_blocks_check CHECK (((ai_marks IS NULL) OR (ai_status = ANY (ARRAY['scored'::text, 'partial'::text]))))
);


--
-- Name: child_test_draws; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.child_test_draws (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id text NOT NULL,
    region text NOT NULL,
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    grade smallint NOT NULL,
    student_id uuid NOT NULL,
    roll_number integer,
    frame_size integer NOT NULL,
    draw_rank integer NOT NULL,
    seed_digest text NOT NULL,
    algo_version text NOT NULL,
    sample_role text DEFAULT 'new'::text NOT NULL,
    form text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    list_slot text,
    attempts smallint DEFAULT 0 NOT NULL,
    last_listed_visit_id uuid,
    outcome_at timestamp with time zone,
    outcome_note text,
    tested_at timestamp with time zone,
    source_draw_id uuid,
    history jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_key text,
    CONSTRAINT child_test_draws_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT child_test_draws_check CHECK (((sample_role = 'new'::text) OR (source_draw_id IS NOT NULL))),
    CONSTRAINT child_test_draws_check1 CHECK (((status <> 'tested'::text) OR (tested_at IS NOT NULL))),
    CONSTRAINT child_test_draws_cycle_id_check CHECK ((cycle_id ~ '^[A-Z]+-[0-9]{4}-Q[1-4]$'::text)),
    CONSTRAINT child_test_draws_draw_rank_check CHECK ((draw_rank > 0)),
    CONSTRAINT child_test_draws_form_check CHECK ((form = ANY (ARRAY['A'::text, 'B'::text]))),
    CONSTRAINT child_test_draws_frame_size_check CHECK ((frame_size > 0)),
    CONSTRAINT child_test_draws_grade_check CHECK ((grade = ANY (ARRAY[3, 5]))),
    CONSTRAINT child_test_draws_list_slot_check CHECK ((list_slot = ANY (ARRAY['main'::text, 'alternate'::text]))),
    CONSTRAINT child_test_draws_one_visit CHECK ((num_nonnulls(last_listed_visit_id, visit_key) <= 1)),
    CONSTRAINT child_test_draws_sample_role_check CHECK ((sample_role = ANY (ARRAY['new'::text, 'returning'::text]))),
    CONSTRAINT child_test_draws_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'listed'::text, 'tested'::text, 'absent'::text, 'refused'::text, 'absent_final'::text]))),
    CONSTRAINT child_test_draws_visit_key_format CHECK (((visit_key IS NULL) OR (visit_key ~ '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'::text)))
);


--
-- Name: child_test_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.child_test_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    draw_id uuid NOT NULL,
    coach_user_id uuid NOT NULL,
    visit_id uuid,
    school_id uuid NOT NULL,
    class_id uuid NOT NULL,
    grade smallint NOT NULL,
    student_id uuid NOT NULL,
    form text NOT NULL,
    channel text DEFAULT 'whatsapp'::text NOT NULL,
    selection_method text DEFAULT 'random_draw'::text NOT NULL,
    frame_size integer NOT NULL,
    item_bank_version text,
    status text DEFAULT 'in_progress'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    timings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visit_key text,
    CONSTRAINT child_test_sessions_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'app'::text]))),
    CONSTRAINT child_test_sessions_form_check CHECK ((form = ANY (ARRAY['A'::text, 'B'::text]))),
    CONSTRAINT child_test_sessions_frame_size_check CHECK ((frame_size > 0)),
    CONSTRAINT child_test_sessions_grade_check CHECK ((grade = ANY (ARRAY[3, 5]))),
    CONSTRAINT child_test_sessions_one_visit CHECK ((num_nonnulls(visit_id, visit_key) <= 1)),
    CONSTRAINT child_test_sessions_selection_method_check CHECK ((selection_method = ANY (ARRAY['random_draw'::text, 'manual'::text]))),
    CONSTRAINT child_test_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text]))),
    CONSTRAINT child_test_sessions_visit_key_format CHECK (((visit_key IS NULL) OR (visit_key ~ '^(cs:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|day:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2})$'::text)))
);


--
-- Name: class_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    student_id uuid NOT NULL,
    roll_number integer,
    enrolled_on date,
    left_on date,
    outcome text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_enrollments_outcome_check CHECK ((outcome = ANY (ARRAY['promoted'::text, 'retained'::text, 'transferred'::text, 'left'::text, 'completed'::text, 'roster_correction'::text]))),
    CONSTRAINT class_enrollments_span CHECK (((left_on IS NULL) OR (enrolled_on IS NULL) OR (left_on >= enrolled_on)))
);


--
-- Name: class_teacher_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_teacher_subjects (
    class_teacher_id uuid NOT NULL,
    subject_code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    class_id uuid NOT NULL
);


--
-- Name: class_teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    teacher_user_id uuid NOT NULL,
    is_class_teacher boolean DEFAULT false NOT NULL,
    assigned_on date,
    ended_on date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_id uuid NOT NULL,
    grade_code text NOT NULL,
    section text,
    session_code text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    shift_code text DEFAULT 'morning'::text NOT NULL,
    merged_into_class_id uuid
);


--
-- Name: coach_directory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_directory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    leader_user_id uuid NOT NULL,
    full_name text NOT NULL,
    work_email text NOT NULL,
    hrmis_user_id integer,
    match_method text DEFAULT 'exact'::text NOT NULL,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coach_directory_confirmed_requires_timestamp CHECK (((match_method <> 'confirmed'::text) OR (confirmed_at IS NOT NULL))),
    CONSTRAINT coach_directory_match_method_check CHECK ((match_method = ANY (ARRAY['exact'::text, 'confirmed'::text, 'manual'::text])))
);


--
-- Name: coaching_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coaching_session_id uuid NOT NULL,
    job_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    scheduled_for timestamp with time zone DEFAULT now(),
    worker_id text,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error_message text,
    error_stack text
);


--
-- Name: coaching_processing_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_processing_queue (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    coaching_session_id uuid,
    job_type character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    next_retry_at timestamp with time zone,
    processing_worker_id text,
    error_message text,
    error_stack text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone
);


--
-- Name: coaching_quality_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_quality_metrics (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    coaching_session_id uuid,
    diarization_confidence double precision,
    processing_time_seconds integer,
    transcription_time_seconds integer,
    analysis_time_seconds integer,
    report_generation_time_seconds integer,
    user_satisfaction_rating integer,
    user_feedback text,
    worker_id text,
    retry_count integer DEFAULT 0,
    had_errors boolean DEFAULT false,
    session_cost numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: coaching_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    session_id uuid,
    audio_url character varying(500),
    audio_duration_seconds integer,
    audio_format character varying(20),
    audio_size_bytes bigint,
    transcript_text text,
    transcript_language character varying(10),
    diarization_data jsonb,
    diarization_confidence double precision,
    lesson_plan_url character varying(500),
    lesson_plan_text text,
    lesson_plan_format character varying(20),
    has_lesson_plan boolean DEFAULT false,
    analysis_data jsonb,
    conversation_state jsonb,
    report_pdf_url character varying(500),
    report_generated_at timestamp with time zone,
    voice_debrief_url character varying(500),
    voice_debrief_duration_seconds integer,
    voice_debrief_language character varying(10),
    status character varying(50) DEFAULT 'initiated'::character varying,
    last_successful_step character varying(50),
    failed_step character varying(50),
    error_message text,
    can_resume boolean DEFAULT true,
    transcription_cost numeric,
    analysis_cost numeric,
    total_cost numeric,
    gpt5_input_tokens integer,
    gpt5_output_tokens integer,
    gpt5_cached_tokens integer,
    created_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    transcription_started_at timestamp with time zone,
    transcription_completed_at timestamp with time zone,
    analysis_started_at timestamp with time zone,
    analysis_completed_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    audio_id character varying(255),
    report_gamma_url character varying(500),
    lesson_plan_r2_key text,
    lesson_plan_excerpt text,
    lesson_plan_structured jsonb,
    lesson_plan_word_count integer,
    lesson_plan_extraction_status character varying(20),
    lesson_plan_extraction_error text,
    reminder_sent_at timestamp with time zone,
    tokens_raw jsonb,
    silence_markers jsonb,
    prioritized_action jsonb,
    classroom_photos jsonb DEFAULT '[]'::jsonb,
    linked_lesson_plan_id uuid,
    lesson_plan_link_method character varying(20),
    error_stack text,
    framework text,
    framework_selection_reason text,
    observer_user_id uuid,
    observation_type character varying(30),
    autofill_analysis_data jsonb,
    debrief_status character varying(20),
    audio_hash character(64),
    duplicate_of_session_id uuid
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    message_type character varying(20),
    created_at timestamp without time zone DEFAULT now(),
    session_id uuid,
    input_format character varying(10),
    input_language character varying(10),
    output_format character varying(10),
    output_language character varying(10),
    current_state character varying(50),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: cta_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cta_clicks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    session_id character varying(255) NOT NULL,
    button_location character varying(100),
    whatsapp_link text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: curriculum_lp_ast; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.curriculum_lp_ast (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_lp_uuid uuid NOT NULL,
    source_book_id bigint NOT NULL,
    source_chapter_id bigint NOT NULL,
    source_join_id bigint NOT NULL,
    publisher text NOT NULL,
    curriculum_key text NOT NULL,
    grade integer NOT NULL,
    grade_label text NOT NULL,
    subject text NOT NULL,
    subject_label text NOT NULL,
    chapter_number integer NOT NULL,
    chapter_title text NOT NULL,
    lp_index integer NOT NULL,
    topic text NOT NULL,
    lp_type text,
    lp_source text,
    lp_category text,
    opening_steps jsonb NOT NULL,
    practice_steps jsonb NOT NULL,
    explain_steps jsonb NOT NULL,
    independent_practice_steps jsonb,
    conclusion_steps jsonb,
    classroom_setup_instructions jsonb,
    homework_instructions jsonb,
    videos text[] DEFAULT '{}'::text[] NOT NULL,
    lp_slo text[] DEFAULT '{}'::text[] NOT NULL,
    contains_video boolean DEFAULT false NOT NULL,
    opening_time integer,
    explain_time integer,
    practice_time integer,
    independent_practice_time integer,
    conclusion_time integer,
    pdf_r2_key_en text,
    pdf_r2_key_ur text,
    rendered_at timestamp with time zone,
    is_enabled boolean DEFAULT true NOT NULL,
    source_hash text NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voicenote_mp3_r2_key text,
    voicenote_ogg_r2_key text,
    demo_video_r2_key text,
    review_status text DEFAULT 'unreviewed'::text,
    review_notes text,
    CONSTRAINT curriculum_lp_ast_publisher_check CHECK ((publisher = ANY (ARRAY['NBF'::text, 'Taleemabad'::text]))),
    CONSTRAINT curriculum_lp_ast_review_status_check CHECK ((review_status = ANY (ARRAY['unreviewed'::text, 'approved'::text, 'rejected'::text, 'needs_changes'::text])))
);


--
-- Name: dashboard_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    details jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    affected_user_id uuid,
    query_filters jsonb,
    resource_type character varying(50),
    resource_id uuid
);


--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(100) NOT NULL,
    password_hash character varying(255),
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    invited_by uuid,
    invite_token character varying(255),
    invite_expires_at timestamp with time zone,
    password_reset_token character varying(255),
    password_reset_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    is_active boolean DEFAULT true,
    byof_role character varying(20),
    organization_id uuid,
    invited_for_organization character varying(255),
    access_scope_summary text,
    phone_number character varying(20)
);


--
-- Name: evaluation_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evaluation_cycles_range_sane CHECK ((ends_at > starts_at))
);


--
-- Name: exam_check_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_check_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status character varying(50) DEFAULT 'collecting_images'::character varying NOT NULL,
    subject character varying(100),
    class_name character varying(100),
    exam_date date DEFAULT CURRENT_DATE,
    board character varying(50),
    original_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    marking_scheme jsonb,
    detected_students text[],
    confirmed_students text[],
    detected_questions jsonb,
    ocr_provider character varying(20),
    ocr_confidence numeric,
    processing_started_at timestamp with time zone,
    processing_completed_at timestamp with time zone,
    error_message text,
    retry_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_grades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_grades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    question_id character varying(50) NOT NULL,
    question_type character varying(30) NOT NULL,
    max_marks numeric NOT NULL,
    awarded_marks numeric NOT NULL,
    is_correct boolean,
    is_partial boolean DEFAULT false,
    grading_rationale text,
    confidence numeric,
    feedback_up text,
    feedback_back text,
    feedback_forward text,
    answer_bbox jsonb,
    original_marks numeric,
    edited_by uuid,
    edited_at timestamp with time zone,
    edit_reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_question_bank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_question_bank (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taleemabad_uuid uuid NOT NULL,
    grade text NOT NULL,
    subject text NOT NULL,
    language text NOT NULL,
    chapter_index integer NOT NULL,
    chapter_title text NOT NULL,
    question_statement text NOT NULL,
    question_media jsonb DEFAULT '[]'::jsonb NOT NULL,
    question_format text NOT NULL,
    type text NOT NULL,
    sub_type text,
    score real NOT NULL,
    marking_scheme text,
    category text NOT NULL,
    answer_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    correct_answer text,
    bloom_tags text[] DEFAULT '{}'::text[] NOT NULL,
    ncp_slo_ref text,
    book_chapter_slo jsonb,
    group_ref uuid,
    group_type text,
    index_in_chapter integer DEFAULT 1 NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT exam_question_bank_category_check CHECK ((category = ANY (ARRAY['SEEN'::text, 'UNSEEN'::text]))),
    CONSTRAINT exam_question_bank_score_check CHECK ((score >= (0)::double precision))
);


--
-- Name: exam_question_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_question_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taleemabad_uuid uuid NOT NULL,
    title_text text,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    group_type text NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exam_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exam_id uuid NOT NULL,
    order_index integer NOT NULL,
    source_bank_id uuid NOT NULL,
    section text NOT NULL,
    question_format text NOT NULL,
    statement_snapshot text NOT NULL,
    options_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    correct_answer_snapshot text,
    marking_scheme_snapshot text,
    media_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    score real NOT NULL,
    bloom_tags text[] DEFAULT '{}'::text[] NOT NULL,
    group_ref uuid,
    CONSTRAINT exam_questions_section_check CHECK ((section = ANY (ARRAY['objective'::text, 'subjective'::text])))
);


--
-- Name: exam_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    student_id uuid,
    student_name character varying(255) NOT NULL,
    image_urls text[] NOT NULL,
    page_numbers integer[],
    extracted_text text,
    extracted_answers jsonb,
    answer_positions jsonb,
    annotated_image_urls text[],
    thumbnail_urls text[],
    status character varying(30) DEFAULT 'pending'::character varying,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    subject character varying(100),
    class_name character varying(100),
    board character varying(50),
    marking_scheme jsonb NOT NULL,
    total_marks numeric,
    usage_count integer DEFAULT 0,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: exams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by_user_id uuid NOT NULL,
    type text NOT NULL,
    grade text NOT NULL,
    subject text NOT NULL,
    language text NOT NULL,
    chapters integer[] NOT NULL,
    total_questions integer NOT NULL,
    total_marks integer NOT NULL,
    duration_minutes integer NOT NULL,
    status text DEFAULT 'composing'::text NOT NULL,
    paper_docx_url text,
    error_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ready_at timestamp with time zone,
    CONSTRAINT exams_status_check CHECK ((status = ANY (ARRAY['composing'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT exams_type_check CHECK ((type = ANY (ARRAY['WEEKLY'::text, 'TERM'::text])))
);


--
-- Name: failed_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_operations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id character varying(20),
    operation character varying(100),
    error_message text,
    context jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: feature_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_permissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    role character varying(20) NOT NULL,
    feature_key character varying(50) NOT NULL,
    can_access boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: feature_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    suggested_feature text NOT NULL,
    trigger_type text NOT NULL,
    confidence_score numeric,
    message_context text,
    was_shown boolean DEFAULT true,
    was_clicked boolean DEFAULT false,
    led_to_feature_use boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: grade_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grade_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grade_id uuid NOT NULL,
    user_id uuid NOT NULL,
    old_value numeric NOT NULL,
    new_value numeric NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: grade_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grade_levels (
    code text NOT NULL,
    ordinal smallint NOT NULL,
    band text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT grade_levels_band_check CHECK ((band = ANY (ARRAY['early_years'::text, 'primary'::text, 'middle'::text, 'high'::text, 'higher_secondary'::text])))
);


--
-- Name: hcp_coaching_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hcp_coaching_actions (
    id bigint NOT NULL,
    indicator_code character varying(32) NOT NULL,
    action_text text NOT NULL,
    priority_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hcp_coaching_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hcp_coaching_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hcp_coaching_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hcp_coaching_actions_id_seq OWNED BY public.hcp_coaching_actions.id;


--
-- Name: hcp_feedback_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hcp_feedback_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coaching_session_id uuid,
    teacher_id uuid NOT NULL,
    coach_id uuid,
    language character varying(16) DEFAULT 'english'::character varying NOT NULL,
    feedback_json jsonb NOT NULL,
    feedback_audio_url text,
    wa_text_msg_id character varying(255),
    wa_audio_msg_id character varying(255),
    version integer DEFAULT 1 NOT NULL,
    prompt_used text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone
);


--
-- Name: hcp_visit_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hcp_visit_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coach_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    observation_tool character varying(32) NOT NULL,
    notes text,
    status character varying(32) DEFAULT 'upcoming'::character varying NOT NULL,
    confirmed_at timestamp with time zone,
    teacher_wa_msg_id character varying(255),
    principal_wa_msg_id character varying(255),
    rm_wa_msg_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: homework_chapters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.homework_chapters (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    grade integer NOT NULL,
    subject character varying(100) NOT NULL,
    chapter_number integer NOT NULL,
    chapter_title character varying(300),
    lang character varying(20) DEFAULT 'en'::character varying,
    r2_key text NOT NULL,
    version character varying(20) DEFAULT 'v7'::character varying,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: image_analysis_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_analysis_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    image_url text NOT NULL,
    image_metadata jsonb DEFAULT '{}'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    retry_count integer DEFAULT 0,
    last_error text,
    analysis_result jsonb,
    tokens_used integer,
    correlation_id character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    role character varying(20) NOT NULL,
    scope_config jsonb NOT NULL,
    token character varying(128) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    invited_by uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    accepted_at timestamp with time zone,
    created_user_id uuid,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    last_sent_at timestamp with time zone,
    send_count integer DEFAULT 0
);


--
-- Name: lcpm_benchmarks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lcpm_benchmarks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lcpm_benchmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lcpm_benchmarks (
    id integer DEFAULT nextval('public.lcpm_benchmarks_id_seq'::regclass) NOT NULL,
    grade_level integer NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    season character varying(10) NOT NULL,
    percentile_5 integer NOT NULL,
    percentile_10 integer NOT NULL,
    percentile_25 integer NOT NULL,
    percentile_50 integer NOT NULL,
    percentile_75 integer NOT NULL,
    percentile_90 integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: leader_roster_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leader_roster_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    actor_user_id uuid NOT NULL,
    affected_leader_user_id uuid,
    teacher_ext_id text,
    teacher_phone_e164 text,
    teacher_name text,
    from_school_ext_id text,
    to_school_ext_id text,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT leader_roster_audit_action_check CHECK ((action = ANY (ARRAY['add'::text, 'remove'::text, 'move'::text, 'edit_name'::text, 'edit_level'::text, 'edit_phone'::text, 'edit_role'::text, 'edit_phone_escalated'::text])))
);


--
-- Name: leader_schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leader_schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    leader_user_id uuid NOT NULL,
    source text NOT NULL,
    school_ext_id text,
    school_name text NOT NULL,
    emis text,
    name_match_quality text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    school_id uuid,
    CONSTRAINT leader_schools_source_check CHECK ((source = 'niete_ict'::text))
);


--
-- Name: leader_teachers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leader_teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    leader_user_id uuid NOT NULL,
    source text NOT NULL,
    school_ext_id text,
    teacher_ext_id text,
    teacher_name text NOT NULL,
    teacher_phone text,
    teacher_phone_e164 text,
    level text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    school_id uuid,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT leader_teachers_source_check CHECK ((source = 'niete_ict'::text))
);


--
-- Name: lesson_plan_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_plan_catalog (
    id bigint NOT NULL,
    source character varying(32) NOT NULL,
    source_row_id bigint NOT NULL,
    source_uuid uuid,
    grade text,
    subject text,
    chapter_title text,
    content_html text,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    source_created_at timestamp with time zone,
    source_modified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lesson_plan_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lesson_plan_catalog_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lesson_plan_catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lesson_plan_catalog_id_seq OWNED BY public.lesson_plan_catalog.id;


--
-- Name: lesson_plan_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_plan_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone_number character varying(20) NOT NULL,
    topic character varying(500) NOT NULL,
    full_message text,
    language character varying(10) DEFAULT 'en'::character varying,
    content_type character varying(20) DEFAULT 'lesson_plan'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying,
    gamma_generation_id character varying(100),
    gamma_url text,
    pdf_url text,
    created_at timestamp with time zone DEFAULT now(),
    processing_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    retry_count integer DEFAULT 0,
    last_retry_at timestamp with time zone
);


--
-- Name: lesson_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_plans (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    topic character varying(200) NOT NULL,
    grade character varying(20),
    subject character varying(50),
    type character varying(20),
    gamma_url character varying(500),
    content jsonb,
    created_at timestamp without time zone DEFAULT now(),
    pdf_url text,
    status character varying(20) DEFAULT 'completed'::character varying,
    quiz_id uuid,
    quiz_nudge_sent boolean DEFAULT false,
    lp_variant text,
    source text DEFAULT 'gamma_standard'::text,
    delivery_time_ms integer,
    cost_usd numeric(8,4),
    pic_lp_session_id uuid,
    textbook_metadata jsonb
);


--
-- Name: lp_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lp_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    lesson_plan_id uuid,
    useful boolean NOT NULL,
    reason_text text,
    reason_received_at timestamp with time zone,
    reason_language text,
    reason_polarity text DEFAULT 'unknown'::text NOT NULL,
    lp_variant text,
    grade integer,
    subject text,
    chapter_number integer,
    segment_number integer,
    topic text,
    trigger_mode text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    useful_component text,
    used_in_class text,
    lp612_segment_id text,
    CONSTRAINT lp_feedback_reason_polarity_check CHECK ((reason_polarity = ANY (ARRAY['liked'::text, 'disliked'::text, 'unknown'::text]))),
    CONSTRAINT lp_feedback_trigger_mode_check CHECK ((trigger_mode = ANY (ARRAY['after_voice_note'::text, 'after_pdf_only'::text]))),
    CONSTRAINT lp_feedback_used_in_class_chk CHECK (((used_in_class IS NULL) OR (used_in_class = ANY (ARRAY['taught'::text, 'planned'::text, 'not_yet'::text])))),
    CONSTRAINT lp_feedback_useful_component_check CHECK ((useful_component = ANY (ARRAY['lp_only'::text, 'voicenote_only'::text, 'both'::text])))
);


--
-- Name: migration_test_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.migration_test_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: migration_test; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_test (
    id integer DEFAULT nextval('public.migration_test_id_seq'::regclass) NOT NULL,
    test_message text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: reading_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reading_assessments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    session_id uuid,
    student_identifier character varying(100),
    student_number integer,
    concurrent_session_count integer DEFAULT 0,
    redis_session_key character varying(255),
    grade_level integer NOT NULL,
    language character varying(5) NOT NULL,
    passage_type character varying(20) NOT NULL,
    passage_text text NOT NULL,
    passage_image_url text,
    passage_generated_at timestamp with time zone,
    passage_word_count integer,
    audio_url text,
    audio_duration_seconds double precision,
    audio_format character varying(20),
    audio_size_bytes bigint,
    audio_uploaded_at timestamp with time zone,
    num_speakers_detected integer,
    detected_language character varying(5),
    audio_quality_score double precision,
    audio_validation_warnings jsonb,
    transcript_text text,
    transcript_confidence double precision,
    word_timestamps jsonb,
    total_words_in_passage integer,
    words_read integer,
    words_correct integer,
    wcpm double precision,
    accuracy_percentage double precision,
    time_elapsed_seconds double precision,
    pronunciation_data jsonb,
    prosody_analysis jsonb,
    errors jsonb,
    self_corrections_count integer DEFAULT 0,
    grade_benchmark_min integer,
    grade_benchmark_max integer,
    percentile_rank character varying(20),
    on_track boolean,
    is_second_language boolean DEFAULT true,
    report_pdf_url text,
    report_generated_at timestamp with time zone,
    voice_feedback_url text,
    voice_feedback_duration_seconds integer,
    voice_feedback_language character varying(10),
    diagnostic_summary text,
    comprehension_requested boolean DEFAULT false,
    comprehension_questions jsonb,
    comprehension_answers jsonb,
    comprehension_analysis jsonb,
    comprehension_score double precision,
    status character varying(50) DEFAULT 'pending'::character varying,
    processing_started_at timestamp with time zone,
    last_successful_step character varying(50),
    failed_step character varying(50),
    error_message text,
    can_resume boolean DEFAULT true,
    parent_shared boolean DEFAULT false,
    parent_shared_at timestamp with time zone,
    parent_message_generated text,
    transcription_cost numeric,
    pronunciation_cost numeric,
    analysis_cost numeric,
    report_cost numeric,
    voice_feedback_cost numeric,
    total_cost numeric,
    gpt4_input_tokens integer,
    gpt4_output_tokens integer,
    azure_api_calls integer,
    soniox_duration_seconds double precision,
    created_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    pronunciation_accuracy double precision,
    passage_title character varying(200),
    assessment_mode character varying(10) DEFAULT 'manual'::character varying,
    starting_level character varying(20),
    final_level character varying(20),
    level_attempts jsonb DEFAULT '{}'::jsonb,
    auto_level_history jsonb DEFAULT '[]'::jsonb,
    current_level_attempt integer DEFAULT 1,
    max_attempts_per_level integer DEFAULT 2,
    failed_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    phone_number character varying(64) NOT NULL,
    name character varying(100),
    grades_taught character varying(100),
    registration_completed boolean DEFAULT false,
    registration_started_at timestamp without time zone,
    registration_completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    school_name character varying(200),
    subjects_taught jsonb DEFAULT '[]'::jsonb,
    source character varying(50) DEFAULT 'direct'::character varying,
    session_id character varying(255),
    first_message_at timestamp without time zone,
    registered_at timestamp without time zone,
    registration_state text DEFAULT 'unregistered'::text,
    registration_state_updated_at timestamp with time zone,
    preferred_language character varying(10) DEFAULT 'ur'::character varying,
    portal_password_hash text,
    portal_invite_token text,
    portal_invite_expires_at timestamp with time zone,
    portal_activated boolean DEFAULT false,
    portal_last_login timestamp with time zone,
    password_reset_code character varying(6),
    password_reset_expires_at timestamp with time zone,
    language_locked boolean DEFAULT false,
    is_test_user boolean DEFAULT false,
    language_nudge_sent boolean DEFAULT false,
    registration_pending_name boolean DEFAULT false,
    country character varying(100),
    region character varying(100),
    organization character varying(200),
    preferences jsonb DEFAULT '{}'::jsonb,
    last_message_at timestamp with time zone,
    subject text,
    teacher_uuid uuid,
    school_id uuid,
    role character varying(32),
    conversation_state jsonb,
    conversation_state_expires_at timestamp with time zone,
    teacher_level character varying(16)[],
    teacher_level_updated_at timestamp with time zone,
    merged_into uuid,
    deleted_at timestamp with time zone,
    deleted_reason text,
    deleted_by text,
    training_bands character varying(16)[],
    training_bands_updated_at timestamp with time zone,
    CONSTRAINT users_merged_into_not_self CHECK (((merged_into IS NULL) OR (merged_into <> id))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['teacher'::character varying, 'principal'::character varying, 'coach'::character varying, 'unregistered'::character varying])::text[])))
);


--
-- Name: video_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid,
    topic text NOT NULL,
    language character varying(10) DEFAULT 'en'::character varying NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    current_step integer DEFAULT 0,
    script_data jsonb,
    slide_urls text[],
    video_segment_urls text[],
    pdf_url text,
    video_url text,
    generation_time_seconds integer,
    estimated_cost numeric,
    error_message text,
    retry_count integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    customization text,
    style character varying(20) DEFAULT 'infographic'::character varying
);


--
-- Name: mv_dashboard_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_dashboard_stats AS
 WITH date_ranges AS (
         SELECT now() AS now,
            (now() - '1 day'::interval) AS one_day_ago,
            (now() - '7 days'::interval) AS seven_days_ago,
            date_trunc('day'::text, now()) AS today_start
        ), user_stats AS (
         SELECT count(*) AS total_users,
            count(*) FILTER (WHERE (users.registration_completed_at IS NOT NULL)) AS registered_users
           FROM public.users
        ), message_stats AS (
         SELECT count(*) AS total_messages,
            count(*) FILTER (WHERE (((conversations.role)::text = 'user'::text) AND ((conversations.message_type)::text = 'voice'::text))) AS voice_received,
            count(*) FILTER (WHERE (((conversations.role)::text = 'assistant'::text) AND ((conversations.message_type)::text = 'voice'::text))) AS voice_sent
           FROM public.conversations
        ), active_users AS (
         SELECT d.one_day_ago,
            d.seven_days_ago,
            ( SELECT count(DISTINCT conversations.user_id) AS count
                   FROM public.conversations
                  WHERE (((conversations.role)::text = 'user'::text) AND (conversations.created_at >= d.one_day_ago))) AS dau,
            ( SELECT count(DISTINCT conversations.user_id) AS count
                   FROM public.conversations
                  WHERE (((conversations.role)::text = 'user'::text) AND (conversations.created_at >= d.seven_days_ago))) AS wau
           FROM date_ranges d
        ), session_stats AS (
         SELECT d.today_start,
            d.seven_days_ago,
            count(*) AS total_sessions,
            count(*) FILTER (WHERE (chat_sessions.started_at >= d.today_start)) AS sessions_today,
            count(*) FILTER (WHERE (chat_sessions.started_at >= d.seven_days_ago)) AS sessions_this_week,
            round(avg((EXTRACT(epoch FROM (chat_sessions.ended_at - chat_sessions.started_at)) / (60)::numeric)), 1) AS avg_session_length,
            round(avg(COALESCE(chat_sessions.message_count, 0)), 1) AS avg_messages_per_session
           FROM public.chat_sessions,
            date_ranges d
          WHERE (chat_sessions.ended_at IS NOT NULL)
          GROUP BY d.today_start, d.seven_days_ago
        ), feature_stats AS (
         SELECT ( SELECT count(*) AS count
                   FROM public.lesson_plans) AS total_lesson_plans,
            ( SELECT count(*) AS count
                   FROM public.lesson_plans
                  WHERE (lesson_plans.gamma_url IS NOT NULL)) AS total_presentations,
            ( SELECT count(*) AS count
                   FROM public.coaching_sessions
                  WHERE ((coaching_sessions.status)::text = 'completed'::text)) AS total_coaching_sessions,
            ( SELECT count(*) AS count
                   FROM public.video_requests
                  WHERE ((video_requests.status)::text = 'completed'::text)) AS total_videos_generated,
            ( SELECT count(*) AS count
                   FROM public.reading_assessments
                  WHERE ((reading_assessments.status)::text = 'completed'::text)) AS total_reading_assessments
        ), funnel_stats AS (
         SELECT
                CASE
                    WHEN (u_1.total_users > 0) THEN round(((100.0 * (u_1.registered_users)::numeric) / (u_1.total_users)::numeric), 1)
                    ELSE (0)::numeric
                END AS registration_rate,
                CASE
                    WHEN (u_1.total_users > 0) THEN round(((100.0 * (( SELECT count(DISTINCT feature_users.user_id) AS count
                       FROM ( SELECT lesson_plans.user_id
                               FROM public.lesson_plans
                            UNION
                             SELECT coaching_sessions.user_id
                               FROM public.coaching_sessions
                            UNION
                             SELECT reading_assessments.user_id
                               FROM public.reading_assessments) feature_users))::numeric) / (u_1.total_users)::numeric), 1)
                    ELSE (0)::numeric
                END AS feature_discovery_rate
           FROM user_stats u_1
        )
 SELECT u.total_users,
    m.total_messages,
    m.voice_received AS voice_notes_received,
    a.dau AS daily_active_users,
    a.wau AS weekly_active_users,
    COALESCE(s.total_sessions, (0)::bigint) AS total_sessions,
    COALESCE(s.sessions_today, (0)::bigint) AS sessions_today,
    COALESCE(s.sessions_this_week, (0)::bigint) AS sessions_this_week,
    COALESCE(s.avg_session_length, (0)::numeric) AS avg_session_length,
    COALESCE(s.avg_messages_per_session, (0)::numeric) AS avg_messages_per_session,
    f.total_lesson_plans,
    f.total_presentations,
    f.total_coaching_sessions,
    f.total_videos_generated,
    f.total_reading_assessments,
    fn.registration_rate,
    fn.feature_discovery_rate,
    now() AS last_refreshed
   FROM (((((user_stats u
     CROSS JOIN message_stats m)
     CROSS JOIN active_users a)
     LEFT JOIN session_stats s ON (true))
     CROSS JOIN feature_stats f)
     CROSS JOIN funnel_stats fn)
  WITH NO DATA;


--
-- Name: mv_dashboard_stats_by_country; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_dashboard_stats_by_country AS
 WITH user_stats AS (
         SELECT "left"((u.phone_number)::text, 2) AS country_code,
            count(*) AS total_users,
            count(*) FILTER (WHERE (u.registration_completed = true)) AS registered_users,
            count(*) FILTER (WHERE (u.created_at >= (now() - '1 day'::interval))) AS new_users_today,
            count(*) FILTER (WHERE (u.created_at >= (now() - '7 days'::interval))) AS new_users_week
           FROM public.users u
          WHERE (COALESCE(u.is_test_user, false) = false)
          GROUP BY ("left"((u.phone_number)::text, 2))
        ), message_stats AS (
         SELECT "left"((u.phone_number)::text, 2) AS country_code,
            count(c.id) AS total_messages,
            count(c.id) FILTER (WHERE (c.created_at >= (now() - '1 day'::interval))) AS messages_today,
            count(DISTINCT c.user_id) FILTER (WHERE (c.created_at >= (now() - '1 day'::interval))) AS dau,
            count(DISTINCT c.user_id) FILTER (WHERE (c.created_at >= (now() - '7 days'::interval))) AS wau
           FROM (public.users u
             LEFT JOIN public.conversations c ON ((c.user_id = u.id)))
          WHERE (COALESCE(u.is_test_user, false) = false)
          GROUP BY ("left"((u.phone_number)::text, 2))
        ), feature_stats AS (
         SELECT "left"((u.phone_number)::text, 2) AS country_code,
            count(DISTINCT lp.id) AS lesson_plans,
            count(DISTINCT cs.id) AS coaching_sessions,
            count(DISTINCT ra.id) AS reading_assessments,
            count(DISTINCT vr.id) AS video_requests
           FROM ((((public.users u
             LEFT JOIN public.lesson_plan_requests lp ON ((lp.user_id = u.id)))
             LEFT JOIN public.coaching_sessions cs ON ((cs.user_id = u.id)))
             LEFT JOIN public.reading_assessments ra ON ((ra.user_id = u.id)))
             LEFT JOIN public.video_requests vr ON ((vr.user_id = u.id)))
          WHERE (COALESCE(u.is_test_user, false) = false)
          GROUP BY ("left"((u.phone_number)::text, 2))
        )
 SELECT us.country_code,
    us.total_users,
    us.registered_users,
    us.new_users_today,
    us.new_users_week,
    COALESCE(ms.total_messages, (0)::bigint) AS total_messages,
    COALESCE(ms.messages_today, (0)::bigint) AS messages_today,
    COALESCE(ms.dau, (0)::bigint) AS daily_active_users,
    COALESCE(ms.wau, (0)::bigint) AS weekly_active_users,
    COALESCE(fs.lesson_plans, (0)::bigint) AS total_lesson_plans,
    COALESCE(fs.coaching_sessions, (0)::bigint) AS total_coaching_sessions,
    COALESCE(fs.reading_assessments, (0)::bigint) AS total_reading_assessments,
    COALESCE(fs.video_requests, (0)::bigint) AS total_video_requests,
    now() AS last_refreshed
   FROM ((user_stats us
     LEFT JOIN message_stats ms ON ((ms.country_code = us.country_code)))
     LEFT JOIN feature_stats fs ON ((fs.country_code = us.country_code)))
  WITH NO DATA;


--
-- Name: mv_retention_cohorts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_retention_cohorts AS
 WITH cohorts AS (
         SELECT u.id AS user_id,
            (date_trunc('week'::text, u.created_at))::date AS cohort_week,
            u.created_at AS user_start_date
           FROM public.users u
          WHERE ((u.created_at IS NOT NULL) AND (u.created_at >= (now() - '84 days'::interval)))
        ), activity_timeline AS (
         SELECT coaching_sessions.user_id,
            coaching_sessions.created_at AS activity_date,
            'coaching'::text AS activity_type,
            'overall'::text AS feature_type
           FROM public.coaching_sessions
          WHERE (((coaching_sessions.status)::text = 'completed'::text) AND (coaching_sessions.created_at >= (now() - '112 days'::interval)))
        UNION ALL
         SELECT lesson_plans.user_id,
            lesson_plans.created_at AS activity_date,
            'lesson_plan'::text AS activity_type,
            'overall'::text AS feature_type
           FROM public.lesson_plans
          WHERE (lesson_plans.created_at >= (now() - '112 days'::interval))
        UNION ALL
         SELECT reading_assessments.user_id,
            reading_assessments.created_at AS activity_date,
            'reading_assessment'::text AS activity_type,
            'overall'::text AS feature_type
           FROM public.reading_assessments
          WHERE (((reading_assessments.status)::text = 'completed'::text) AND (reading_assessments.created_at >= (now() - '112 days'::interval)))
        UNION ALL
         SELECT conversations.user_id,
            conversations.created_at AS activity_date,
            'conversation'::text AS activity_type,
            'overall'::text AS feature_type
           FROM public.conversations
          WHERE (conversations.created_at >= (now() - '112 days'::interval))
        ), retention_buckets AS (
         SELECT c.cohort_week,
            c.user_id,
            'overall'::text AS feature_type,
            bool_or(
                CASE
                    WHEN ((a.activity_date)::date = (c.user_start_date)::date) THEN true
                    ELSE false
                END) AS active_day0,
            bool_or(
                CASE
                    WHEN ((a.activity_date >= (c.user_start_date + '1 day'::interval)) AND (a.activity_date < (c.user_start_date + '8 days'::interval))) THEN true
                    ELSE false
                END) AS active_week1,
            bool_or(
                CASE
                    WHEN ((a.activity_date >= (c.user_start_date + '8 days'::interval)) AND (a.activity_date < (c.user_start_date + '15 days'::interval))) THEN true
                    ELSE false
                END) AS active_week2,
            bool_or(
                CASE
                    WHEN ((a.activity_date >= (c.user_start_date + '15 days'::interval)) AND (a.activity_date < (c.user_start_date + '22 days'::interval))) THEN true
                    ELSE false
                END) AS active_week3,
            bool_or(
                CASE
                    WHEN ((a.activity_date >= (c.user_start_date + '22 days'::interval)) AND (a.activity_date < (c.user_start_date + '29 days'::interval))) THEN true
                    ELSE false
                END) AS active_week4
           FROM (cohorts c
             LEFT JOIN activity_timeline a ON ((c.user_id = a.user_id)))
          GROUP BY c.cohort_week, c.user_id
        )
 SELECT cohort_week,
    feature_type,
    count(DISTINCT user_id) AS cohort_size,
    round(((100.0 * (count(DISTINCT user_id) FILTER (WHERE active_day0))::numeric) / (NULLIF(count(DISTINCT user_id), 0))::numeric), 1) AS day0_activation_pct,
    count(DISTINCT user_id) FILTER (WHERE active_week1) AS week1_users,
    round(((100.0 * (count(DISTINCT user_id) FILTER (WHERE active_week1))::numeric) / (NULLIF(count(DISTINCT user_id), 0))::numeric), 1) AS week1_pct,
    count(DISTINCT user_id) FILTER (WHERE active_week2) AS week2_users,
    round(((100.0 * (count(DISTINCT user_id) FILTER (WHERE active_week2))::numeric) / (NULLIF(count(DISTINCT user_id), 0))::numeric), 1) AS week2_pct,
    count(DISTINCT user_id) FILTER (WHERE active_week3) AS week3_users,
    round(((100.0 * (count(DISTINCT user_id) FILTER (WHERE active_week3))::numeric) / (NULLIF(count(DISTINCT user_id), 0))::numeric), 1) AS week3_pct,
    count(DISTINCT user_id) FILTER (WHERE active_week4) AS week4_users,
    round(((100.0 * (count(DISTINCT user_id) FILTER (WHERE active_week4))::numeric) / (NULLIF(count(DISTINCT user_id), 0))::numeric), 1) AS week4_pct,
    (CURRENT_DATE >= (cohort_week + '14 days'::interval)) AS has_week2_data,
    (CURRENT_DATE >= (cohort_week + '21 days'::interval)) AS has_week3_data,
    (CURRENT_DATE >= (cohort_week + '28 days'::interval)) AS has_week4_data,
    now() AS last_refreshed
   FROM retention_buckets rb
  GROUP BY cohort_week, feature_type
  ORDER BY cohort_week DESC
  WITH NO DATA;


--
-- Name: niete_lp612_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp612_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    render_id uuid,
    segment_id text NOT NULL,
    lang text NOT NULL,
    template_version text NOT NULL,
    surface text DEFAULT 'whatsapp'::text NOT NULL,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notice_seen_at timestamp with time zone,
    notice_opened_at timestamp with time zone,
    notice_whatsapp_at timestamp with time zone,
    CONSTRAINT niete_lp612_deliveries_lang_check CHECK ((lang = ANY (ARRAY['en'::text, 'ur'::text]))),
    CONSTRAINT niete_lp612_deliveries_surface_check CHECK ((surface = ANY (ARRAY['whatsapp'::text, 'portal'::text, 'backfill'::text])))
);


--
-- Name: niete_lp612_renders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp612_renders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    segment_id text NOT NULL,
    lang text NOT NULL,
    template_version text NOT NULL,
    status text DEFAULT 'authoring'::text NOT NULL,
    r2_key text,
    page_count integer,
    model_used text,
    rounds_used integer,
    lint_clean boolean,
    lint_fails jsonb,
    error_code text,
    error_detail text,
    waiters jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_by uuid,
    correlation_id text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    one_screen text,
    picked_up_at timestamp with time zone,
    over_cap boolean DEFAULT false NOT NULL,
    over_time boolean DEFAULT false NOT NULL,
    checkpoint jsonb,
    render_degraded boolean DEFAULT false NOT NULL,
    overlay_dropped boolean DEFAULT false NOT NULL,
    CONSTRAINT niete_lp612_renders_lang_check CHECK ((lang = ANY (ARRAY['en'::text, 'ur'::text]))),
    CONSTRAINT niete_lp612_renders_status_check CHECK ((status = ANY (ARRAY['authoring'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: niete_lp612_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp612_segments (
    segment_id text NOT NULL,
    book_stem text NOT NULL,
    grade integer NOT NULL,
    subject text NOT NULL,
    medium text,
    language text DEFAULT 'en'::text NOT NULL,
    chapter_number integer,
    chapter_title text,
    chapter_key text NOT NULL,
    part text,
    part_index integer,
    subtopic_title text NOT NULL,
    menu_title text NOT NULL,
    section_ref text,
    printed_page_start integer NOT NULL,
    printed_page_end integer NOT NULL,
    pages_covered integer[] DEFAULT '{}'::integer[] NOT NULL,
    order_index integer NOT NULL,
    day_number integer,
    segment_index integer,
    lp_type text DEFAULT 'content'::text NOT NULL,
    skill_type text,
    slo_text text,
    revision_source_segments text[] DEFAULT '{}'::text[] NOT NULL,
    prev_segment_id text,
    next_segment_id text,
    yt jsonb,
    is_religious boolean DEFAULT false NOT NULL,
    notes text,
    corpus_version text DEFAULT 'v1'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slo_codes text[] DEFAULT '{}'::text[] NOT NULL,
    slo_descriptions text[] DEFAULT '{}'::text[] NOT NULL,
    slo_source text,
    section text,
    also_grades integer[] DEFAULT '{}'::integer[] NOT NULL,
    CONSTRAINT niete_lp612_segments_grade_check CHECK (((grade >= 6) AND (grade <= 12))),
    CONSTRAINT niete_lp612_segments_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ur'::text]))),
    CONSTRAINT niete_lp612_segments_lp_type_check CHECK ((lp_type = ANY (ARRAY['content'::text, 'exercise_review'::text, 'assessment'::text, 'practical'::text, 'revision'::text])))
);


--
-- Name: niete_lp_ab_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_ab_assignment (
    school_id uuid NOT NULL,
    ab_group text NOT NULL,
    block text,
    seed text NOT NULL,
    drawn_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT niete_lp_ab_assignment_ab_group_check CHECK ((ab_group = ANY (ARRAY['A'::text, 'B'::text])))
);


--
-- Name: niete_lp_asset_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_asset_sources (
    asset_id uuid NOT NULL,
    lesson_id text NOT NULL,
    version_stamp text NOT NULL,
    content_hash text NOT NULL,
    slide_script jsonb NOT NULL,
    source_url text,
    verified text NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: niete_lp_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id text NOT NULL,
    catalog_version text DEFAULT 'v8'::text NOT NULL,
    version_stamp text NOT NULL,
    content_hash text NOT NULL,
    r2_key text NOT NULL,
    bytes bigint NOT NULL,
    source_bytes bigint,
    source_sha1 text,
    prompt_layer_sha text,
    rendered_at timestamp with time zone,
    asset_kind text DEFAULT 'lesson'::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT niete_lp_assets_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['lesson'::text, 'answer_key'::text])))
);


--
-- Name: niete_lp_downloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_downloads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    lesson_id text NOT NULL,
    asset_id uuid,
    version_stamp text,
    content_hash text,
    phone text,
    status text NOT NULL,
    error_text text,
    grade integer,
    subject text,
    chapter_number integer,
    segment_index integer,
    correlation_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT niete_lp_downloads_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: niete_lp_fidelity_moves; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_fidelity_moves (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lesson_id text NOT NULL,
    catalog_version text,
    version_stamp text,
    content_hash text,
    brief_sha text,
    template text,
    total_minutes integer,
    moves jsonb NOT NULL,
    n_moves integer,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: niete_lp_opens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.niete_lp_opens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_kind text NOT NULL,
    plan_ref text NOT NULL,
    lang text,
    source text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT niete_lp_opens_lang_check CHECK ((lang = ANY (ARRAY['en'::text, 'ur'::text]))),
    CONSTRAINT niete_lp_opens_plan_kind_check CHECK ((plan_kind = ANY (ARRAY['k5'::text, 'g612'::text]))),
    CONSTRAINT niete_lp_opens_plan_ref_check CHECK (((length(plan_ref) >= 1) AND (length(plan_ref) <= 200))),
    CONSTRAINT niete_lp_opens_source_check CHECK ((source = ANY (ARRAY['viewer'::text, 'external'::text])))
);


--
-- Name: nietemigrated_observation_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observation_answers (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    observation_id uuid NOT NULL,
    question_id bigint NOT NULL,
    answer_text text,
    single_choice_option_id bigint,
    student_number integer,
    is_lp_followed boolean,
    student_scores jsonb,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_observation_question_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observation_question_groups (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    section_id bigint NOT NULL,
    title text NOT NULL,
    "order" integer NOT NULL,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_observation_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observation_questions (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    prompt text NOT NULL,
    type text NOT NULL,
    required boolean NOT NULL,
    "order" integer NOT NULL,
    is_scored boolean NOT NULL,
    is_lp_followed boolean NOT NULL,
    purpose text,
    source text,
    tier text,
    section_id bigint,
    group_id bigint,
    lesson_plan_id bigint,
    core_lesson_plan_id bigint,
    subject_id bigint,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_observation_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observation_sections (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    template_id bigint NOT NULL,
    title text NOT NULL,
    "order" integer NOT NULL,
    is_scored boolean NOT NULL,
    section_type text,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_observation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observation_templates (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    name text NOT NULL,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_observations (
    id uuid NOT NULL,
    uuid uuid NOT NULL,
    number_of_boys integer NOT NULL,
    number_of_girls integer NOT NULL,
    observation_date date NOT NULL,
    start_time time without time zone NOT NULL,
    total_duration interval,
    feedback text,
    teacher_response text,
    agreed_with_feedback boolean,
    status text NOT NULL,
    audio_url text,
    template_id bigint NOT NULL,
    visit_id uuid,
    coach_id bigint,
    lesson_plan_id bigint,
    core_lesson_plan_id bigint,
    school_class_subject_id bigint,
    book_chapter_id bigint,
    user_profile_content_type_id integer,
    user_profile_object_id integer,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_question_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_question_options (
    id bigint NOT NULL,
    uuid uuid NOT NULL,
    question_id bigint NOT NULL,
    label text NOT NULL,
    value text NOT NULL,
    "order" integer NOT NULL,
    score_type text,
    is_correct boolean NOT NULL,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_school_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_school_visits (
    id uuid NOT NULL,
    uuid uuid NOT NULL,
    scheduled_date date,
    visit_date date,
    comments text,
    status text NOT NULL,
    type text,
    school_id bigint NOT NULL,
    visit_plan_id uuid,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_teacher_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_teacher_visits (
    id uuid NOT NULL,
    uuid uuid NOT NULL,
    scheduled_date date,
    visit_date date,
    comments text,
    status text NOT NULL,
    visit_purpose text NOT NULL,
    school_visit_id uuid,
    teacher_id bigint NOT NULL,
    coach_id bigint,
    grade_subject_id bigint,
    school_id bigint,
    section text,
    user_profile_content_type_id integer,
    user_profile_object_id integer,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: nietemigrated_visit_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nietemigrated_visit_plans (
    id uuid NOT NULL,
    uuid uuid NOT NULL,
    name text,
    from_date date NOT NULL,
    to_date date NOT NULL,
    regional_manager_id bigint,
    user_profile_content_type_id integer,
    user_profile_object_id integer,
    created timestamp with time zone NOT NULL,
    modified timestamp with time zone NOT NULL,
    source_system text DEFAULT 'fde_production'::text NOT NULL,
    migrated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean,
    deleted_at timestamp with time zone
);


--
-- Name: observation_field_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observation_field_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    observer_user_id uuid NOT NULL,
    teacher_user_id uuid,
    coaching_session_id uuid,
    rubric_version text NOT NULL,
    period_minutes smallint,
    visit_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    opened_at timestamp with time zone,
    part1_done_at timestamp with time zone,
    part2_done_at timestamp with time zone,
    sealed_at timestamp with time zone,
    rumi_moments jsonb,
    rumi_levels jsonb,
    moments_ready_at timestamp with time zone,
    evidence_review jsonb DEFAULT '{}'::jsonb NOT NULL,
    final_levels jsonb,
    checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT observation_field_forms_period_minutes_check CHECK (((period_minutes >= 20) AND (period_minutes <= 90)))
);


--
-- Name: observation_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.observation_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    leader_user_id uuid NOT NULL,
    school_ext_id text NOT NULL,
    teacher_ext_id text NOT NULL,
    teacher_name text,
    school_name text,
    scheduled_for date NOT NULL,
    scheduled_slot text,
    status text DEFAULT 'upcoming'::text NOT NULL,
    session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    calendar_event_id text,
    school_id uuid,
    teacher_user_id uuid,
    CONSTRAINT observation_schedules_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'done'::text, 'cancelled'::text])))
);


--
-- Name: pic_lp_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pic_lp_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    caption text,
    detected jsonb,
    flow_token text,
    lp_request_id uuid,
    correlation_id text,
    last_error text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pic_lp_sessions_status_check CHECK ((status = ANY (ARRAY['awaiting_intent'::text, 'collecting_pages'::text, 'awaiting_form_submit'::text, 'generating'::text, 'handed_off'::text, 'cancelled'::text, 'timed_out'::text, 'failed'::text])))
);


--
-- Name: portal_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_organizations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    default_scope_type character varying(20),
    default_scope_value jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    is_active boolean DEFAULT true
);


--
-- Name: pre_generated_lps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pre_generated_lps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    textbook_id uuid,
    chapter_title text,
    chapter_number integer,
    page_start integer,
    page_end integer,
    days integer DEFAULT 5,
    gamma_url_en text,
    gamma_url_ur text,
    pdf_r2_key_en text,
    pdf_r2_key_ur text,
    subject text,
    curriculum text,
    grade integer,
    prompt_version text DEFAULT 'v1'::text,
    is_current boolean DEFAULT true,
    generation_status text DEFAULT 'pending'::text,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pre_generated_lps_generation_status_check CHECK ((generation_status = ANY (ARRAY['pending'::text, 'generating'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: qa_analyst_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_analyst_proposals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title character varying(200) NOT NULL,
    hypothesis text,
    proposed_changes jsonb,
    expected_impact text,
    data_points jsonb,
    status character varying(30) DEFAULT 'pending'::character varying,
    reviewed_by character varying(100),
    reviewed_at timestamp with time zone,
    review_notes text,
    implementation_pr character varying(200),
    implemented_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: qa_bug_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_bug_patterns (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    pattern_name character varying(200) NOT NULL,
    error_signature text NOT NULL,
    root_cause text,
    resolution text,
    affected_files text[],
    severity character varying(20) DEFAULT 'medium'::character varying,
    is_resolved boolean DEFAULT false,
    times_seen integer DEFAULT 1,
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: qa_test_runs_run_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_test_runs_run_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_test_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    run_number integer DEFAULT nextval('public.qa_test_runs_run_number_seq'::regclass) NOT NULL,
    trigger_type character varying(50) NOT NULL,
    triggered_by character varying(100),
    scenarios jsonb NOT NULL,
    results jsonb,
    status character varying(20) DEFAULT 'running'::character varying,
    error_message text,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    evidence jsonb
);


--
-- Name: quiz_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    question_id uuid NOT NULL,
    selected_option text NOT NULL,
    is_correct boolean NOT NULL,
    difficulty_at_time integer,
    response_time_seconds integer,
    created_at timestamp with time zone DEFAULT now(),
    answered_at timestamp with time zone DEFAULT now(),
    CONSTRAINT quiz_answers_selected_option_check CHECK ((selected_option ~ '^[A-D](,[A-D])*$'::text))
);


--
-- Name: quiz_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_id uuid NOT NULL,
    question_text text NOT NULL,
    option_a text NOT NULL,
    option_b text NOT NULL,
    option_c text,
    correct_option text NOT NULL,
    explanation text,
    misconception_feedback text,
    distractor_misconceptions jsonb,
    difficulty_level integer DEFAULT 3 NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    option_d text,
    media jsonb,
    option_feedback jsonb,
    render_pattern text,
    external_id text,
    CONSTRAINT quiz_questions_correct_option_check CHECK ((correct_option ~ '^[A-D](,[A-D])*$'::text)),
    CONSTRAINT quiz_questions_difficulty_level_check CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5))),
    CONSTRAINT quiz_questions_distractor_misconceptions_check CHECK (((distractor_misconceptions IS NULL) OR (jsonb_typeof(distractor_misconceptions) = 'object'::text)))
);


--
-- Name: quiz_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_id uuid NOT NULL,
    student_id uuid,
    parent_phone text,
    status text DEFAULT 'invited'::text NOT NULL,
    current_difficulty integer DEFAULT 3,
    total_questions_answered integer DEFAULT 0,
    correct_answers integer DEFAULT 0,
    mastery_percentage integer,
    mastery_level text,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    idle_reminder_sent boolean DEFAULT false,
    user_id uuid,
    student_name text,
    student_class text,
    share_code_id uuid,
    source text DEFAULT 'roster'::text NOT NULL,
    invited_by_student_id uuid,
    device_ref text,
    CONSTRAINT quiz_sessions_current_difficulty_check CHECK (((current_difficulty >= 1) AND (current_difficulty <= 5))),
    CONSTRAINT quiz_sessions_has_identity CHECK (((student_id IS NOT NULL) OR (user_id IS NOT NULL) OR (student_name IS NOT NULL))),
    CONSTRAINT quiz_sessions_mastery_level_check CHECK ((mastery_level = ANY (ARRAY['mastered'::text, 'developing'::text, 'needs_practice'::text]))),
    CONSTRAINT quiz_sessions_source_check CHECK ((source = ANY (ARRAY['roster'::text, 'video_solo'::text, 'share_link'::text]))),
    CONSTRAINT quiz_sessions_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'in_progress'::text, 'completed'::text, 'incomplete'::text, 'expired'::text, 'cancelled'::text])))
);


--
-- Name: quiz_share_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_share_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    quiz_id uuid NOT NULL,
    teacher_user_id uuid NOT NULL,
    video_id uuid,
    teacher_name text,
    topic text,
    language text DEFAULT 'en'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    uses_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    report_sent_at timestamp with time zone,
    invited_by_student_id uuid,
    parent_share_code_id uuid,
    class_id uuid
);


--
-- Name: quizzes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quizzes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid,
    lesson_plan_id uuid,
    list_id uuid,
    quiz_source text DEFAULT 'lesson_plan'::text NOT NULL,
    topic text NOT NULL,
    grade text,
    subject text,
    source_content text,
    status text DEFAULT 'generating'::text NOT NULL,
    total_students_sent integer DEFAULT 0,
    total_students_completed integer,
    report_scheduled_at timestamp with time zone,
    report_sent_at timestamp with time zone,
    report_pdf_url text,
    created_at timestamp with time zone DEFAULT now(),
    video_id uuid,
    coaching_session_id uuid,
    language text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT quizzes_status_check CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'sent'::text, 'report_sent'::text, 'failed'::text, 'cancelled'::text, 'offered'::text, 'declined'::text, 'skipped'::text])))
);


--
-- Name: record_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_history (
    id bigint NOT NULL,
    table_name text NOT NULL,
    row_id text NOT NULL,
    op text NOT NULL,
    changed_cols text[] NOT NULL,
    old_vals jsonb,
    new_vals jsonb,
    actor text,
    actor_source text NOT NULL,
    txid bigint DEFAULT txid_current() NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT record_history_actor_source_check CHECK ((actor_source = ANY (ARRAY['postgrest'::text, 'service_role'::text, 'sql'::text]))),
    CONSTRAINT record_history_op_check CHECK ((op = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: record_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.record_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: record_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.record_history_id_seq OWNED BY public.record_history.id;


--
-- Name: region_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.region_features (
    region text NOT NULL,
    curriculum_key text,
    supported_subjects text[] DEFAULT '{}'::text[],
    has_textbooks boolean DEFAULT false,
    curriculum_lp_enabled boolean DEFAULT false,
    pic_lp_enabled boolean DEFAULT true,
    gamma_lp_enabled boolean DEFAULT true,
    default_framework text DEFAULT 'oecd'::text,
    supported_languages jsonb DEFAULT '["en"]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: release_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version character varying(20) NOT NULL,
    title character varying(200) NOT NULL,
    description text NOT NULL,
    details text,
    category character varying(50) DEFAULT 'feature'::character varying NOT NULL,
    environment character varying(20) DEFAULT 'staging'::character varying NOT NULL,
    icon character varying(50) DEFAULT 'sparkles'::character varying,
    is_highlighted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    published_at timestamp with time zone,
    created_by character varying(100) DEFAULT 'release-notes-agent'::character varying
);


--
-- Name: schema_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_versions (
    version character varying(20) NOT NULL,
    applied_at timestamp without time zone DEFAULT now(),
    description text
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    region character varying(64),
    principal_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    emis text,
    source_school_id bigint,
    source_system text,
    is_active boolean DEFAULT true NOT NULL,
    is_probable_test boolean DEFAULT false NOT NULL
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    code text NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    code text NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: student_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.student_code_seq
    START WITH 100000
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: student_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_lists (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    class_name character varying(100) NOT NULL,
    section character varying(20),
    academic_year character varying(10) NOT NULL,
    attendance_frequency character varying(10) DEFAULT 'once'::character varying,
    student_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    class_id uuid
);


--
-- Name: student_video_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_video_feedback (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    video_id uuid,
    useful boolean NOT NULL,
    reason_text text,
    reason_received_at timestamp with time zone,
    reason_language text,
    reason_polarity text,
    grade character varying(50),
    subject character varying(100),
    topic character varying(200),
    subtopic character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scope text DEFAULT 'video'::text NOT NULL,
    quiz_useful boolean,
    quiz_session_id uuid,
    delivery_id uuid,
    CONSTRAINT student_video_feedback_reason_polarity_check CHECK ((reason_polarity = ANY (ARRAY['liked'::text, 'disliked'::text, 'unknown'::text]))),
    CONSTRAINT student_video_feedback_scope_check CHECK ((scope = ANY (ARRAY['video'::text, 'video_and_quiz'::text]))),
    CONSTRAINT svf_scope_quiz_useful_consistent CHECK ((((scope = 'video'::text) AND (quiz_useful IS NULL)) OR ((scope = 'video_and_quiz'::text) AND (quiz_useful IS NOT NULL))))
);


--
-- Name: student_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_videos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    grade character varying(50) NOT NULL,
    subject character varying(100) NOT NULL,
    topic character varying(200) NOT NULL,
    subtopic character varying(200),
    video_url text NOT NULL,
    original_filename text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    r2_url text,
    migration_status text DEFAULT 'pending'::text NOT NULL,
    clean_chapter text,
    clean_title text,
    superseded_by uuid,
    CONSTRAINT student_videos_superseded_by_not_self CHECK (((superseded_by IS NULL) OR (superseded_by <> id)))
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    list_id uuid,
    roll_number integer,
    student_name character varying(200) NOT NULL,
    father_name character varying(200),
    student_name_urdu text,
    father_name_urdu text,
    parent_phone text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    phone text,
    self_reported_class text,
    enrolled_by_user_id uuid,
    school_id uuid,
    admission_no text,
    date_of_birth date,
    status text DEFAULT 'active'::text NOT NULL,
    merged_into uuid,
    student_code text DEFAULT ('S-'::text || nextval('public.student_code_seq'::regclass)),
    import_run_id text,
    CONSTRAINT students_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'merged'::text])))
);


--
-- Name: subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subjects (
    code text NOT NULL,
    parent_code text,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: supervisor_remark_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_remark_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    remark_id uuid NOT NULL,
    indicator_ordinal smallint NOT NULL,
    score smallint NOT NULL,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supervisor_remark_scores_ordinal_valid CHECK (((indicator_ordinal >= 1) AND (indicator_ordinal <= 5))),
    CONSTRAINT supervisor_remark_scores_score_valid CHECK (((score >= 1) AND (score <= 4)))
);


--
-- Name: supervisor_remarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_remarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cycle_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    principal_user_id uuid NOT NULL,
    school_id uuid,
    comment_text text,
    comment_audio_id character varying(128),
    comment_language character varying(8),
    submitted_at timestamp with time zone,
    narrative_text text,
    narrative_generated_at timestamp with time zone,
    narrative_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supervisor_remarks_no_self CHECK ((teacher_id <> principal_user_id))
);


--
-- Name: teacher_attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_attendance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    teacher_id uuid NOT NULL,
    school_id uuid NOT NULL,
    date date NOT NULL,
    status character varying(16) NOT NULL,
    leave_type character varying(16),
    marked_by_user_id uuid NOT NULL,
    marked_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_attendance_leave_type_valid CHECK (((((status)::text = 'leave'::text) AND ((leave_type)::text = ANY (ARRAY[('casual'::character varying)::text, ('sick'::character varying)::text, ('official'::character varying)::text]))) OR (((status)::text <> 'leave'::text) AND (leave_type IS NULL)))),
    CONSTRAINT teacher_attendance_status_valid CHECK (((status)::text = ANY (ARRAY[('present'::character varying)::text, ('absent'::character varying)::text, ('leave'::character varying)::text])))
);


--
-- Name: teacher_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_facts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    fact text NOT NULL,
    category character varying(50),
    confidence double precision,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: teacher_nudges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_nudges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    nudge_date date NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    answered_at timestamp with time zone,
    choice text,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    quiz_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT teacher_nudges_kind_check CHECK ((kind = ANY (ARRAY['coaching_after_lp'::text, 'lp_quiz_offer'::text]))),
    CONSTRAINT teacher_nudges_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text, 'expired'::text])))
);


--
-- Name: teacher_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_progress (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    dimension character varying(50),
    score double precision,
    evidence text,
    session_id uuid,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: teacher_training_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_training_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    program_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by character varying(64) NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: teacher_training_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teacher_training_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    module_id bigint NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: textbook_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.textbook_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    textbook_id uuid NOT NULL,
    pdf_page_index integer,
    textbook_page_number integer,
    page_content text,
    page_images jsonb DEFAULT '[]'::jsonb,
    learning_outcomes jsonb DEFAULT '[]'::jsonb,
    exercises jsonb DEFAULT '[]'::jsonb,
    teaching_points jsonb DEFAULT '[]'::jsonb,
    has_tables boolean DEFAULT false,
    has_math boolean DEFAULT false,
    has_urdu boolean DEFAULT false,
    content_length integer,
    ocr_confidence double precision,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: textbook_toc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.textbook_toc (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    textbook_id uuid,
    chapter_number integer,
    chapter_title text NOT NULL,
    page_start integer,
    page_end integer,
    topic_keywords text[] DEFAULT '{}'::text[],
    learning_outcomes text[] DEFAULT '{}'::text[],
    estimated_days integer DEFAULT 5,
    is_manual_override boolean DEFAULT false,
    curriculum text,
    grade integer,
    subject text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: textbooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.textbooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    province text,
    curriculum text,
    grade integer,
    subject text,
    filename text,
    r2_key text,
    total_pages integer,
    pdf_page_offset integer DEFAULT 0,
    ocr_status text DEFAULT 'pending'::text,
    ocr_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT textbooks_grade_check CHECK (((grade >= 1) AND (grade <= 12)))
);


--
-- Name: training_assessment_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_assessment_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    question_index integer NOT NULL,
    question_id bigint NOT NULL,
    chosen_option character varying(32),
    is_correct boolean,
    answered_at timestamp with time zone DEFAULT now() NOT NULL,
    answer_text text,
    answer_score smallint,
    feedback_text text
);


--
-- Name: training_assessment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_assessment_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    program_id uuid NOT NULL,
    grand_quiz_id bigint,
    level_id bigint,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    current_question_index integer DEFAULT 0 NOT NULL,
    total_questions integer NOT NULL,
    status public.training_attempt_status DEFAULT 'in_progress'::public.training_attempt_status NOT NULL,
    score integer,
    total_score integer NOT NULL,
    is_passed boolean,
    completed_at timestamp with time zone,
    cooldown_until timestamp with time zone,
    quiz_kind character varying(32) DEFAULT 'grand'::character varying NOT NULL,
    training_module_id bigint,
    CONSTRAINT training_assessment_attempts_kind_target_ck CHECK (((((quiz_kind)::text = 'grand'::text) AND (grand_quiz_id IS NOT NULL) AND (training_module_id IS NULL)) OR (((quiz_kind)::text = 'training_module'::text) AND (training_module_id IS NOT NULL)) OR (((quiz_kind)::text = 'capstone'::text) AND (grand_quiz_id IS NOT NULL) AND (training_module_id IS NULL))))
);


--
-- Name: training_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    program_id uuid NOT NULL,
    level_id bigint NOT NULL,
    attempt_id uuid,
    certificate_code character varying(64) NOT NULL,
    teacher_name_snapshot character varying(200) NOT NULL,
    level_name_snapshot character varying(200) NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_r2_key character varying(500)
);


--
-- Name: training_content_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_content_change_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type character varying(64) NOT NULL,
    entity_id character varying(64) NOT NULL,
    origin character varying(32) NOT NULL,
    actor character varying(200),
    before_json jsonb,
    after_json jsonb,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_courses (
    id bigint NOT NULL,
    level_id bigint NOT NULL,
    source_course_id bigint,
    title character varying(500) NOT NULL,
    course_type character varying(64),
    order_index integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: training_courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_courses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_courses_id_seq OWNED BY public.training_courses.id;


--
-- Name: training_grand_quizzes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_grand_quizzes (
    id bigint NOT NULL,
    level_id bigint NOT NULL,
    source_quiz_id bigint,
    quiz_type character varying(32) DEFAULT 'grand_quiz'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: training_grand_quizzes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_grand_quizzes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_grand_quizzes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_grand_quizzes_id_seq OWNED BY public.training_grand_quizzes.id;


--
-- Name: training_levels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_levels (
    id bigint NOT NULL,
    vendor_id uuid NOT NULL,
    source_level_id bigint,
    name character varying(200) NOT NULL,
    order_index integer NOT NULL,
    cpd_level integer,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: training_levels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_levels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_levels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_levels_id_seq OWNED BY public.training_levels.id;


--
-- Name: training_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_modules (
    id bigint NOT NULL,
    course_id bigint NOT NULL,
    source_module_id bigint,
    title character varying(500) NOT NULL,
    content_html text,
    audio_url text,
    video_url text,
    source_media_url text,
    duration_seconds integer,
    order_index integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: training_modules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_modules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_modules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_modules_id_seq OWNED BY public.training_modules.id;


--
-- Name: training_program_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_program_scopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    program_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    level_ids bigint[],
    course_ids bigint[],
    module_ids bigint[]
);


--
-- Name: training_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(64) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_questions (
    id bigint NOT NULL,
    grand_quiz_id bigint,
    training_module_id bigint,
    source_question_id bigint,
    question_text text NOT NULL,
    question_urdu text,
    options jsonb,
    correct_option character varying(16),
    bloom_level character varying(32),
    order_index integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    option_images jsonb,
    rubric jsonb,
    CONSTRAINT training_questions_check CHECK (((grand_quiz_id IS NOT NULL) OR (training_module_id IS NOT NULL)))
);


--
-- Name: training_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_questions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_questions_id_seq OWNED BY public.training_questions.id;


--
-- Name: training_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(32) NOT NULL,
    name character varying(200) NOT NULL,
    passing_pct integer NOT NULL,
    cooldown_hours integer DEFAULT 24 NOT NULL,
    has_grand_quiz boolean DEFAULT true NOT NULL,
    has_diagnostic boolean DEFAULT false NOT NULL,
    cert_code_prefix character varying(8) NOT NULL,
    unlock_logic character varying(16) DEFAULT 'chain'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    module_passing_pct smallint DEFAULT 100 NOT NULL,
    module_quiz_strategy character varying(32) DEFAULT 'all'::character varying NOT NULL,
    exam_question_cap integer,
    shuffle_options boolean DEFAULT false NOT NULL,
    level_unlock_logic text DEFAULT 'chain'::text NOT NULL,
    module_unlock_logic text DEFAULT 'chain'::text NOT NULL,
    capstone_points_per_question smallint,
    module_quiz_ungated boolean DEFAULT false NOT NULL,
    CONSTRAINT training_vendors_exam_question_cap_ck CHECK (((exam_question_cap IS NULL) OR (exam_question_cap > 0))),
    CONSTRAINT training_vendors_module_quiz_strategy_ck CHECK (((module_quiz_strategy)::text = ANY (ARRAY[('all'::character varying)::text, ('one_per_bloom'::character varying)::text])))
);


--
-- Name: user_feature_first_use; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feature_first_use (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    feature text NOT NULL,
    video_shown_at timestamp with time zone DEFAULT now(),
    feature_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    intro_shown_count integer DEFAULT 0 NOT NULL
);


--
-- Name: v_exam_bank_chapters; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_exam_bank_chapters AS
 SELECT DISTINCT grade,
    subject,
    language,
    chapter_index,
    chapter_title
   FROM public.exam_question_bank
  ORDER BY grade, subject, language, chapter_index;


--
-- Name: v_exam_bank_grades; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_exam_bank_grades AS
 SELECT DISTINCT grade
   FROM public.exam_question_bank
  ORDER BY grade;


--
-- Name: v_exam_bank_subjects; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_exam_bank_subjects AS
 SELECT DISTINCT subject
   FROM public.exam_question_bank
  ORDER BY subject;


--
-- Name: v_supervisor_remark_scores; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_supervisor_remark_scores AS
 SELECT r.id AS remark_id,
    r.cycle_id,
    r.teacher_id,
    r.principal_user_id,
    r.school_id,
    r.submitted_at,
    max(s.score) FILTER (WHERE (s.indicator_ordinal = 1)) AS score_growth,
    max(s.score) FILTER (WHERE (s.indicator_ordinal = 2)) AS score_collaboration,
    max(s.score) FILTER (WHERE (s.indicator_ordinal = 3)) AS score_leadership,
    max(s.score) FILTER (WHERE (s.indicator_ordinal = 4)) AS score_student_support,
    max(s.score) FILTER (WHERE (s.indicator_ordinal = 5)) AS score_parents,
    (sum(s.score))::integer AS s_score,
    round((((sum(s.score))::numeric / (20)::numeric) * (100)::numeric), 1) AS s_pct
   FROM (public.supervisor_remarks r
     JOIN public.supervisor_remark_scores s ON ((s.remark_id = r.id)))
  WHERE (r.submitted_at IS NOT NULL)
  GROUP BY r.id, r.cycle_id, r.teacher_id, r.principal_user_id, r.school_id, r.submitted_at
 HAVING (count(s.id) = 5);


--
-- Name: video_quiz_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_quiz_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    video_id uuid,
    phone character varying(50),
    status text NOT NULL,
    grade character varying(50),
    subject character varying(100),
    title text,
    correlation_id text,
    delivered_at timestamp with time zone DEFAULT now() NOT NULL,
    quiz_offered_at timestamp with time zone,
    quiz_response text,
    quiz_responded_at timestamp with time zone,
    quiz_session_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT video_quiz_deliveries_quiz_response_check CHECK ((quiz_response = ANY (ARRAY['accepted'::text, 'shared'::text, 'declined'::text, 'ignored'::text]))),
    CONSTRAINT video_quiz_deliveries_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: video_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    video_request_id uuid NOT NULL,
    filename text NOT NULL,
    task_id text NOT NULL,
    task_type text NOT NULL,
    status text DEFAULT 'polling'::text NOT NULL,
    result_url text,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    ephemeral_url text
);


--
-- Name: videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.videos (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    filename character varying(200) NOT NULL,
    url character varying(500) NOT NULL,
    grade character varying(20),
    subject character varying(50),
    topic character varying(100),
    source character varying(50),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: wcpm_percentiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wcpm_percentiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wcpm_percentiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wcpm_percentiles (
    id integer DEFAULT nextval('public.wcpm_percentiles_id_seq'::regclass) NOT NULL,
    grade_level integer NOT NULL,
    language character varying(5) DEFAULT 'en'::character varying NOT NULL,
    season character varying(10) NOT NULL,
    percentile integer NOT NULL,
    wcpm_threshold integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: web_quiz_challenge_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.web_quiz_challenge_runs (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    exercise text NOT NULL,
    grade smallint,
    lang text,
    status text NOT NULL,
    score jsonb,
    wcpm numeric,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scored_at timestamp with time zone,
    CONSTRAINT web_quiz_challenge_runs_exercise_check CHECK ((exercise = ANY (ARRAY['listen'::text, 'sounds'::text, 'read'::text, 'numbers'::text, 'bigger'::text, 'missing'::text, 'sums'::text]))),
    CONSTRAINT web_quiz_challenge_runs_grade_check CHECK (((grade >= 1) AND (grade <= 12))),
    CONSTRAINT web_quiz_challenge_runs_lang_check CHECK ((lang = ANY (ARRAY['en'::text, 'ur'::text]))),
    CONSTRAINT web_quiz_challenge_runs_status_check CHECK ((status = ANY (ARRAY['scoring'::text, 'scored'::text, 'failed'::text])))
);


--
-- Name: website_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.website_visits (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    session_id character varying(255) NOT NULL,
    ip_hash character varying(64),
    user_agent text,
    referrer text,
    landing_page text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: call_trace id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_trace ALTER COLUMN id SET DEFAULT nextval('public.call_trace_id_seq'::regclass);


--
-- Name: hcp_coaching_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_coaching_actions ALTER COLUMN id SET DEFAULT nextval('public.hcp_coaching_actions_id_seq'::regclass);


--
-- Name: lesson_plan_catalog id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plan_catalog ALTER COLUMN id SET DEFAULT nextval('public.lesson_plan_catalog_id_seq'::regclass);


--
-- Name: record_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_history ALTER COLUMN id SET DEFAULT nextval('public.record_history_id_seq'::regclass);


--
-- Name: training_courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses ALTER COLUMN id SET DEFAULT nextval('public.training_courses_id_seq'::regclass);


--
-- Name: training_grand_quizzes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_grand_quizzes ALTER COLUMN id SET DEFAULT nextval('public.training_grand_quizzes_id_seq'::regclass);


--
-- Name: training_levels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_levels ALTER COLUMN id SET DEFAULT nextval('public.training_levels_id_seq'::regclass);


--
-- Name: training_modules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_modules ALTER COLUMN id SET DEFAULT nextval('public.training_modules_id_seq'::regclass);


--
-- Name: training_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_questions ALTER COLUMN id SET DEFAULT nextval('public.training_questions_id_seq'::regclass);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: mv_users_activity; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_users_activity AS
 SELECT u.id,
    u.phone_number,
    "left"((u.phone_number)::text, 2) AS country_code,
    lower((COALESCE(u.school_name, ''::character varying))::text) AS school_name_lower,
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
    count(c.id) FILTER (WHERE ((c.role)::text = 'user'::text)) AS user_messages,
    count(c.id) FILTER (WHERE ((c.message_type)::text = 'voice'::text)) AS voice_messages,
    now() AS last_refreshed
   FROM (public.users u
     LEFT JOIN public.conversations c ON ((c.user_id = u.id)))
  GROUP BY u.id
  WITH NO DATA;


--
-- Name: mv_view_refresh_status; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_view_refresh_status AS
 SELECT 'mv_dashboard_stats'::text AS view_name,
    ( SELECT mv_dashboard_stats.last_refreshed
           FROM public.mv_dashboard_stats
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM public.mv_dashboard_stats) AS row_count
UNION ALL
 SELECT 'mv_users_activity'::text AS view_name,
    ( SELECT mv_users_activity.last_refreshed
           FROM public.mv_users_activity
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM public.mv_users_activity) AS row_count
UNION ALL
 SELECT 'mv_retention_cohorts'::text AS view_name,
    ( SELECT mv_retention_cohorts.last_refreshed
           FROM public.mv_retention_cohorts
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM public.mv_retention_cohorts) AS row_count
UNION ALL
 SELECT 'mv_dashboard_stats_by_country'::text AS view_name,
    ( SELECT mv_dashboard_stats_by_country.last_refreshed
           FROM public.mv_dashboard_stats_by_country
         LIMIT 1) AS last_refresh,
    ( SELECT count(*) AS count
           FROM public.mv_dashboard_stats_by_country) AS row_count
  WITH NO DATA;


--
-- Name: ab_test_events ab_test_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT ab_test_events_pkey PRIMARY KEY (id);


--
-- Name: ab_test_variants ab_test_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_variants
    ADD CONSTRAINT ab_test_variants_pkey PRIMARY KEY (id);


--
-- Name: ab_test_variants ab_test_variants_test_id_variant_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_variants
    ADD CONSTRAINT ab_test_variants_test_id_variant_name_key UNIQUE (variant_name, test_id);


--
-- Name: ab_tests ab_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_tests
    ADD CONSTRAINT ab_tests_pkey PRIMARY KEY (id);


--
-- Name: ab_tests ab_tests_test_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_tests
    ADD CONSTRAINT ab_tests_test_name_key UNIQUE (test_name);


--
-- Name: academic_sessions academic_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_sessions
    ADD CONSTRAINT academic_sessions_pkey PRIMARY KEY (code);


--
-- Name: access_scopes access_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_scopes
    ADD CONSTRAINT access_scopes_pkey PRIMARY KEY (id);


--
-- Name: ama_conversations ama_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_conversations
    ADD CONSTRAINT ama_conversations_pkey PRIMARY KEY (id);


--
-- Name: ama_messages ama_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_messages
    ADD CONSTRAINT ama_messages_pkey PRIMARY KEY (id);


--
-- Name: ama_query_audit ama_query_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_query_audit
    ADD CONSTRAINT ama_query_audit_pkey PRIMARY KEY (id);


--
-- Name: api_usage_log api_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_log
    ADD CONSTRAINT api_usage_log_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: assessment_papers assessment_papers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_papers
    ADD CONSTRAINT assessment_papers_pkey PRIMARY KEY (id);


--
-- Name: assessment_requests assessment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_requests
    ADD CONSTRAINT assessment_requests_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: attendance_sessions attendance_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_pkey PRIMARY KEY (id);


--
-- Name: audio_sessions audio_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_sessions
    ADD CONSTRAINT audio_sessions_pkey PRIMARY KEY (id);


--
-- Name: broadcast_logs broadcast_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_logs
    ADD CONSTRAINT broadcast_logs_pkey PRIMARY KEY (id);


--
-- Name: broadcast_messages broadcast_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_messages
    ADD CONSTRAINT broadcast_messages_pkey PRIMARY KEY (id);


--
-- Name: byof_approval_log byof_approval_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_approval_log
    ADD CONSTRAINT byof_approval_log_pkey PRIMARY KEY (id);


--
-- Name: byof_messages byof_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_messages
    ADD CONSTRAINT byof_messages_pkey PRIMARY KEY (id);


--
-- Name: byof_plans byof_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_plans
    ADD CONSTRAINT byof_plans_pkey PRIMARY KEY (id);


--
-- Name: byof_sessions byof_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_sessions
    ADD CONSTRAINT byof_sessions_pkey PRIMARY KEY (id);


--
-- Name: call_memory call_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_memory
    ADD CONSTRAINT call_memory_pkey PRIMARY KEY (caller_number);


--
-- Name: call_recall_docs call_recall_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_recall_docs
    ADD CONSTRAINT call_recall_docs_pkey PRIMARY KEY (id);


--
-- Name: call_trace call_trace_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_trace
    ADD CONSTRAINT call_trace_pkey PRIMARY KEY (id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: calls calls_wa_call_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_wa_call_id_key UNIQUE (wa_call_id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: chat_starts chat_starts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_starts
    ADD CONSTRAINT chat_starts_pkey PRIMARY KEY (id);


--
-- Name: child_test_blocks child_test_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_blocks
    ADD CONSTRAINT child_test_blocks_pkey PRIMARY KEY (id);


--
-- Name: child_test_draws child_test_draws_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_pkey PRIMARY KEY (id);


--
-- Name: child_test_sessions child_test_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_pkey PRIMARY KEY (id);


--
-- Name: class_enrollments class_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_enrollments
    ADD CONSTRAINT class_enrollments_pkey PRIMARY KEY (id);


--
-- Name: class_teacher_subjects class_teacher_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teacher_subjects
    ADD CONSTRAINT class_teacher_subjects_pkey PRIMARY KEY (class_teacher_id, subject_code);


--
-- Name: class_teachers class_teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teachers
    ADD CONSTRAINT class_teachers_pkey PRIMARY KEY (id);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: coach_directory coach_directory_leader_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_directory
    ADD CONSTRAINT coach_directory_leader_user_id_key UNIQUE (leader_user_id);


--
-- Name: coach_directory coach_directory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_directory
    ADD CONSTRAINT coach_directory_pkey PRIMARY KEY (id);


--
-- Name: coaching_jobs coaching_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_jobs
    ADD CONSTRAINT coaching_jobs_pkey PRIMARY KEY (id);


--
-- Name: coaching_processing_queue coaching_processing_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_processing_queue
    ADD CONSTRAINT coaching_processing_queue_pkey PRIMARY KEY (id);


--
-- Name: coaching_quality_metrics coaching_quality_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_quality_metrics
    ADD CONSTRAINT coaching_quality_metrics_pkey PRIMARY KEY (id);


--
-- Name: coaching_sessions coaching_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: cta_clicks cta_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cta_clicks
    ADD CONSTRAINT cta_clicks_pkey PRIMARY KEY (id);


--
-- Name: curriculum_lp_ast curriculum_lp_ast_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_lp_ast
    ADD CONSTRAINT curriculum_lp_ast_pkey PRIMARY KEY (id);


--
-- Name: curriculum_lp_ast curriculum_lp_ast_source_chapter_id_source_lp_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.curriculum_lp_ast
    ADD CONSTRAINT curriculum_lp_ast_source_chapter_id_source_lp_uuid_key UNIQUE (source_chapter_id, source_lp_uuid);


--
-- Name: dashboard_audit_log dashboard_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_audit_log
    ADD CONSTRAINT dashboard_audit_log_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_email_key UNIQUE (email);


--
-- Name: dashboard_users dashboard_users_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_invite_token_key UNIQUE (invite_token);


--
-- Name: dashboard_users dashboard_users_password_reset_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_password_reset_token_key UNIQUE (password_reset_token);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (id);


--
-- Name: dashboard_users dashboard_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_username_key UNIQUE (username);


--
-- Name: evaluation_cycles evaluation_cycles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_cycles
    ADD CONSTRAINT evaluation_cycles_name_unique UNIQUE (name);


--
-- Name: evaluation_cycles evaluation_cycles_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_cycles
    ADD CONSTRAINT evaluation_cycles_no_overlap EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)'::text) WITH &&);


--
-- Name: evaluation_cycles evaluation_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_cycles
    ADD CONSTRAINT evaluation_cycles_pkey PRIMARY KEY (id);


--
-- Name: exam_check_sessions exam_check_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_check_sessions
    ADD CONSTRAINT exam_check_sessions_pkey PRIMARY KEY (id);


--
-- Name: exam_grades exam_grades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_grades
    ADD CONSTRAINT exam_grades_pkey PRIMARY KEY (id);


--
-- Name: exam_question_bank exam_question_bank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_question_bank
    ADD CONSTRAINT exam_question_bank_pkey PRIMARY KEY (id);


--
-- Name: exam_question_bank exam_question_bank_taleemabad_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_question_bank
    ADD CONSTRAINT exam_question_bank_taleemabad_uuid_key UNIQUE (taleemabad_uuid);


--
-- Name: exam_question_groups exam_question_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_question_groups
    ADD CONSTRAINT exam_question_groups_pkey PRIMARY KEY (id);


--
-- Name: exam_question_groups exam_question_groups_taleemabad_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_question_groups
    ADD CONSTRAINT exam_question_groups_taleemabad_uuid_key UNIQUE (taleemabad_uuid);


--
-- Name: exam_questions exam_questions_exam_id_order_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_exam_id_order_index_key UNIQUE (exam_id, order_index);


--
-- Name: exam_questions exam_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_pkey PRIMARY KEY (id);


--
-- Name: exam_submissions exam_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_pkey PRIMARY KEY (id);


--
-- Name: exam_templates exam_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_templates
    ADD CONSTRAINT exam_templates_pkey PRIMARY KEY (id);


--
-- Name: exams exams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_pkey PRIMARY KEY (id);


--
-- Name: failed_operations failed_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_operations
    ADD CONSTRAINT failed_operations_pkey PRIMARY KEY (id);


--
-- Name: feature_permissions feature_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_permissions
    ADD CONSTRAINT feature_permissions_pkey PRIMARY KEY (id);


--
-- Name: feature_suggestions feature_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_suggestions
    ADD CONSTRAINT feature_suggestions_pkey PRIMARY KEY (id);


--
-- Name: grade_audit_log grade_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_audit_log
    ADD CONSTRAINT grade_audit_log_pkey PRIMARY KEY (id);


--
-- Name: grade_levels grade_levels_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_levels
    ADD CONSTRAINT grade_levels_ordinal_key UNIQUE (ordinal);


--
-- Name: grade_levels grade_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_levels
    ADD CONSTRAINT grade_levels_pkey PRIMARY KEY (code);


--
-- Name: hcp_coaching_actions hcp_coaching_actions_indicator_code_priority_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_coaching_actions
    ADD CONSTRAINT hcp_coaching_actions_indicator_code_priority_order_key UNIQUE (indicator_code, priority_order);


--
-- Name: hcp_coaching_actions hcp_coaching_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_coaching_actions
    ADD CONSTRAINT hcp_coaching_actions_pkey PRIMARY KEY (id);


--
-- Name: hcp_feedback_deliveries hcp_feedback_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_feedback_deliveries
    ADD CONSTRAINT hcp_feedback_deliveries_pkey PRIMARY KEY (id);


--
-- Name: hcp_visit_schedules hcp_visit_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_visit_schedules
    ADD CONSTRAINT hcp_visit_schedules_pkey PRIMARY KEY (id);


--
-- Name: homework_chapters homework_chapters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.homework_chapters
    ADD CONSTRAINT homework_chapters_pkey PRIMARY KEY (id);


--
-- Name: image_analysis_requests image_analysis_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_analysis_requests
    ADD CONSTRAINT image_analysis_requests_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_key UNIQUE (token);


--
-- Name: lcpm_benchmarks lcpm_benchmarks_grade_level_language_season_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lcpm_benchmarks
    ADD CONSTRAINT lcpm_benchmarks_grade_level_language_season_key UNIQUE (grade_level, season, language);


--
-- Name: lcpm_benchmarks lcpm_benchmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lcpm_benchmarks
    ADD CONSTRAINT lcpm_benchmarks_pkey PRIMARY KEY (id);


--
-- Name: leader_roster_audit leader_roster_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_roster_audit
    ADD CONSTRAINT leader_roster_audit_pkey PRIMARY KEY (id);


--
-- Name: leader_schools leader_schools_leader_user_id_source_school_ext_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_schools
    ADD CONSTRAINT leader_schools_leader_user_id_source_school_ext_id_key UNIQUE (leader_user_id, source, school_ext_id);


--
-- Name: leader_schools leader_schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_schools
    ADD CONSTRAINT leader_schools_pkey PRIMARY KEY (id);


--
-- Name: leader_teachers leader_teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_teachers
    ADD CONSTRAINT leader_teachers_pkey PRIMARY KEY (id);


--
-- Name: lesson_plan_catalog lesson_plan_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plan_catalog
    ADD CONSTRAINT lesson_plan_catalog_pkey PRIMARY KEY (id);


--
-- Name: lesson_plan_catalog lesson_plan_catalog_source_source_row_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plan_catalog
    ADD CONSTRAINT lesson_plan_catalog_source_source_row_id_key UNIQUE (source, source_row_id);


--
-- Name: lesson_plan_requests lesson_plan_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plan_requests
    ADD CONSTRAINT lesson_plan_requests_pkey PRIMARY KEY (id);


--
-- Name: lesson_plans lesson_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plans
    ADD CONSTRAINT lesson_plans_pkey PRIMARY KEY (id);


--
-- Name: lp_feedback lp_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lp_feedback
    ADD CONSTRAINT lp_feedback_pkey PRIMARY KEY (id);


--
-- Name: migration_test migration_test_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_test
    ADD CONSTRAINT migration_test_pkey PRIMARY KEY (id);


--
-- Name: niete_lp612_deliveries niete_lp612_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_deliveries
    ADD CONSTRAINT niete_lp612_deliveries_pkey PRIMARY KEY (id);


--
-- Name: niete_lp612_renders niete_lp612_renders_cache_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_renders
    ADD CONSTRAINT niete_lp612_renders_cache_key UNIQUE (segment_id, lang, template_version);


--
-- Name: niete_lp612_renders niete_lp612_renders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_renders
    ADD CONSTRAINT niete_lp612_renders_pkey PRIMARY KEY (id);


--
-- Name: niete_lp612_segments niete_lp612_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_segments
    ADD CONSTRAINT niete_lp612_segments_pkey PRIMARY KEY (segment_id);


--
-- Name: niete_lp_ab_assignment niete_lp_ab_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_ab_assignment
    ADD CONSTRAINT niete_lp_ab_assignment_pkey PRIMARY KEY (school_id);


--
-- Name: niete_lp_asset_sources niete_lp_asset_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_asset_sources
    ADD CONSTRAINT niete_lp_asset_sources_pkey PRIMARY KEY (asset_id);


--
-- Name: niete_lp_asset_sources niete_lp_asset_sources_version_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_asset_sources
    ADD CONSTRAINT niete_lp_asset_sources_version_uniq UNIQUE (lesson_id, version_stamp, content_hash);


--
-- Name: niete_lp_assets niete_lp_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_assets
    ADD CONSTRAINT niete_lp_assets_pkey PRIMARY KEY (id);


--
-- Name: niete_lp_downloads niete_lp_downloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_downloads
    ADD CONSTRAINT niete_lp_downloads_pkey PRIMARY KEY (id);


--
-- Name: niete_lp_fidelity_moves niete_lp_fidelity_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_fidelity_moves
    ADD CONSTRAINT niete_lp_fidelity_moves_pkey PRIMARY KEY (id);


--
-- Name: niete_lp_opens niete_lp_opens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_opens
    ADD CONSTRAINT niete_lp_opens_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observation_answers nietemigrated_observation_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_answers
    ADD CONSTRAINT nietemigrated_observation_answers_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observation_question_groups nietemigrated_observation_question_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_question_groups
    ADD CONSTRAINT nietemigrated_observation_question_groups_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observation_questions nietemigrated_observation_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_questions
    ADD CONSTRAINT nietemigrated_observation_questions_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observation_sections nietemigrated_observation_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_sections
    ADD CONSTRAINT nietemigrated_observation_sections_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observation_templates nietemigrated_observation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_templates
    ADD CONSTRAINT nietemigrated_observation_templates_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_observations nietemigrated_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observations
    ADD CONSTRAINT nietemigrated_observations_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_question_options nietemigrated_question_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_question_options
    ADD CONSTRAINT nietemigrated_question_options_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_school_visits nietemigrated_school_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_school_visits
    ADD CONSTRAINT nietemigrated_school_visits_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_teacher_visits nietemigrated_teacher_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_teacher_visits
    ADD CONSTRAINT nietemigrated_teacher_visits_pkey PRIMARY KEY (id);


--
-- Name: nietemigrated_visit_plans nietemigrated_visit_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_visit_plans
    ADD CONSTRAINT nietemigrated_visit_plans_pkey PRIMARY KEY (id);


--
-- Name: observation_field_forms observation_field_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_field_forms
    ADD CONSTRAINT observation_field_forms_pkey PRIMARY KEY (id);


--
-- Name: observation_schedules observation_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_schedules
    ADD CONSTRAINT observation_schedules_pkey PRIMARY KEY (id);


--
-- Name: pic_lp_sessions pic_lp_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pic_lp_sessions
    ADD CONSTRAINT pic_lp_sessions_pkey PRIMARY KEY (id);


--
-- Name: portal_organizations portal_organizations_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_organizations
    ADD CONSTRAINT portal_organizations_name_key UNIQUE (name);


--
-- Name: portal_organizations portal_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_organizations
    ADD CONSTRAINT portal_organizations_pkey PRIMARY KEY (id);


--
-- Name: pre_generated_lps pre_generated_lps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_generated_lps
    ADD CONSTRAINT pre_generated_lps_pkey PRIMARY KEY (id);


--
-- Name: qa_analyst_proposals qa_analyst_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_analyst_proposals
    ADD CONSTRAINT qa_analyst_proposals_pkey PRIMARY KEY (id);


--
-- Name: qa_bug_patterns qa_bug_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_bug_patterns
    ADD CONSTRAINT qa_bug_patterns_pkey PRIMARY KEY (id);


--
-- Name: qa_test_runs qa_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_test_runs
    ADD CONSTRAINT qa_test_runs_pkey PRIMARY KEY (id);


--
-- Name: quiz_answers quiz_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_pkey PRIMARY KEY (id);


--
-- Name: quiz_answers quiz_answers_session_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_session_id_question_id_key UNIQUE (session_id, question_id);


--
-- Name: quiz_questions quiz_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_questions
    ADD CONSTRAINT quiz_questions_pkey PRIMARY KEY (id);


--
-- Name: quiz_sessions quiz_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_pkey PRIMARY KEY (id);


--
-- Name: quiz_share_codes quiz_share_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_code_key UNIQUE (code);


--
-- Name: quiz_share_codes quiz_share_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_pkey PRIMARY KEY (id);


--
-- Name: quizzes quizzes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_pkey PRIMARY KEY (id);


--
-- Name: reading_assessments reading_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_assessments
    ADD CONSTRAINT reading_assessments_pkey PRIMARY KEY (id);


--
-- Name: record_history record_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_history
    ADD CONSTRAINT record_history_pkey PRIMARY KEY (id);


--
-- Name: region_features region_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region_features
    ADD CONSTRAINT region_features_pkey PRIMARY KEY (region);


--
-- Name: release_notes release_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notes
    ADD CONSTRAINT release_notes_pkey PRIMARY KEY (id);


--
-- Name: schema_versions schema_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_versions
    ADD CONSTRAINT schema_versions_pkey PRIMARY KEY (version);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (code);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (code);


--
-- Name: student_lists student_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_pkey PRIMARY KEY (id);


--
-- Name: student_video_feedback student_video_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_video_feedback
    ADD CONSTRAINT student_video_feedback_pkey PRIMARY KEY (id);


--
-- Name: student_videos student_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_videos
    ADD CONSTRAINT student_videos_pkey PRIMARY KEY (id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: subjects subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_pkey PRIMARY KEY (code);


--
-- Name: supervisor_remark_scores supervisor_remark_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remark_scores
    ADD CONSTRAINT supervisor_remark_scores_pkey PRIMARY KEY (id);


--
-- Name: supervisor_remark_scores supervisor_remark_scores_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remark_scores
    ADD CONSTRAINT supervisor_remark_scores_unique UNIQUE (remark_id, indicator_ordinal);


--
-- Name: supervisor_remarks supervisor_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_pkey PRIMARY KEY (id);


--
-- Name: supervisor_remarks supervisor_remarks_teacher_cycle_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_teacher_cycle_unique UNIQUE (teacher_id, cycle_id);


--
-- Name: teacher_attendance_records teacher_attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_attendance_records
    ADD CONSTRAINT teacher_attendance_records_pkey PRIMARY KEY (id);


--
-- Name: teacher_attendance_records teacher_attendance_records_teacher_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_attendance_records
    ADD CONSTRAINT teacher_attendance_records_teacher_id_date_key UNIQUE (teacher_id, date);


--
-- Name: teacher_facts teacher_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_facts
    ADD CONSTRAINT teacher_facts_pkey PRIMARY KEY (id);


--
-- Name: teacher_facts teacher_facts_user_id_fact_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_facts
    ADD CONSTRAINT teacher_facts_user_id_fact_key UNIQUE (user_id, fact);


--
-- Name: teacher_nudges teacher_nudges_one_per_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_nudges
    ADD CONSTRAINT teacher_nudges_one_per_day UNIQUE (user_id, nudge_date, kind);


--
-- Name: teacher_nudges teacher_nudges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_nudges
    ADD CONSTRAINT teacher_nudges_pkey PRIMARY KEY (id);


--
-- Name: teacher_progress teacher_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_progress
    ADD CONSTRAINT teacher_progress_pkey PRIMARY KEY (id);


--
-- Name: teacher_training_assignments teacher_training_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_assignments
    ADD CONSTRAINT teacher_training_assignments_pkey PRIMARY KEY (id);


--
-- Name: teacher_training_progress teacher_training_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_progress
    ADD CONSTRAINT teacher_training_progress_pkey PRIMARY KEY (id);


--
-- Name: teacher_training_progress teacher_training_progress_user_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_progress
    ADD CONSTRAINT teacher_training_progress_user_id_module_id_key UNIQUE (user_id, module_id);


--
-- Name: textbook_pages textbook_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbook_pages
    ADD CONSTRAINT textbook_pages_pkey PRIMARY KEY (id);


--
-- Name: textbook_pages textbook_pages_textbook_id_pdf_page_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbook_pages
    ADD CONSTRAINT textbook_pages_textbook_id_pdf_page_index_key UNIQUE (textbook_id, pdf_page_index);


--
-- Name: textbook_toc textbook_toc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbook_toc
    ADD CONSTRAINT textbook_toc_pkey PRIMARY KEY (id);


--
-- Name: textbooks textbooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbooks
    ADD CONSTRAINT textbooks_pkey PRIMARY KEY (id);


--
-- Name: textbooks textbooks_province_grade_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbooks
    ADD CONSTRAINT textbooks_province_grade_subject_key UNIQUE (province, grade, subject);


--
-- Name: training_assessment_answers training_assessment_answers_attempt_id_question_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_answers
    ADD CONSTRAINT training_assessment_answers_attempt_id_question_index_key UNIQUE (attempt_id, question_index);


--
-- Name: training_assessment_answers training_assessment_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_answers
    ADD CONSTRAINT training_assessment_answers_pkey PRIMARY KEY (id);


--
-- Name: training_assessment_attempts training_assessment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_pkey PRIMARY KEY (id);


--
-- Name: training_certificates training_certificates_certificate_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_certificate_code_key UNIQUE (certificate_code);


--
-- Name: training_certificates training_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_pkey PRIMARY KEY (id);


--
-- Name: training_certificates training_certificates_user_level_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_user_level_uniq UNIQUE (user_id, level_id) DEFERRABLE;


--
-- Name: training_content_change_events training_content_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_content_change_events
    ADD CONSTRAINT training_content_change_events_pkey PRIMARY KEY (id);


--
-- Name: training_courses training_courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_pkey PRIMARY KEY (id);


--
-- Name: training_grand_quizzes training_grand_quizzes_level_type_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_grand_quizzes
    ADD CONSTRAINT training_grand_quizzes_level_type_source_key UNIQUE NULLS NOT DISTINCT (level_id, quiz_type, source_quiz_id);


--
-- Name: training_grand_quizzes training_grand_quizzes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_grand_quizzes
    ADD CONSTRAINT training_grand_quizzes_pkey PRIMARY KEY (id);


--
-- Name: training_levels training_levels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_levels
    ADD CONSTRAINT training_levels_pkey PRIMARY KEY (id);


--
-- Name: training_levels training_levels_vendor_id_order_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_levels
    ADD CONSTRAINT training_levels_vendor_id_order_index_key UNIQUE (vendor_id, order_index);


--
-- Name: training_modules training_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_modules
    ADD CONSTRAINT training_modules_pkey PRIMARY KEY (id);


--
-- Name: training_program_scopes training_program_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_program_scopes
    ADD CONSTRAINT training_program_scopes_pkey PRIMARY KEY (id);


--
-- Name: training_programs training_programs_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_programs
    ADD CONSTRAINT training_programs_key_key UNIQUE (key);


--
-- Name: training_programs training_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_programs
    ADD CONSTRAINT training_programs_pkey PRIMARY KEY (id);


--
-- Name: training_questions training_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_questions
    ADD CONSTRAINT training_questions_pkey PRIMARY KEY (id);


--
-- Name: training_vendors training_vendors_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_vendors
    ADD CONSTRAINT training_vendors_key_key UNIQUE (key);


--
-- Name: training_vendors training_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_vendors
    ADD CONSTRAINT training_vendors_pkey PRIMARY KEY (id);


--
-- Name: feature_permissions unique_role_feature; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_permissions
    ADD CONSTRAINT unique_role_feature UNIQUE (feature_key, role);


--
-- Name: access_scopes unique_user_scope; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_scopes
    ADD CONSTRAINT unique_user_scope UNIQUE (dashboard_user_id);


--
-- Name: user_feature_first_use user_feature_first_use_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_first_use
    ADD CONSTRAINT user_feature_first_use_pkey PRIMARY KEY (id);


--
-- Name: user_feature_first_use user_feature_first_use_user_id_feature_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_first_use
    ADD CONSTRAINT user_feature_first_use_user_id_feature_key UNIQUE (user_id, feature);


--
-- Name: users users_phone_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);


--
-- Name: users users_portal_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_portal_invite_token_key UNIQUE (portal_invite_token);


--
-- Name: video_quiz_deliveries video_quiz_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_quiz_deliveries
    ADD CONSTRAINT video_quiz_deliveries_pkey PRIMARY KEY (id);


--
-- Name: video_requests video_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_requests
    ADD CONSTRAINT video_requests_pkey PRIMARY KEY (id);


--
-- Name: video_tasks video_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_tasks
    ADD CONSTRAINT video_tasks_pkey PRIMARY KEY (id);


--
-- Name: video_tasks video_tasks_video_request_id_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_tasks
    ADD CONSTRAINT video_tasks_video_request_id_filename_key UNIQUE (video_request_id, filename);


--
-- Name: videos videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_pkey PRIMARY KEY (id);


--
-- Name: wcpm_percentiles wcpm_percentiles_grade_level_language_season_percentile_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wcpm_percentiles
    ADD CONSTRAINT wcpm_percentiles_grade_level_language_season_percentile_key UNIQUE (season, language, grade_level, percentile);


--
-- Name: wcpm_percentiles wcpm_percentiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wcpm_percentiles
    ADD CONSTRAINT wcpm_percentiles_pkey PRIMARY KEY (id);


--
-- Name: web_quiz_challenge_runs web_quiz_challenge_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_quiz_challenge_runs
    ADD CONSTRAINT web_quiz_challenge_runs_pkey PRIMARY KEY (id);


--
-- Name: website_visits website_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_visits
    ADD CONSTRAINT website_visits_pkey PRIMARY KEY (id);


--
-- Name: website_visits website_visits_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.website_visits
    ADD CONSTRAINT website_visits_session_id_key UNIQUE (session_id);


--
-- Name: idx_ab_test_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_test_events_date ON public.ab_test_events USING btree (created_at);


--
-- Name: idx_ab_test_events_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_test_events_test ON public.ab_test_events USING btree (test_id);


--
-- Name: idx_ab_test_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_test_events_user ON public.ab_test_events USING btree (user_id);


--
-- Name: idx_ab_test_variants_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_test_variants_test ON public.ab_test_variants USING btree (test_id);


--
-- Name: idx_ab_tests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ab_tests_status ON public.ab_tests USING btree (status);


--
-- Name: idx_academic_sessions_span; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_academic_sessions_span ON public.academic_sessions USING btree (starts_on, ends_on) WHERE is_active;


--
-- Name: idx_access_scopes_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_scopes_type ON public.access_scopes USING btree (scope_type);


--
-- Name: idx_access_scopes_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_scopes_user ON public.access_scopes USING btree (dashboard_user_id);


--
-- Name: idx_access_scopes_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_scopes_value ON public.access_scopes USING gin (scope_value);


--
-- Name: idx_ama_conversations_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_conversations_updated_at ON public.ama_conversations USING btree (updated_at DESC);


--
-- Name: idx_ama_conversations_user_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_conversations_user_archived ON public.ama_conversations USING btree (user_id, is_archived);


--
-- Name: idx_ama_conversations_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_conversations_user_id ON public.ama_conversations USING btree (user_id);


--
-- Name: idx_ama_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_messages_conversation_id ON public.ama_messages USING btree (conversation_id);


--
-- Name: idx_ama_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_messages_created_at ON public.ama_messages USING btree (created_at);


--
-- Name: idx_ama_query_audit_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_query_audit_created_at ON public.ama_query_audit USING btree (created_at DESC);


--
-- Name: idx_ama_query_audit_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_query_audit_status ON public.ama_query_audit USING btree (execution_status);


--
-- Name: idx_ama_query_audit_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ama_query_audit_user_id ON public.ama_query_audit USING btree (user_id);


--
-- Name: idx_api_usage_service_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_usage_service_date ON public.api_usage_log USING btree (service, created_at DESC);


--
-- Name: idx_assessment_papers_edited_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_papers_edited_from ON public.assessment_papers USING btree (edited_from) WHERE (edited_from IS NOT NULL);


--
-- Name: idx_assessment_papers_inflight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_papers_inflight ON public.assessment_papers USING btree (created_at) WHERE (status = ANY (ARRAY['queued'::text, 'generating'::text]));


--
-- Name: idx_assessment_papers_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_papers_request ON public.assessment_papers USING btree (request_id, attempt DESC);


--
-- Name: idx_assessment_requests_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_requests_user_time ON public.assessment_requests USING btree (user_id, created_at DESC);


--
-- Name: idx_assessment_requests_notice_waiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assessment_requests_notice_waiting ON public.assessment_requests USING btree (created_at) WHERE ((surface = 'portal'::text) AND (notice_seen_at IS NULL) AND (notice_opened_at IS NULL) AND (notice_whatsapp_at IS NULL));


--
-- Name: idx_attendance_one_mark; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attendance_one_mark ON public.attendance_records USING btree (session_id, student_id);


--
-- Name: idx_attendance_records_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_records_session ON public.attendance_records USING btree (session_id);


--
-- Name: idx_attendance_records_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_records_student ON public.attendance_records USING btree (student_id);


--
-- Name: idx_attendance_sessions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_date ON public.attendance_sessions USING btree (session_date DESC);


--
-- Name: idx_attendance_sessions_list_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_list_date ON public.attendance_sessions USING btree (list_id, session_date DESC);


--
-- Name: idx_attendance_sessions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_attendance_sessions_unique ON public.attendance_sessions USING btree (list_id, session_date, session_type);


--
-- Name: idx_attendance_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_user ON public.attendance_sessions USING btree (user_id);


--
-- Name: idx_attendance_sessions_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_sessions_user_date ON public.attendance_sessions USING btree (user_id, session_date DESC);


--
-- Name: idx_audio_sessions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audio_sessions_user_created ON public.audio_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_audit_log_affected_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_affected_user ON public.dashboard_audit_log USING btree (affected_user_id);


--
-- Name: idx_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created_at ON public.dashboard_audit_log USING btree (created_at);


--
-- Name: idx_audit_log_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_org ON public.dashboard_audit_log USING btree (organization_id);


--
-- Name: idx_audit_log_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_resource ON public.dashboard_audit_log USING btree (resource_type, resource_id);


--
-- Name: idx_audit_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user_id ON public.dashboard_audit_log USING btree (user_id);


--
-- Name: idx_broadcast_logs_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_logs_admin ON public.broadcast_logs USING btree (admin_user_id, created_at DESC);


--
-- Name: idx_broadcast_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_logs_created ON public.broadcast_logs USING btree (created_at DESC);


--
-- Name: idx_broadcast_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_logs_status ON public.broadcast_logs USING btree (status);


--
-- Name: idx_broadcast_messages_broadcast_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_messages_broadcast_id ON public.broadcast_messages USING btree (broadcast_id);


--
-- Name: idx_broadcast_messages_broadcast_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_broadcast_messages_broadcast_user ON public.broadcast_messages USING btree (broadcast_id, user_id);


--
-- Name: idx_broadcast_messages_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_messages_message_id ON public.broadcast_messages USING btree (message_id);


--
-- Name: idx_broadcast_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_messages_status ON public.broadcast_messages USING btree (status);


--
-- Name: idx_broadcast_messages_user_sent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_broadcast_messages_user_sent ON public.broadcast_messages USING btree (user_id, sent_at DESC);


--
-- Name: idx_broadcast_messages_wamid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_broadcast_messages_wamid ON public.broadcast_messages USING btree (message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_byof_approval_log_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_approval_log_plan ON public.byof_approval_log USING btree (plan_id);


--
-- Name: idx_byof_messages_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_messages_created ON public.byof_messages USING btree (created_at);


--
-- Name: idx_byof_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_messages_session ON public.byof_messages USING btree (session_id);


--
-- Name: idx_byof_plans_pr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_plans_pr ON public.byof_plans USING btree (pr_url) WHERE (pr_url IS NOT NULL);


--
-- Name: idx_byof_plans_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_plans_session ON public.byof_plans USING btree (session_id);


--
-- Name: idx_byof_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_plans_status ON public.byof_plans USING btree (status);


--
-- Name: idx_byof_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_sessions_status ON public.byof_sessions USING btree (status);


--
-- Name: idx_byof_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_byof_sessions_user ON public.byof_sessions USING btree (user_id);


--
-- Name: idx_call_trace_call; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_trace_call ON public.call_trace USING btree (wa_call_id, seq);


--
-- Name: idx_calls_number_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_number_started ON public.calls USING btree (caller_number, started_at DESC);


--
-- Name: idx_calls_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_started ON public.calls USING btree (started_at DESC);


--
-- Name: idx_chat_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_user_active ON public.chat_sessions USING btree (user_id, last_activity_at DESC) WHERE (ended_at IS NULL);


--
-- Name: idx_chat_sessions_user_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_user_started ON public.chat_sessions USING btree (user_id, started_at DESC);


--
-- Name: idx_chat_starts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_starts_created_at ON public.chat_starts USING btree (created_at DESC);


--
-- Name: idx_chat_starts_phone_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_starts_phone_number ON public.chat_starts USING btree (phone_number);


--
-- Name: idx_chat_starts_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_starts_session_id ON public.chat_starts USING btree (session_id);


--
-- Name: idx_chat_starts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_starts_user_id ON public.chat_starts USING btree (user_id);


--
-- Name: idx_child_test_draws_school_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_draws_school_cycle ON public.child_test_draws USING btree (school_id, cycle_id);


--
-- Name: idx_child_test_draws_tested; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_draws_tested ON public.child_test_draws USING btree (school_id, grade, tested_at) WHERE (status = 'tested'::text);


--
-- Name: idx_child_test_draws_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_draws_visit ON public.child_test_draws USING btree (last_listed_visit_id) WHERE (last_listed_visit_id IS NOT NULL);


--
-- Name: idx_child_test_draws_visit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_draws_visit_key ON public.child_test_draws USING btree (visit_key) WHERE (visit_key IS NOT NULL);


--
-- Name: idx_child_test_sessions_coach_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_sessions_coach_recent ON public.child_test_sessions USING btree (coach_user_id, started_at DESC);


--
-- Name: idx_child_test_sessions_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_sessions_visit ON public.child_test_sessions USING btree (visit_id) WHERE (visit_id IS NOT NULL);


--
-- Name: idx_child_test_sessions_visit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_child_test_sessions_visit_key ON public.child_test_sessions USING btree (visit_key) WHERE (visit_key IS NOT NULL);


--
-- Name: idx_class_enrollments_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_enrollments_class ON public.class_enrollments USING btree (class_id) WHERE is_active;


--
-- Name: idx_class_enrollments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_enrollments_student ON public.class_enrollments USING btree (student_id);


--
-- Name: idx_class_enrollments_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_class_enrollments_unique ON public.class_enrollments USING btree (class_id, student_id) WHERE is_active;


--
-- Name: idx_class_teacher_subjects_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_teacher_subjects_subject ON public.class_teacher_subjects USING btree (subject_code);


--
-- Name: idx_class_teachers_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_teachers_teacher ON public.class_teachers USING btree (teacher_user_id) WHERE is_active;


--
-- Name: idx_class_teachers_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_class_teachers_unique ON public.class_teachers USING btree (class_id, teacher_user_id) WHERE is_active;


--
-- Name: idx_classes_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_classes_identity ON public.classes USING btree (school_id, grade_code, COALESCE(section, ''::text), shift_code, session_code) WHERE is_active;


--
-- Name: idx_classes_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_school ON public.classes USING btree (school_id) WHERE is_active;


--
-- Name: idx_classes_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_session ON public.classes USING btree (session_code) WHERE is_active;


--
-- Name: idx_classes_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_shift ON public.classes USING btree (shift_code) WHERE is_active;


--
-- Name: idx_coach_directory_leader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_directory_leader ON public.coach_directory USING btree (leader_user_id);


--
-- Name: idx_coaching_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_jobs_created ON public.coaching_jobs USING btree (created_at DESC);


--
-- Name: idx_coaching_jobs_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_jobs_scheduled ON public.coaching_jobs USING btree (scheduled_for) WHERE (status = 'pending'::text);


--
-- Name: idx_coaching_jobs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_jobs_session ON public.coaching_jobs USING btree (coaching_session_id);


--
-- Name: idx_coaching_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_jobs_status ON public.coaching_jobs USING btree (status);


--
-- Name: idx_coaching_sessions_audio_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_audio_id ON public.coaching_sessions USING btree (audio_id);


--
-- Name: idx_coaching_sessions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_created_at ON public.coaching_sessions USING btree (created_at DESC);


--
-- Name: idx_coaching_sessions_framework; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_framework ON public.coaching_sessions USING btree (framework) WHERE (framework IS NOT NULL);


--
-- Name: idx_coaching_sessions_framework_selection_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_framework_selection_reason ON public.coaching_sessions USING btree (framework_selection_reason) WHERE (framework_selection_reason IS NOT NULL);


--
-- Name: idx_coaching_sessions_gamma_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_gamma_url ON public.coaching_sessions USING btree (report_gamma_url) WHERE (report_gamma_url IS NOT NULL);


--
-- Name: idx_coaching_sessions_lesson_plan_structured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_lesson_plan_structured ON public.coaching_sessions USING gin (lesson_plan_structured);


--
-- Name: idx_coaching_sessions_observer_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_observer_pending ON public.coaching_sessions USING btree (observer_user_id, created_at DESC) WHERE ((observation_type)::text = 'leader_observation'::text);


--
-- Name: idx_coaching_sessions_stale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_stale ON public.coaching_sessions USING btree (status, created_at) WHERE ((status)::text = 'conducting_conversation'::text);


--
-- Name: idx_coaching_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_status ON public.coaching_sessions USING btree (status);


--
-- Name: idx_coaching_sessions_user_audio_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_user_audio_hash ON public.coaching_sessions USING btree (user_id, audio_hash, created_at DESC) WHERE ((audio_hash IS NOT NULL) AND ((status)::text = 'completed'::text));


--
-- Name: idx_coaching_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_user_id ON public.coaching_sessions USING btree (user_id);


--
-- Name: idx_coaching_sessions_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_sessions_user_status ON public.coaching_sessions USING btree (user_id, status, created_at DESC);


--
-- Name: idx_coaching_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_user_created ON public.coaching_sessions USING btree (user_id, created_at, status);


--
-- Name: idx_conversations_current_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_current_state ON public.conversations USING btree (current_state) WHERE (current_state IS NOT NULL);


--
-- Name: idx_conversations_format_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_format_language ON public.conversations USING btree (input_format, input_language, output_format, output_language);


--
-- Name: idx_conversations_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_session ON public.conversations USING btree (session_id, created_at);


--
-- Name: idx_conversations_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user_created ON public.conversations USING btree (user_id, created_at DESC);


--
-- Name: idx_conversations_user_role_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user_role_created ON public.conversations USING btree (user_id, role, created_at DESC);


--
-- Name: idx_cta_clicks_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cta_clicks_created_at ON public.cta_clicks USING btree (created_at DESC);


--
-- Name: idx_cta_clicks_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cta_clicks_session_id ON public.cta_clicks USING btree (session_id);


--
-- Name: idx_curriculum_lp_ast_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_lp_ast_lookup ON public.curriculum_lp_ast USING btree (curriculum_key, grade, subject, chapter_number) WHERE (is_enabled = true);


--
-- Name: idx_curriculum_lp_ast_publisher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_lp_ast_publisher ON public.curriculum_lp_ast USING btree (publisher, is_enabled);


--
-- Name: idx_curriculum_lp_ast_source_lp_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_lp_ast_source_lp_uuid ON public.curriculum_lp_ast USING btree (source_lp_uuid);


--
-- Name: idx_curriculum_lp_ast_topic_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_curriculum_lp_ast_topic_fts ON public.curriculum_lp_ast USING gin (to_tsvector('english'::regconfig, topic));


--
-- Name: idx_dashboard_users_byof_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_byof_role ON public.dashboard_users USING btree (byof_role) WHERE (byof_role IS NOT NULL);


--
-- Name: idx_dashboard_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_email ON public.dashboard_users USING btree (email);


--
-- Name: idx_dashboard_users_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_invite_token ON public.dashboard_users USING btree (invite_token);


--
-- Name: idx_dashboard_users_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_org ON public.dashboard_users USING btree (organization_id);


--
-- Name: idx_dashboard_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_role ON public.dashboard_users USING btree (role);


--
-- Name: idx_dashboard_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_users_username ON public.dashboard_users USING btree (username);


--
-- Name: idx_enrollments_class_roll; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_enrollments_class_roll ON public.class_enrollments USING btree (class_id, roll_number) WHERE (is_active AND (roll_number IS NOT NULL));


--
-- Name: idx_evaluation_cycles_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluation_cycles_window ON public.evaluation_cycles USING btree (starts_at, ends_at);


--
-- Name: idx_exam_bank_bloom_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_bank_bloom_tags ON public.exam_question_bank USING gin (bloom_tags);


--
-- Name: idx_exam_bank_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_bank_category ON public.exam_question_bank USING btree (grade, subject, language, chapter_index, category);


--
-- Name: idx_exam_bank_grade_subject_lang_chapter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_bank_grade_subject_lang_chapter ON public.exam_question_bank USING btree (grade, subject, language, chapter_index);


--
-- Name: idx_exam_bank_group_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_bank_group_ref ON public.exam_question_bank USING btree (group_ref) WHERE (group_ref IS NOT NULL);


--
-- Name: idx_exam_grades_submission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_grades_submission ON public.exam_grades USING btree (submission_id);


--
-- Name: idx_exam_grades_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_exam_grades_unique ON public.exam_grades USING btree (submission_id, question_id);


--
-- Name: idx_exam_questions_exam; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_questions_exam ON public.exam_questions USING btree (exam_id);


--
-- Name: idx_exam_questions_source_bank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_questions_source_bank ON public.exam_questions USING btree (source_bank_id);


--
-- Name: idx_exam_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_sessions_status ON public.exam_check_sessions USING btree (status) WHERE ((status)::text <> ALL (ARRAY[('completed'::character varying)::text, ('cancelled'::character varying)::text, ('error'::character varying)::text]));


--
-- Name: idx_exam_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_sessions_user ON public.exam_check_sessions USING btree (user_id, created_at DESC);


--
-- Name: idx_exam_submissions_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_submissions_session ON public.exam_submissions USING btree (session_id);


--
-- Name: idx_exam_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_submissions_student ON public.exam_submissions USING btree (student_id) WHERE (student_id IS NOT NULL);


--
-- Name: idx_exam_templates_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exam_templates_user ON public.exam_templates USING btree (user_id, last_used_at DESC);


--
-- Name: idx_exams_status_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exams_status_time ON public.exams USING btree (status, created_at DESC) WHERE (status <> 'ready'::text);


--
-- Name: idx_exams_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exams_user_time ON public.exams USING btree (created_by_user_id, created_at DESC);


--
-- Name: idx_failed_operations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_operations_created ON public.failed_operations USING btree (created_at DESC);


--
-- Name: idx_feature_permissions_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_permissions_feature ON public.feature_permissions USING btree (feature_key);


--
-- Name: idx_feature_permissions_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_permissions_role ON public.feature_permissions USING btree (role);


--
-- Name: idx_feature_suggestions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_suggestions_date ON public.feature_suggestions USING btree (created_at);


--
-- Name: idx_feature_suggestions_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_suggestions_feature ON public.feature_suggestions USING btree (suggested_feature);


--
-- Name: idx_feature_suggestions_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_suggestions_trigger ON public.feature_suggestions USING btree (trigger_type);


--
-- Name: idx_feature_suggestions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_suggestions_user ON public.feature_suggestions USING btree (user_id);


--
-- Name: idx_grade_audit_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grade_audit_grade ON public.grade_audit_log USING btree (grade_id);


--
-- Name: idx_grade_levels_aliases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grade_levels_aliases ON public.grade_levels USING gin (aliases);


--
-- Name: idx_grade_levels_band; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grade_levels_band ON public.grade_levels USING btree (band) WHERE is_active;


--
-- Name: idx_hcp_coaching_actions_indicator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_coaching_actions_indicator ON public.hcp_coaching_actions USING btree (indicator_code);


--
-- Name: idx_hcp_feedback_deliveries_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_feedback_deliveries_session ON public.hcp_feedback_deliveries USING btree (coaching_session_id) WHERE (coaching_session_id IS NOT NULL);


--
-- Name: idx_hcp_feedback_deliveries_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_feedback_deliveries_teacher ON public.hcp_feedback_deliveries USING btree (teacher_id, generated_at DESC);


--
-- Name: idx_hcp_visit_schedules_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_visit_schedules_coach ON public.hcp_visit_schedules USING btree (coach_id);


--
-- Name: idx_hcp_visit_schedules_status_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_visit_schedules_status_time ON public.hcp_visit_schedules USING btree (status, scheduled_at);


--
-- Name: idx_hcp_visit_schedules_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hcp_visit_schedules_teacher ON public.hcp_visit_schedules USING btree (teacher_id);


--
-- Name: idx_homework_chapters_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_homework_chapters_lookup ON public.homework_chapters USING btree (grade, subject, version, chapter_number);


--
-- Name: idx_image_requests_status_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_requests_status_started ON public.image_analysis_requests USING btree (status, started_at) WHERE ((status)::text = 'processing'::text);


--
-- Name: idx_image_requests_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_requests_user ON public.image_analysis_requests USING btree (user_id, created_at DESC);


--
-- Name: idx_invitations_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_created_at ON public.invitations USING btree (created_at DESC);


--
-- Name: idx_invitations_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_email ON public.invitations USING btree (email);


--
-- Name: idx_invitations_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_expires_at ON public.invitations USING btree (expires_at);


--
-- Name: idx_invitations_invited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_invited_by ON public.invitations USING btree (invited_by);


--
-- Name: idx_invitations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_status ON public.invitations USING btree (status);


--
-- Name: idx_invitations_status_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_status_expires ON public.invitations USING btree (status, expires_at);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_token ON public.invitations USING btree (token);


--
-- Name: idx_lcpm_benchmarks_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lcpm_benchmarks_lookup ON public.lcpm_benchmarks USING btree (grade_level, language, season);


--
-- Name: idx_leader_schools_leader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_schools_leader ON public.leader_schools USING btree (leader_user_id);


--
-- Name: idx_leader_schools_school_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_schools_school_id ON public.leader_schools USING btree (school_id);


--
-- Name: idx_leader_teachers_leader_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_teachers_leader_school ON public.leader_teachers USING btree (leader_user_id, school_ext_id);


--
-- Name: idx_leader_teachers_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_teachers_live ON public.leader_teachers USING btree (leader_user_id, school_ext_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_leader_teachers_phone_e164; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_teachers_phone_e164 ON public.leader_teachers USING btree (teacher_phone_e164);


--
-- Name: idx_leader_teachers_school_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leader_teachers_school_id ON public.leader_teachers USING btree (school_id);


--
-- Name: idx_lesson_plan_catalog_grade_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_plan_catalog_grade_subject ON public.lesson_plan_catalog USING btree (grade, subject) WHERE is_active;


--
-- Name: idx_lesson_plan_catalog_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_plan_catalog_source ON public.lesson_plan_catalog USING btree (source) WHERE is_active;


--
-- Name: idx_lesson_plans_pdf_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_plans_pdf_url ON public.lesson_plans USING btree (pdf_url) WHERE (pdf_url IS NOT NULL);


--
-- Name: idx_lesson_plans_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lesson_plans_user_created ON public.lesson_plans USING btree (user_id, created_at DESC);


--
-- Name: idx_lp612_deliveries_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_deliveries_user_recent ON public.niete_lp612_deliveries USING btree (user_id, delivered_at DESC);


--
-- Name: idx_lp612_deliveries_notice_waiting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_deliveries_notice_waiting ON public.niete_lp612_deliveries USING btree (delivered_at) WHERE ((surface = 'portal'::text) AND (notice_seen_at IS NULL) AND (notice_opened_at IS NULL) AND (notice_whatsapp_at IS NULL));


--
-- Name: idx_lp612_renders_inflight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_renders_inflight ON public.niete_lp612_renders USING btree (started_at) WHERE (status = 'authoring'::text);


--
-- Name: idx_lp612_renders_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_renders_lookup ON public.niete_lp612_renders USING btree (segment_id, lang, template_version, status);


--
-- Name: idx_lp612_segments_also_grades; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_segments_also_grades ON public.niete_lp612_segments USING gin (also_grades);


--
-- Name: idx_lp612_segments_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_segments_book ON public.niete_lp612_segments USING btree (book_stem, chapter_key, order_index);


--
-- Name: idx_lp612_segments_menu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp612_segments_menu ON public.niete_lp612_segments USING btree (grade, subject, chapter_number, order_index) WHERE is_current;


--
-- Name: idx_lp_assets_current_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_assets_current_lookup ON public.niete_lp_assets USING btree (catalog_version, lesson_id) WHERE is_current;


--
-- Name: idx_lp_assets_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lp_assets_identity ON public.niete_lp_assets USING btree (lesson_id, asset_kind, content_hash);


--
-- Name: idx_lp_assets_one_current; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lp_assets_one_current ON public.niete_lp_assets USING btree (lesson_id, asset_kind) WHERE is_current;


--
-- Name: idx_lp_downloads_lesson_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_downloads_lesson_time ON public.niete_lp_downloads USING btree (lesson_id, created_at DESC);


--
-- Name: idx_lp_downloads_tick; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_downloads_tick ON public.niete_lp_downloads USING btree (user_id, lesson_id) WHERE (status = 'sent'::text);


--
-- Name: idx_lp_downloads_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_downloads_user_time ON public.niete_lp_downloads USING btree (user_id, created_at DESC);


--
-- Name: idx_lp_feedback_has_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_feedback_has_reason ON public.lp_feedback USING btree (created_at DESC) WHERE (reason_text IS NOT NULL);


--
-- Name: idx_lp_feedback_lp612_segment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_feedback_lp612_segment ON public.lp_feedback USING btree (lp612_segment_id, created_at DESC) WHERE (lp612_segment_id IS NOT NULL);


--
-- Name: idx_lp_feedback_polarity_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_feedback_polarity_time ON public.lp_feedback USING btree (reason_polarity, created_at DESC) WHERE (reason_text IS NOT NULL);


--
-- Name: idx_lp_feedback_useful_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_feedback_useful_time ON public.lp_feedback USING btree (useful, created_at DESC);


--
-- Name: idx_lp_feedback_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_feedback_user_time ON public.lp_feedback USING btree (user_id, created_at DESC);


--
-- Name: idx_lp_opens_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_opens_user_recent ON public.niete_lp_opens USING btree (user_id, opened_at DESC);


--
-- Name: idx_lp_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_requests_status ON public.lesson_plan_requests USING btree (status, created_at);


--
-- Name: idx_lp_requests_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lp_requests_user ON public.lesson_plan_requests USING btree (user_id);


--
-- Name: idx_mv_dashboard_stats_by_country_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_dashboard_stats_by_country_pk ON public.mv_dashboard_stats_by_country USING btree (country_code);


--
-- Name: idx_mv_dashboard_stats_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_dashboard_stats_key ON public.mv_dashboard_stats USING btree (last_refreshed);


--
-- Name: idx_mv_retention_cohorts_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_retention_cohorts_feature ON public.mv_retention_cohorts USING btree (feature_type);


--
-- Name: idx_mv_retention_cohorts_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_retention_cohorts_unique ON public.mv_retention_cohorts USING btree (cohort_week, feature_type);


--
-- Name: idx_mv_users_activity_country; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_users_activity_country ON public.mv_users_activity USING btree (country_code) WHERE (is_test_user = false);


--
-- Name: idx_mv_users_activity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_users_activity_created ON public.mv_users_activity USING btree (created_at DESC);


--
-- Name: idx_mv_users_activity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_users_activity_id ON public.mv_users_activity USING btree (id);


--
-- Name: idx_mv_users_activity_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_users_activity_last_activity ON public.mv_users_activity USING btree (last_activity DESC NULLS LAST);


--
-- Name: idx_mv_users_activity_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_users_activity_phone ON public.mv_users_activity USING btree (phone_number);


--
-- Name: idx_mv_users_activity_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_users_activity_school ON public.mv_users_activity USING btree (school_name_lower) WHERE ((is_test_user = false) AND (school_name_lower <> ''::text));


--
-- Name: idx_mv_view_refresh_status_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_view_refresh_status_pk ON public.mv_view_refresh_status USING btree (view_name);


--
-- Name: idx_niete_lp_asset_sources_lesson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_niete_lp_asset_sources_lesson ON public.niete_lp_asset_sources USING btree (lesson_id);


--
-- Name: idx_niete_lp_fidelity_moves_lesson; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_niete_lp_fidelity_moves_lesson ON public.niete_lp_fidelity_moves USING btree (lesson_id);


--
-- Name: idx_obs_sched_leader_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obs_sched_leader_status ON public.observation_schedules USING btree (leader_user_id, status, scheduled_for);


--
-- Name: idx_observation_field_forms_observer_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_observation_field_forms_observer_recent ON public.observation_field_forms USING btree (observer_user_id, created_at DESC);


--
-- Name: idx_observation_field_forms_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_observation_field_forms_teacher ON public.observation_field_forms USING btree (teacher_user_id) WHERE (teacher_user_id IS NOT NULL);


--
-- Name: idx_observation_schedules_teacher_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_observation_schedules_teacher_user ON public.observation_schedules USING btree (teacher_user_id) WHERE (teacher_user_id IS NOT NULL);


--
-- Name: idx_one_class_teacher_per_class; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_one_class_teacher_per_class ON public.class_teachers USING btree (class_id) WHERE (is_class_teacher AND is_active);


--
-- Name: idx_one_teacher_per_class_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_one_teacher_per_class_subject ON public.class_teacher_subjects USING btree (class_id, subject_code) WHERE (class_id IS NOT NULL);


--
-- Name: idx_pic_lp_sessions_expires_at_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pic_lp_sessions_expires_at_active ON public.pic_lp_sessions USING btree (expires_at) WHERE (status = ANY (ARRAY['awaiting_intent'::text, 'collecting_pages'::text, 'awaiting_form_submit'::text, 'generating'::text]));


--
-- Name: idx_pic_lp_sessions_flow_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pic_lp_sessions_flow_token ON public.pic_lp_sessions USING btree (flow_token) WHERE (flow_token IS NOT NULL);


--
-- Name: idx_pic_lp_sessions_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pic_lp_sessions_user_active ON public.pic_lp_sessions USING btree (user_id, created_at DESC) WHERE (status = ANY (ARRAY['awaiting_intent'::text, 'collecting_pages'::text, 'awaiting_form_submit'::text, 'generating'::text]));


--
-- Name: idx_portal_orgs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_orgs_active ON public.portal_organizations USING btree (is_active);


--
-- Name: idx_portal_orgs_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_orgs_name ON public.portal_organizations USING btree (name);


--
-- Name: idx_pregen_lps_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pregen_lps_lookup ON public.pre_generated_lps USING btree (curriculum, grade, chapter_number) WHERE (is_current = true);


--
-- Name: idx_qa_bug_patterns_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_bug_patterns_resolved ON public.qa_bug_patterns USING btree (is_resolved);


--
-- Name: idx_qa_bug_patterns_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_bug_patterns_severity ON public.qa_bug_patterns USING btree (severity);


--
-- Name: idx_qa_bug_patterns_signature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_bug_patterns_signature ON public.qa_bug_patterns USING gin (to_tsvector('english'::regconfig, error_signature));


--
-- Name: idx_qa_proposals_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_proposals_created ON public.qa_analyst_proposals USING btree (created_at DESC);


--
-- Name: idx_qa_proposals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_proposals_status ON public.qa_analyst_proposals USING btree (status);


--
-- Name: idx_qa_test_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_test_runs_started ON public.qa_test_runs USING btree (started_at DESC);


--
-- Name: idx_qa_test_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_test_runs_status ON public.qa_test_runs USING btree (status);


--
-- Name: idx_qa_test_runs_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_test_runs_trigger ON public.qa_test_runs USING btree (trigger_type);


--
-- Name: idx_quality_metrics_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_metrics_created ON public.coaching_quality_metrics USING btree (created_at DESC);


--
-- Name: idx_quality_metrics_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_metrics_session ON public.coaching_quality_metrics USING btree (coaching_session_id);


--
-- Name: idx_queue_pending_jobs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_queue_pending_jobs ON public.coaching_processing_queue USING btree (status, next_retry_at, created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_queue_processing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_queue_processing ON public.coaching_processing_queue USING btree (status, processing_worker_id) WHERE ((status)::text = 'processing'::text);


--
-- Name: idx_queue_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_queue_session ON public.coaching_processing_queue USING btree (coaching_session_id);


--
-- Name: idx_quiz_answers_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_answers_session_id ON public.quiz_answers USING btree (session_id);


--
-- Name: idx_quiz_questions_difficulty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_questions_difficulty ON public.quiz_questions USING btree (quiz_id, difficulty_level);


--
-- Name: idx_quiz_questions_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_quiz_questions_external_id ON public.quiz_questions USING btree (external_id) WHERE (external_id IS NOT NULL);


--
-- Name: idx_quiz_questions_quiz_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_questions_quiz_id ON public.quiz_questions USING btree (quiz_id);


--
-- Name: idx_quiz_sessions_invited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_invited_by ON public.quiz_sessions USING btree (invited_by_student_id) WHERE (invited_by_student_id IS NOT NULL);


--
-- Name: idx_quiz_sessions_parent_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_parent_phone ON public.quiz_sessions USING btree (parent_phone);


--
-- Name: idx_quiz_sessions_quiz_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_quiz_id ON public.quiz_sessions USING btree (quiz_id);


--
-- Name: idx_quiz_sessions_share_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_share_code ON public.quiz_sessions USING btree (share_code_id) WHERE (share_code_id IS NOT NULL);


--
-- Name: idx_quiz_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_status ON public.quiz_sessions USING btree (status);


--
-- Name: idx_quiz_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_sessions_user_id ON public.quiz_sessions USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_quiz_share_codes_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_share_codes_class ON public.quiz_share_codes USING btree (class_id) WHERE (class_id IS NOT NULL);


--
-- Name: idx_quiz_share_codes_quiz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_share_codes_quiz ON public.quiz_share_codes USING btree (quiz_id);


--
-- Name: idx_quiz_share_codes_report_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_share_codes_report_pending ON public.quiz_share_codes USING btree (created_at) WHERE (report_sent_at IS NULL);


--
-- Name: idx_quiz_share_codes_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_share_codes_teacher ON public.quiz_share_codes USING btree (teacher_user_id);


--
-- Name: idx_quizzes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quizzes_status ON public.quizzes USING btree (status);


--
-- Name: idx_quizzes_teacher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quizzes_teacher_id ON public.quizzes USING btree (teacher_id);


--
-- Name: idx_quizzes_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_quizzes_video_id ON public.quizzes USING btree (video_id) WHERE (video_id IS NOT NULL);


--
-- Name: idx_reading_assessments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_created_at ON public.reading_assessments USING btree (created_at DESC);


--
-- Name: idx_reading_assessments_lock_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_lock_query ON public.reading_assessments USING btree (id, status) WHERE ((status)::text = ANY (ARRAY[('passage_generated'::character varying)::text, ('audio_received'::character varying)::text, ('processing'::character varying)::text]));


--
-- Name: idx_reading_assessments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_status ON public.reading_assessments USING btree (status);


--
-- Name: idx_reading_assessments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_user_id ON public.reading_assessments USING btree (user_id);


--
-- Name: idx_reading_assessments_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_user_status ON public.reading_assessments USING btree (user_id, status, created_at DESC);


--
-- Name: idx_reading_assessments_user_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_assessments_user_student ON public.reading_assessments USING btree (user_id, student_identifier);


--
-- Name: idx_reading_concurrent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_concurrent ON public.reading_assessments USING btree (user_id, status) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text]));


--
-- Name: idx_reading_grade_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_grade_lang ON public.reading_assessments USING btree (grade_level, language, created_at DESC) WHERE ((status)::text = 'completed'::text);


--
-- Name: idx_reading_stuck_jobs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_stuck_jobs ON public.reading_assessments USING btree (status, processing_started_at) WHERE ((status)::text = 'processing'::text);


--
-- Name: idx_reading_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reading_user_created ON public.reading_assessments USING btree (user_id, created_at, status);


--
-- Name: idx_recall_caller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recall_caller ON public.call_recall_docs USING btree (caller_number, created_at DESC);


--
-- Name: idx_recall_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recall_fts ON public.call_recall_docs USING gin (to_tsvector('simple'::regconfig, content));


--
-- Name: idx_record_history_cols; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_cols ON public.record_history USING gin (changed_cols);


--
-- Name: idx_record_history_row; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_row ON public.record_history USING btree (table_name, row_id, changed_at DESC);


--
-- Name: idx_record_history_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_history_time ON public.record_history USING btree (changed_at DESC);


--
-- Name: idx_release_notes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_release_notes_category ON public.release_notes USING btree (category);


--
-- Name: idx_release_notes_env_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_release_notes_env_date ON public.release_notes USING btree (environment, created_at DESC);


--
-- Name: idx_roster_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_audit_actor ON public.leader_roster_audit USING btree (actor_user_id, created_at DESC);


--
-- Name: idx_roster_audit_affected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_audit_affected ON public.leader_roster_audit USING btree (affected_leader_user_id, created_at DESC);


--
-- Name: idx_roster_audit_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roster_audit_teacher ON public.leader_roster_audit USING btree (teacher_phone_e164, created_at DESC);


--
-- Name: idx_schools_emis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_emis ON public.schools USING btree (emis);


--
-- Name: idx_schools_emis_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_schools_emis_unique ON public.schools USING btree (emis) WHERE (emis IS NOT NULL);


--
-- Name: idx_schools_name_canon_region; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_schools_name_canon_region ON public.schools USING btree (upper(regexp_replace((name)::text, '[^a-zA-Z0-9]'::text, ''::text, 'g'::text)), COALESCE(region, ''::character varying)) WHERE (emis IS NULL);


--
-- Name: idx_schools_principal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_principal ON public.schools USING btree (principal_user_id) WHERE (principal_user_id IS NOT NULL);


--
-- Name: idx_schools_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_region ON public.schools USING btree (region);


--
-- Name: idx_schools_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schools_source ON public.schools USING btree (source_system, source_school_id);


--
-- Name: idx_student_lists_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_lists_active ON public.student_lists USING btree (user_id, is_active) WHERE (is_active = true);


--
-- Name: idx_student_lists_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_lists_class ON public.student_lists USING btree (class_id) WHERE (class_id IS NOT NULL);


--
-- Name: idx_student_lists_unique_class; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_student_lists_unique_class ON public.student_lists USING btree (user_id, lower((class_name)::text), academic_year) WHERE (is_active = true);


--
-- Name: idx_student_lists_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_lists_user ON public.student_lists USING btree (user_id);


--
-- Name: idx_student_video_feedback_useful_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_video_feedback_useful_time ON public.student_video_feedback USING btree (useful, created_at DESC);


--
-- Name: idx_student_video_feedback_user_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_video_feedback_user_time ON public.student_video_feedback USING btree (user_id, created_at DESC);


--
-- Name: idx_student_videos_grade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_videos_grade ON public.student_videos USING btree (grade);


--
-- Name: idx_student_videos_grade_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_videos_grade_subject ON public.student_videos USING btree (grade, subject);


--
-- Name: idx_student_videos_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_videos_search ON public.student_videos USING gin (search_vector);


--
-- Name: idx_student_videos_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_videos_subject ON public.student_videos USING btree (subject);


--
-- Name: idx_student_videos_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_videos_topic ON public.student_videos USING btree (topic);


--
-- Name: idx_students_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_students_code ON public.students USING btree (student_code);


--
-- Name: idx_students_enrolled_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_enrolled_by ON public.students USING btree (enrolled_by_user_id) WHERE (enrolled_by_user_id IS NOT NULL);


--
-- Name: idx_students_import_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_import_run ON public.students USING btree (import_run_id) WHERE (import_run_id IS NOT NULL);


--
-- Name: idx_students_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_list ON public.students USING btree (list_id) WHERE (is_active = true);


--
-- Name: idx_students_list_roll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_list_roll ON public.students USING btree (list_id, roll_number) WHERE (is_active = true);


--
-- Name: idx_students_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_phone ON public.students USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_students_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_school ON public.students USING btree (school_id) WHERE (school_id IS NOT NULL);


--
-- Name: idx_students_school_admission_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_school_admission_lookup ON public.students USING btree (school_id, admission_no) WHERE ((school_id IS NOT NULL) AND (admission_no IS NOT NULL));


--
-- Name: idx_subjects_aliases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subjects_aliases ON public.subjects USING gin (aliases);


--
-- Name: idx_supervisor_remark_scores_remark; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supervisor_remark_scores_remark ON public.supervisor_remark_scores USING btree (remark_id);


--
-- Name: idx_supervisor_remarks_cycle_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supervisor_remarks_cycle_pending ON public.supervisor_remarks USING btree (cycle_id, principal_user_id) WHERE (submitted_at IS NULL);


--
-- Name: idx_supervisor_remarks_principal_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supervisor_remarks_principal_cycle ON public.supervisor_remarks USING btree (principal_user_id, cycle_id);


--
-- Name: idx_supervisor_remarks_teacher_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supervisor_remarks_teacher_cycle ON public.supervisor_remarks USING btree (teacher_id, cycle_id);


--
-- Name: idx_taa_abandon_sweep; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taa_abandon_sweep ON public.training_assessment_attempts USING btree (last_activity_at) WHERE (status = 'in_progress'::public.training_attempt_status);


--
-- Name: idx_taa_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taa_kind ON public.training_assessment_attempts USING btree (quiz_kind);


--
-- Name: idx_taa_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taa_user ON public.training_assessment_attempts USING btree (user_id);


--
-- Name: idx_taans_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_taans_question ON public.training_assessment_answers USING btree (question_id);


--
-- Name: idx_tcce_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tcce_entity ON public.training_content_change_events USING btree (entity_type, entity_id);


--
-- Name: idx_teacher_attendance_school_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_attendance_school_date ON public.teacher_attendance_records USING btree (school_id, date);


--
-- Name: idx_teacher_attendance_teacher_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_attendance_teacher_date ON public.teacher_attendance_records USING btree (teacher_id, date DESC);


--
-- Name: idx_teacher_facts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_facts_user ON public.teacher_facts USING btree (user_id);


--
-- Name: idx_teacher_progress_user_dimension; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_teacher_progress_user_dimension ON public.teacher_progress USING btree (user_id, dimension, created_at DESC);


--
-- Name: idx_textbook_pages_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_textbook_pages_lookup ON public.textbook_pages USING btree (textbook_id, textbook_page_number) WHERE (page_content IS NOT NULL);


--
-- Name: idx_textbook_toc_keywords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_textbook_toc_keywords ON public.textbook_toc USING gin (topic_keywords);


--
-- Name: idx_textbook_toc_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_textbook_toc_lookup ON public.textbook_toc USING btree (curriculum, grade, subject);


--
-- Name: idx_training_certificates_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_certificates_user ON public.training_certificates USING btree (user_id);


--
-- Name: idx_training_courses_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_courses_level ON public.training_courses USING btree (level_id) WHERE is_active;


--
-- Name: idx_training_modules_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_modules_course ON public.training_modules USING btree (course_id) WHERE is_active;


--
-- Name: idx_training_program_scopes_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_program_scopes_program ON public.training_program_scopes USING btree (program_id);


--
-- Name: idx_training_questions_grand_quiz; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_questions_grand_quiz ON public.training_questions USING btree (grand_quiz_id) WHERE ((grand_quiz_id IS NOT NULL) AND is_active);


--
-- Name: idx_training_questions_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_questions_module ON public.training_questions USING btree (training_module_id) WHERE ((training_module_id IS NOT NULL) AND is_active);


--
-- Name: idx_training_questions_rubric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_questions_rubric ON public.training_questions USING btree (id) WHERE (rubric IS NOT NULL);


--
-- Name: idx_user_feature_first_use_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_feature_first_use_lookup ON public.user_feature_first_use USING btree (user_id, feature);


--
-- Name: idx_users_conversation_state_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_conversation_state_expiry ON public.users USING btree (conversation_state_expires_at) WHERE (conversation_state IS NOT NULL);


--
-- Name: idx_users_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_created_at ON public.users USING btree (created_at);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_users_is_test; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_test ON public.users USING btree (is_test_user) WHERE (is_test_user = true);


--
-- Name: idx_users_is_test_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_test_user ON public.users USING btree (is_test_user) WHERE (is_test_user = true);


--
-- Name: idx_users_language_locked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_language_locked ON public.users USING btree (language_locked);


--
-- Name: idx_users_language_nudge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_language_nudge ON public.users USING btree (language_nudge_sent, updated_at);


--
-- Name: idx_users_merged_into; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_merged_into ON public.users USING btree (merged_into) WHERE (merged_into IS NOT NULL);


--
-- Name: idx_users_password_reset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_password_reset ON public.users USING btree (password_reset_code, password_reset_expires_at) WHERE (password_reset_code IS NOT NULL);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone_number);


--
-- Name: idx_users_phone_number_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_number_prefix ON public.users USING btree ("left"((phone_number)::text, 4));


--
-- Name: idx_users_portal_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_portal_invite_token ON public.users USING btree (portal_invite_token) WHERE (portal_invite_token IS NOT NULL);


--
-- Name: idx_users_portal_login; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_portal_login ON public.users USING btree (phone_number, portal_activated) WHERE (portal_activated = true);


--
-- Name: idx_users_preferred_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_preferred_language ON public.users USING btree (preferred_language);


--
-- Name: idx_users_registration_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_registration_completed ON public.users USING btree (registration_completed_at) WHERE (registration_completed_at IS NOT NULL);


--
-- Name: idx_users_registration_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_registration_state ON public.users USING btree (registration_state);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role) WHERE (role IS NOT NULL);


--
-- Name: idx_users_school_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_school_id ON public.users USING btree (school_id) WHERE (school_id IS NOT NULL);


--
-- Name: idx_users_school_name_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_school_name_lower ON public.users USING btree (lower((school_name)::text));


--
-- Name: idx_users_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_session_id ON public.users USING btree (session_id);


--
-- Name: idx_users_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_source ON public.users USING btree (source);


--
-- Name: idx_video_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_requests_created_at ON public.video_requests USING btree (created_at DESC);


--
-- Name: idx_video_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_requests_status ON public.video_requests USING btree (status);


--
-- Name: idx_video_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_requests_user_id ON public.video_requests USING btree (user_id);


--
-- Name: idx_video_tasks_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_tasks_request_id ON public.video_tasks USING btree (video_request_id);


--
-- Name: idx_video_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_tasks_status ON public.video_tasks USING btree (status);


--
-- Name: idx_videos_grade_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_grade_subject ON public.videos USING btree (grade, subject);


--
-- Name: idx_vqd_delivered; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqd_delivered ON public.video_quiz_deliveries USING btree (delivered_at DESC);


--
-- Name: idx_vqd_response; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqd_response ON public.video_quiz_deliveries USING btree (quiz_response) WHERE (quiz_response IS NOT NULL);


--
-- Name: idx_vqd_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqd_session ON public.video_quiz_deliveries USING btree (quiz_session_id) WHERE (quiz_session_id IS NOT NULL);


--
-- Name: idx_vqd_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqd_user ON public.video_quiz_deliveries USING btree (user_id, delivered_at DESC);


--
-- Name: idx_vqd_video; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vqd_video ON public.video_quiz_deliveries USING btree (video_id);


--
-- Name: idx_wcpm_percentiles_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wcpm_percentiles_lookup ON public.wcpm_percentiles USING btree (grade_level, language, season, percentile);


--
-- Name: idx_website_visits_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_website_visits_created_at ON public.website_visits USING btree (created_at DESC);


--
-- Name: idx_website_visits_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_website_visits_session_id ON public.website_visits USING btree (session_id);


--
-- Name: ix_nietemig_ans_observation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_ans_observation ON public.nietemigrated_observation_answers USING btree (observation_id);


--
-- Name: ix_nietemig_ans_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_ans_question ON public.nietemigrated_observation_answers USING btree (question_id);


--
-- Name: ix_nietemig_obs_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_obs_coach ON public.nietemigrated_observations USING btree (coach_id);


--
-- Name: ix_nietemig_obs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_obs_date ON public.nietemigrated_observations USING btree (observation_date);


--
-- Name: ix_nietemig_obs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_obs_status ON public.nietemigrated_observations USING btree (status);


--
-- Name: ix_nietemig_obs_visit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_obs_visit ON public.nietemigrated_observations USING btree (visit_id);


--
-- Name: ix_nietemig_opts_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_opts_question ON public.nietemigrated_question_options USING btree (question_id);


--
-- Name: ix_nietemig_qs_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_qs_group ON public.nietemigrated_observation_questions USING btree (group_id);


--
-- Name: ix_nietemig_qs_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_qs_section ON public.nietemigrated_observation_questions USING btree (section_id);


--
-- Name: ix_nietemig_sv_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_sv_date ON public.nietemigrated_school_visits USING btree (visit_date);


--
-- Name: ix_nietemig_sv_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_sv_school ON public.nietemigrated_school_visits USING btree (school_id);


--
-- Name: ix_nietemig_tv_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_tv_coach ON public.nietemigrated_teacher_visits USING btree (coach_id);


--
-- Name: ix_nietemig_tv_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_tv_date ON public.nietemigrated_teacher_visits USING btree (visit_date);


--
-- Name: ix_nietemig_tv_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_tv_school ON public.nietemigrated_teacher_visits USING btree (school_id);


--
-- Name: ix_nietemig_tv_schoolvisit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_tv_schoolvisit ON public.nietemigrated_teacher_visits USING btree (school_visit_id);


--
-- Name: ix_nietemig_tv_teacher; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nietemig_tv_teacher ON public.nietemigrated_teacher_visits USING btree (teacher_id);


--
-- Name: leader_teachers_live_assignment_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leader_teachers_live_assignment_key ON public.leader_teachers USING btree (leader_user_id, source, school_ext_id, teacher_ext_id) WHERE (deleted_at IS NULL);


--
-- Name: niete_lp_fidelity_moves_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX niete_lp_fidelity_moves_version_uniq ON public.niete_lp_fidelity_moves USING btree (lesson_id, version_stamp, content_hash);


--
-- Name: quizzes_one_transcript_quiz_per_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quizzes_one_transcript_quiz_per_session ON public.quizzes USING btree (coaching_session_id) WHERE (quiz_source = 'transcript'::text);


--
-- Name: quizzes_teacher_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quizzes_teacher_recent ON public.quizzes USING btree (teacher_id, created_at DESC);


--
-- Name: teacher_nudges_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_nudges_due ON public.teacher_nudges USING btree (scheduled_at) WHERE (status = 'pending'::text);


--
-- Name: teacher_nudges_user_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX teacher_nudges_user_recent ON public.teacher_nudges USING btree (user_id, nudge_date DESC);


--
-- Name: uq_assessment_papers_request_attempt_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_assessment_papers_request_attempt_generated ON public.assessment_papers USING btree (request_id, attempt) WHERE (edited_from IS NULL);


--
-- Name: uq_child_test_blocks_session_block; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_child_test_blocks_session_block ON public.child_test_blocks USING btree (session_id, block);


--
-- Name: uq_child_test_draws_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_child_test_draws_rank ON public.child_test_draws USING btree (cycle_id, class_id, draw_rank) WHERE (sample_role = 'new'::text);


--
-- Name: uq_child_test_draws_student; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_child_test_draws_student ON public.child_test_draws USING btree (cycle_id, student_id, sample_role);


--
-- Name: uq_child_test_sessions_draw; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_child_test_sessions_draw ON public.child_test_sessions USING btree (draw_id);


--
-- Name: uq_obs_sched_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_obs_sched_active ON public.observation_schedules USING btree (leader_user_id, school_ext_id, teacher_ext_id) WHERE (status = 'upcoming'::text);


--
-- Name: uq_observation_field_forms_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_observation_field_forms_session ON public.observation_field_forms USING btree (coaching_session_id) WHERE (coaching_session_id IS NOT NULL);


--
-- Name: users_teacher_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_teacher_uuid_idx ON public.users USING btree (teacher_uuid) WHERE (teacher_uuid IS NOT NULL);


--
-- Name: ux_taa_one_active_per_module; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_taa_one_active_per_module ON public.training_assessment_attempts USING btree (user_id, training_module_id) WHERE ((status = 'in_progress'::public.training_attempt_status) AND ((quiz_kind)::text = 'training_module'::text));


--
-- Name: ux_taa_one_active_per_quiz; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_taa_one_active_per_quiz ON public.training_assessment_attempts USING btree (user_id, grand_quiz_id) WHERE (status = 'in_progress'::public.training_attempt_status);


--
-- Name: ux_tta_user_program_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tta_user_program_active ON public.teacher_training_assignments USING btree (user_id, program_id) WHERE is_active;


--
-- Name: ux_users_teacher_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_users_teacher_uuid ON public.users USING btree (teacher_uuid) WHERE (teacher_uuid IS NOT NULL);


--
-- Name: web_quiz_challenge_runs_student_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX web_quiz_challenge_runs_student_idx ON public.web_quiz_challenge_runs USING btree (student_id, exercise, created_at DESC);


--
-- Name: access_scopes access_scopes_updated_at_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER access_scopes_updated_at_trigger BEFORE UPDATE ON public.access_scopes FOR EACH ROW EXECUTE FUNCTION public.update_access_scopes_updated_at();


--
-- Name: app_settings app_settings_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_settings_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('key', 'value');


--
-- Name: broadcast_logs broadcast_audit_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER broadcast_audit_trigger BEFORE UPDATE ON public.broadcast_logs FOR EACH ROW EXECUTE FUNCTION public.log_broadcast_changes();


--
-- Name: byof_plans byof_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER byof_plans_updated_at BEFORE UPDATE ON public.byof_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: child_test_blocks child_test_blocks_keep_marks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER child_test_blocks_keep_marks BEFORE UPDATE ON public.child_test_blocks FOR EACH ROW EXECUTE FUNCTION public.child_test_blocks_keep_marks();


--
-- Name: child_test_draws child_test_draws_keep_rank; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER child_test_draws_keep_rank BEFORE UPDATE ON public.child_test_draws FOR EACH ROW EXECUTE FUNCTION public.child_test_draws_keep_rank();


--
-- Name: child_test_draws child_test_draws_name_visit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER child_test_draws_name_visit BEFORE INSERT OR UPDATE OF list_slot, status, visit_key ON public.child_test_draws FOR EACH ROW EXECUTE FUNCTION public.child_test_draws_name_visit();


--
-- Name: child_test_sessions child_test_sessions_name_visit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER child_test_sessions_name_visit BEFORE INSERT ON public.child_test_sessions FOR EACH ROW EXECUTE FUNCTION public.child_test_sessions_name_visit();


--
-- Name: class_enrollments class_enrollments_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_enrollments_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.class_enrollments FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'class_id', 'student_id', 'roll_number', 'outcome');


--
-- Name: class_teachers class_teachers_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER class_teachers_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.class_teachers FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'is_class_teacher', 'class_id', 'teacher_user_id');


--
-- Name: classes classes_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER classes_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'school_id', 'grade_code', 'section', 'shift_code', 'session_code', 'is_active', 'created_by_user_id');


--
-- Name: coaching_sessions coaching_sessions_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER coaching_sessions_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.coaching_sessions FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status', 'conversation_state', 'lesson_plan_extraction_status', 'debrief_status');


--
-- Name: exam_check_sessions exam_check_sessions_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_check_sessions_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.exam_check_sessions FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status');


--
-- Name: exam_check_sessions exam_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_sessions_updated_at BEFORE UPDATE ON public.exam_check_sessions FOR EACH ROW EXECUTE FUNCTION public.update_exam_checker_updated_at();


--
-- Name: exam_submissions exam_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_submissions_updated_at BEFORE UPDATE ON public.exam_submissions FOR EACH ROW EXECUTE FUNCTION public.update_exam_checker_updated_at();


--
-- Name: exam_templates exam_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER exam_templates_updated_at BEFORE UPDATE ON public.exam_templates FOR EACH ROW EXECUTE FUNCTION public.update_exam_checker_updated_at();


--
-- Name: conversations increment_session_turn_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER increment_session_turn_count AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.increment_turn_count();


--
-- Name: lesson_plan_requests lesson_plan_requests_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER lesson_plan_requests_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.lesson_plan_requests FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status', 'retry_count', 'error_message');


--
-- Name: observation_field_forms observation_field_forms_keep_seal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER observation_field_forms_keep_seal BEFORE UPDATE ON public.observation_field_forms FOR EACH ROW EXECUTE FUNCTION public.observation_field_forms_keep_seal();


--
-- Name: observation_schedules observation_schedules_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER observation_schedules_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.observation_schedules FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status');


--
-- Name: qa_analyst_proposals qa_analyst_proposals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER qa_analyst_proposals_updated_at BEFORE UPDATE ON public.qa_analyst_proposals FOR EACH ROW EXECUTE FUNCTION public.update_qa_updated_at();


--
-- Name: qa_bug_patterns qa_bug_patterns_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER qa_bug_patterns_updated_at BEFORE UPDATE ON public.qa_bug_patterns FOR EACH ROW EXECUTE FUNCTION public.update_qa_updated_at();


--
-- Name: qa_test_runs qa_test_runs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER qa_test_runs_updated_at BEFORE UPDATE ON public.qa_test_runs FOR EACH ROW EXECUTE FUNCTION public.update_qa_updated_at();


--
-- Name: schools schools_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER schools_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.schools FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'name', 'emis', 'region', 'principal_user_id', 'is_active');


--
-- Name: student_lists student_lists_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER student_lists_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.student_lists FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'class_id', 'user_id');


--
-- Name: students students_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER students_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'student_name', 'father_name', 'roll_number', 'is_active', 'status', 'school_id', 'merged_into', 'admission_no', 'list_id');


--
-- Name: teacher_attendance_records teacher_attendance_records_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER teacher_attendance_records_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.teacher_attendance_records FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status', 'leave_type', 'school_id');


--
-- Name: teacher_training_assignments teacher_training_assignments_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER teacher_training_assignments_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.teacher_training_assignments FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'is_active', 'assigned_by');


--
-- Name: training_assessment_attempts training_assessment_attempts_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER training_assessment_attempts_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.training_assessment_attempts FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'status', 'score', 'total_score', 'is_passed', 'level_id');


--
-- Name: ama_messages trigger_auto_title_conversation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_auto_title_conversation AFTER INSERT ON public.ama_messages FOR EACH ROW EXECUTE FUNCTION public.auto_title_conversation();


--
-- Name: byof_sessions trigger_update_byof_session_timestamp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_byof_session_timestamp BEFORE UPDATE ON public.byof_sessions FOR EACH ROW EXECUTE FUNCTION public.update_byof_session_timestamp();


--
-- Name: ama_messages trigger_update_conversation_on_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_conversation_on_message AFTER INSERT ON public.ama_messages FOR EACH ROW EXECUTE FUNCTION public.update_conversation_on_message();


--
-- Name: students trigger_update_student_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_student_count AFTER UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_student_count();


--
-- Name: student_videos trigger_update_student_videos_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_student_videos_search_vector BEFORE UPDATE ON public.student_videos FOR EACH ROW EXECUTE FUNCTION public.update_student_videos_search_vector();


--
-- Name: student_videos trigger_update_student_videos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_student_videos_updated_at BEFORE UPDATE ON public.student_videos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_settings update_app_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: chat_sessions update_chat_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON public.chat_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: child_test_blocks update_child_test_blocks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_child_test_blocks_updated_at BEFORE UPDATE ON public.child_test_blocks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: child_test_draws update_child_test_draws_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_child_test_draws_updated_at BEFORE UPDATE ON public.child_test_draws FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: child_test_sessions update_child_test_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_child_test_sessions_updated_at BEFORE UPDATE ON public.child_test_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: coaching_sessions update_coaching_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_coaching_sessions_updated_at BEFORE UPDATE ON public.coaching_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: image_analysis_requests update_image_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_image_requests_updated_at BEFORE UPDATE ON public.image_analysis_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: observation_field_forms update_observation_field_forms_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_observation_field_forms_updated_at BEFORE UPDATE ON public.observation_field_forms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: pic_lp_sessions update_pic_lp_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pic_lp_sessions_updated_at BEFORE UPDATE ON public.pic_lp_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: reading_assessments update_reading_assessments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reading_assessments_updated_at BEFORE UPDATE ON public.reading_assessments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations update_session_count_on_message_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_session_count_on_message_insert AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_session_message_count();


--
-- Name: student_lists update_student_lists_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_student_lists_updated_at BEFORE UPDATE ON public.student_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: students update_students_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: teacher_facts update_teacher_facts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_teacher_facts_updated_at BEFORE UPDATE ON public.teacher_facts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users users_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER users_history_trigger AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_row_changes('id', 'phone_number', 'name', 'preferred_language', 'language_locked', 'registration_state', 'registration_completed', 'role', 'region', 'country', 'organization', 'school_id', 'school_name', 'teacher_uuid', 'subject', 'grades_taught', 'subjects_taught', 'teacher_level', 'is_test_user', 'portal_activated');


--
-- Name: ab_test_events ab_test_events_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT ab_test_events_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.ab_tests(id);


--
-- Name: ab_test_events ab_test_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT ab_test_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ab_test_variants ab_test_variants_test_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_variants
    ADD CONSTRAINT ab_test_variants_test_id_fkey FOREIGN KEY (test_id) REFERENCES public.ab_tests(id);


--
-- Name: access_scopes access_scopes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_scopes
    ADD CONSTRAINT access_scopes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.dashboard_users(id);


--
-- Name: access_scopes access_scopes_dashboard_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_scopes
    ADD CONSTRAINT access_scopes_dashboard_user_id_fkey FOREIGN KEY (dashboard_user_id) REFERENCES public.dashboard_users(id);


--
-- Name: ama_conversations ama_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_conversations
    ADD CONSTRAINT ama_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.dashboard_users(id);


--
-- Name: ama_messages ama_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_messages
    ADD CONSTRAINT ama_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ama_conversations(id);


--
-- Name: ama_messages ama_messages_tracer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_messages
    ADD CONSTRAINT ama_messages_tracer_user_id_fkey FOREIGN KEY (tracer_user_id) REFERENCES public.users(id);


--
-- Name: ama_query_audit ama_query_audit_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_query_audit
    ADD CONSTRAINT ama_query_audit_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.ama_messages(id);


--
-- Name: ama_query_audit ama_query_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ama_query_audit
    ADD CONSTRAINT ama_query_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.dashboard_users(id);


--
-- Name: assessment_papers assessment_papers_edited_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_papers
    ADD CONSTRAINT assessment_papers_edited_from_fkey FOREIGN KEY (edited_from) REFERENCES public.assessment_papers(id);


--
-- Name: assessment_papers assessment_papers_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_papers
    ADD CONSTRAINT assessment_papers_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.assessment_requests(id) ON DELETE CASCADE;


--
-- Name: assessment_requests assessment_requests_grade_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_requests
    ADD CONSTRAINT assessment_requests_grade_code_fkey FOREIGN KEY (grade_code) REFERENCES public.grade_levels(code);


--
-- Name: assessment_requests assessment_requests_subject_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_requests
    ADD CONSTRAINT assessment_requests_subject_code_fkey FOREIGN KEY (subject_code) REFERENCES public.subjects(code);


--
-- Name: assessment_requests assessment_requests_textbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_requests
    ADD CONSTRAINT assessment_requests_textbook_id_fkey FOREIGN KEY (textbook_id) REFERENCES public.textbooks(id);


--
-- Name: assessment_requests assessment_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_requests
    ADD CONSTRAINT assessment_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: attendance_records attendance_records_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id);


--
-- Name: attendance_records attendance_records_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: attendance_sessions attendance_sessions_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.student_lists(id);


--
-- Name: attendance_sessions attendance_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audio_sessions audio_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_sessions
    ADD CONSTRAINT audio_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: broadcast_logs broadcast_logs_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_logs
    ADD CONSTRAINT broadcast_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.dashboard_users(id);


--
-- Name: broadcast_messages broadcast_messages_broadcast_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_messages
    ADD CONSTRAINT broadcast_messages_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcast_logs(id);


--
-- Name: broadcast_messages broadcast_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_messages
    ADD CONSTRAINT broadcast_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: byof_approval_log byof_approval_log_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_approval_log
    ADD CONSTRAINT byof_approval_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.dashboard_users(id);


--
-- Name: byof_approval_log byof_approval_log_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_approval_log
    ADD CONSTRAINT byof_approval_log_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.byof_plans(id);


--
-- Name: byof_messages byof_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_messages
    ADD CONSTRAINT byof_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.byof_sessions(id);


--
-- Name: byof_plans byof_plans_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_plans
    ADD CONSTRAINT byof_plans_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.dashboard_users(id);


--
-- Name: byof_plans byof_plans_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_plans
    ADD CONSTRAINT byof_plans_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.byof_sessions(id);


--
-- Name: byof_sessions byof_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.byof_sessions
    ADD CONSTRAINT byof_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.dashboard_users(id);


--
-- Name: calls calls_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_sessions chat_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chat_starts chat_starts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_starts
    ADD CONSTRAINT chat_starts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: child_test_blocks child_test_blocks_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_blocks
    ADD CONSTRAINT child_test_blocks_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.child_test_sessions(id) ON DELETE CASCADE;


--
-- Name: child_test_draws child_test_draws_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: child_test_draws child_test_draws_last_listed_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_last_listed_visit_id_fkey FOREIGN KEY (last_listed_visit_id) REFERENCES public.observation_field_forms(id) ON DELETE SET NULL;


--
-- Name: child_test_draws child_test_draws_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: child_test_draws child_test_draws_source_draw_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_source_draw_id_fkey FOREIGN KEY (source_draw_id) REFERENCES public.child_test_draws(id);


--
-- Name: child_test_draws child_test_draws_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_draws
    ADD CONSTRAINT child_test_draws_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: child_test_sessions child_test_sessions_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: child_test_sessions child_test_sessions_coach_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_coach_user_id_fkey FOREIGN KEY (coach_user_id) REFERENCES public.users(id);


--
-- Name: child_test_sessions child_test_sessions_draw_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_draw_id_fkey FOREIGN KEY (draw_id) REFERENCES public.child_test_draws(id);


--
-- Name: child_test_sessions child_test_sessions_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: child_test_sessions child_test_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: child_test_sessions child_test_sessions_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.child_test_sessions
    ADD CONSTRAINT child_test_sessions_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.observation_field_forms(id) ON DELETE SET NULL;


--
-- Name: class_enrollments class_enrollments_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_enrollments
    ADD CONSTRAINT class_enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: class_enrollments class_enrollments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_enrollments
    ADD CONSTRAINT class_enrollments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: class_teacher_subjects class_teacher_subjects_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teacher_subjects
    ADD CONSTRAINT class_teacher_subjects_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: class_teacher_subjects class_teacher_subjects_class_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teacher_subjects
    ADD CONSTRAINT class_teacher_subjects_class_teacher_id_fkey FOREIGN KEY (class_teacher_id) REFERENCES public.class_teachers(id) ON DELETE CASCADE;


--
-- Name: class_teacher_subjects class_teacher_subjects_subject_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teacher_subjects
    ADD CONSTRAINT class_teacher_subjects_subject_code_fkey FOREIGN KEY (subject_code) REFERENCES public.subjects(code);


--
-- Name: class_teachers class_teachers_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teachers
    ADD CONSTRAINT class_teachers_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;


--
-- Name: class_teachers class_teachers_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_teachers
    ADD CONSTRAINT class_teachers_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(id);


--
-- Name: classes classes_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: classes classes_grade_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_grade_code_fkey FOREIGN KEY (grade_code) REFERENCES public.grade_levels(code);


--
-- Name: classes classes_merged_into_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_merged_into_class_id_fkey FOREIGN KEY (merged_into_class_id) REFERENCES public.classes(id);


--
-- Name: classes classes_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: classes classes_section_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_section_fkey FOREIGN KEY (section) REFERENCES public.sections(code);


--
-- Name: classes classes_session_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_session_code_fkey FOREIGN KEY (session_code) REFERENCES public.academic_sessions(code);


--
-- Name: classes classes_shift_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_shift_code_fkey FOREIGN KEY (shift_code) REFERENCES public.shifts(code);


--
-- Name: coach_directory coach_directory_leader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_directory
    ADD CONSTRAINT coach_directory_leader_user_id_fkey FOREIGN KEY (leader_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: coaching_jobs coaching_jobs_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_jobs
    ADD CONSTRAINT coaching_jobs_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id);


--
-- Name: coaching_processing_queue coaching_processing_queue_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_processing_queue
    ADD CONSTRAINT coaching_processing_queue_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id);


--
-- Name: coaching_quality_metrics coaching_quality_metrics_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_quality_metrics
    ADD CONSTRAINT coaching_quality_metrics_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id);


--
-- Name: coaching_sessions coaching_sessions_duplicate_of_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_duplicate_of_session_id_fkey FOREIGN KEY (duplicate_of_session_id) REFERENCES public.coaching_sessions(id);


--
-- Name: coaching_sessions coaching_sessions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id);


--
-- Name: coaching_sessions coaching_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_sessions
    ADD CONSTRAINT coaching_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: conversations conversations_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id);


--
-- Name: conversations conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: dashboard_audit_log dashboard_audit_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_audit_log
    ADD CONSTRAINT dashboard_audit_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.portal_organizations(id);


--
-- Name: dashboard_audit_log dashboard_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_audit_log
    ADD CONSTRAINT dashboard_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.dashboard_users(id);


--
-- Name: dashboard_users dashboard_users_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.dashboard_users(id);


--
-- Name: dashboard_users dashboard_users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.portal_organizations(id);


--
-- Name: exam_check_sessions exam_check_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_check_sessions
    ADD CONSTRAINT exam_check_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: exam_grades exam_grades_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_grades
    ADD CONSTRAINT exam_grades_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id);


--
-- Name: exam_grades exam_grades_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_grades
    ADD CONSTRAINT exam_grades_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.exam_submissions(id);


--
-- Name: exam_question_bank exam_question_bank_group_ref_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_question_bank
    ADD CONSTRAINT exam_question_bank_group_ref_fkey FOREIGN KEY (group_ref) REFERENCES public.exam_question_groups(id);


--
-- Name: exam_questions exam_questions_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_exam_id_fkey FOREIGN KEY (exam_id) REFERENCES public.exams(id) ON DELETE CASCADE;


--
-- Name: exam_questions exam_questions_source_bank_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_questions
    ADD CONSTRAINT exam_questions_source_bank_id_fkey FOREIGN KEY (source_bank_id) REFERENCES public.exam_question_bank(id);


--
-- Name: exam_submissions exam_submissions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.exam_check_sessions(id);


--
-- Name: exam_submissions exam_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_submissions
    ADD CONSTRAINT exam_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);


--
-- Name: exam_templates exam_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_templates
    ADD CONSTRAINT exam_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: exams exams_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exams
    ADD CONSTRAINT exams_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id);


--
-- Name: feature_suggestions feature_suggestions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_suggestions
    ADD CONSTRAINT feature_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: grade_audit_log grade_audit_log_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_audit_log
    ADD CONSTRAINT grade_audit_log_grade_id_fkey FOREIGN KEY (grade_id) REFERENCES public.exam_grades(id);


--
-- Name: grade_audit_log grade_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grade_audit_log
    ADD CONSTRAINT grade_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: hcp_feedback_deliveries hcp_feedback_deliveries_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_feedback_deliveries
    ADD CONSTRAINT hcp_feedback_deliveries_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.dashboard_users(id);


--
-- Name: hcp_feedback_deliveries hcp_feedback_deliveries_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_feedback_deliveries
    ADD CONSTRAINT hcp_feedback_deliveries_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id);


--
-- Name: hcp_feedback_deliveries hcp_feedback_deliveries_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_feedback_deliveries
    ADD CONSTRAINT hcp_feedback_deliveries_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id);


--
-- Name: hcp_visit_schedules hcp_visit_schedules_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_visit_schedules
    ADD CONSTRAINT hcp_visit_schedules_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.dashboard_users(id);


--
-- Name: hcp_visit_schedules hcp_visit_schedules_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hcp_visit_schedules
    ADD CONSTRAINT hcp_visit_schedules_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id);


--
-- Name: image_analysis_requests image_analysis_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_analysis_requests
    ADD CONSTRAINT image_analysis_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: invitations invitations_created_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_created_user_id_fkey FOREIGN KEY (created_user_id) REFERENCES public.dashboard_users(id);


--
-- Name: invitations invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.dashboard_users(id);


--
-- Name: invitations invitations_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.dashboard_users(id);


--
-- Name: leader_roster_audit leader_roster_audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_roster_audit
    ADD CONSTRAINT leader_roster_audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: leader_roster_audit leader_roster_audit_affected_leader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_roster_audit
    ADD CONSTRAINT leader_roster_audit_affected_leader_user_id_fkey FOREIGN KEY (affected_leader_user_id) REFERENCES public.users(id);


--
-- Name: leader_schools leader_schools_leader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_schools
    ADD CONSTRAINT leader_schools_leader_user_id_fkey FOREIGN KEY (leader_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: leader_schools leader_schools_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_schools
    ADD CONSTRAINT leader_schools_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: leader_teachers leader_teachers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_teachers
    ADD CONSTRAINT leader_teachers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id);


--
-- Name: leader_teachers leader_teachers_leader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_teachers
    ADD CONSTRAINT leader_teachers_leader_user_id_fkey FOREIGN KEY (leader_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: leader_teachers leader_teachers_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leader_teachers
    ADD CONSTRAINT leader_teachers_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: lesson_plan_requests lesson_plan_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plan_requests
    ADD CONSTRAINT lesson_plan_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: lesson_plans lesson_plans_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_plans
    ADD CONSTRAINT lesson_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: lp_feedback lp_feedback_lesson_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lp_feedback
    ADD CONSTRAINT lp_feedback_lesson_plan_id_fkey FOREIGN KEY (lesson_plan_id) REFERENCES public.lesson_plans(id) ON DELETE SET NULL;


--
-- Name: lp_feedback lp_feedback_lp612_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lp_feedback
    ADD CONSTRAINT lp_feedback_lp612_segment_id_fkey FOREIGN KEY (lp612_segment_id) REFERENCES public.niete_lp612_segments(segment_id) ON DELETE SET NULL;


--
-- Name: lp_feedback lp_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lp_feedback
    ADD CONSTRAINT lp_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: niete_lp612_deliveries niete_lp612_deliveries_render_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_deliveries
    ADD CONSTRAINT niete_lp612_deliveries_render_id_fkey FOREIGN KEY (render_id) REFERENCES public.niete_lp612_renders(id) ON DELETE SET NULL;


--
-- Name: niete_lp612_deliveries niete_lp612_deliveries_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_deliveries
    ADD CONSTRAINT niete_lp612_deliveries_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.niete_lp612_segments(segment_id);


--
-- Name: niete_lp612_deliveries niete_lp612_deliveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_deliveries
    ADD CONSTRAINT niete_lp612_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: niete_lp612_renders niete_lp612_renders_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_renders
    ADD CONSTRAINT niete_lp612_renders_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: niete_lp612_renders niete_lp612_renders_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp612_renders
    ADD CONSTRAINT niete_lp612_renders_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.niete_lp612_segments(segment_id);


--
-- Name: niete_lp_ab_assignment niete_lp_ab_assignment_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_ab_assignment
    ADD CONSTRAINT niete_lp_ab_assignment_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: niete_lp_asset_sources niete_lp_asset_sources_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_asset_sources
    ADD CONSTRAINT niete_lp_asset_sources_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.niete_lp_assets(id) ON DELETE CASCADE;


--
-- Name: niete_lp_downloads niete_lp_downloads_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_downloads
    ADD CONSTRAINT niete_lp_downloads_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.niete_lp_assets(id) ON DELETE SET NULL;


--
-- Name: niete_lp_downloads niete_lp_downloads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_downloads
    ADD CONSTRAINT niete_lp_downloads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: niete_lp_opens niete_lp_opens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.niete_lp_opens
    ADD CONSTRAINT niete_lp_opens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: nietemigrated_observation_answers nietemigrated_observation_answers_observation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_answers
    ADD CONSTRAINT nietemigrated_observation_answers_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.nietemigrated_observations(id);


--
-- Name: nietemigrated_observation_answers nietemigrated_observation_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_answers
    ADD CONSTRAINT nietemigrated_observation_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.nietemigrated_observation_questions(id);


--
-- Name: nietemigrated_observation_question_groups nietemigrated_observation_question_groups_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_question_groups
    ADD CONSTRAINT nietemigrated_observation_question_groups_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.nietemigrated_observation_sections(id);


--
-- Name: nietemigrated_observation_questions nietemigrated_observation_questions_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_questions
    ADD CONSTRAINT nietemigrated_observation_questions_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.nietemigrated_observation_question_groups(id);


--
-- Name: nietemigrated_observation_questions nietemigrated_observation_questions_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_questions
    ADD CONSTRAINT nietemigrated_observation_questions_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.nietemigrated_observation_sections(id);


--
-- Name: nietemigrated_observation_sections nietemigrated_observation_sections_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observation_sections
    ADD CONSTRAINT nietemigrated_observation_sections_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.nietemigrated_observation_templates(id);


--
-- Name: nietemigrated_observations nietemigrated_observations_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observations
    ADD CONSTRAINT nietemigrated_observations_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.nietemigrated_observation_templates(id);


--
-- Name: nietemigrated_observations nietemigrated_observations_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_observations
    ADD CONSTRAINT nietemigrated_observations_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.nietemigrated_teacher_visits(id);


--
-- Name: nietemigrated_question_options nietemigrated_question_options_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_question_options
    ADD CONSTRAINT nietemigrated_question_options_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.nietemigrated_observation_questions(id);


--
-- Name: nietemigrated_school_visits nietemigrated_school_visits_visit_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_school_visits
    ADD CONSTRAINT nietemigrated_school_visits_visit_plan_id_fkey FOREIGN KEY (visit_plan_id) REFERENCES public.nietemigrated_visit_plans(id);


--
-- Name: nietemigrated_teacher_visits nietemigrated_teacher_visits_school_visit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nietemigrated_teacher_visits
    ADD CONSTRAINT nietemigrated_teacher_visits_school_visit_id_fkey FOREIGN KEY (school_visit_id) REFERENCES public.nietemigrated_school_visits(id);


--
-- Name: observation_field_forms observation_field_forms_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_field_forms
    ADD CONSTRAINT observation_field_forms_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id) ON DELETE SET NULL;


--
-- Name: observation_field_forms observation_field_forms_observer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_field_forms
    ADD CONSTRAINT observation_field_forms_observer_user_id_fkey FOREIGN KEY (observer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: observation_field_forms observation_field_forms_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_field_forms
    ADD CONSTRAINT observation_field_forms_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: observation_schedules observation_schedules_leader_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_schedules
    ADD CONSTRAINT observation_schedules_leader_user_id_fkey FOREIGN KEY (leader_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: observation_schedules observation_schedules_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_schedules
    ADD CONSTRAINT observation_schedules_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: observation_schedules observation_schedules_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.observation_schedules
    ADD CONSTRAINT observation_schedules_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(id);


--
-- Name: pic_lp_sessions pic_lp_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pic_lp_sessions
    ADD CONSTRAINT pic_lp_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: portal_organizations portal_organizations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_organizations
    ADD CONSTRAINT portal_organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.dashboard_users(id);


--
-- Name: pre_generated_lps pre_generated_lps_textbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pre_generated_lps
    ADD CONSTRAINT pre_generated_lps_textbook_id_fkey FOREIGN KEY (textbook_id) REFERENCES public.textbooks(id) ON DELETE SET NULL;


--
-- Name: quiz_answers quiz_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.quiz_questions(id) ON DELETE CASCADE;


--
-- Name: quiz_answers quiz_answers_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.quiz_sessions(id) ON DELETE CASCADE;


--
-- Name: quiz_questions quiz_questions_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_questions
    ADD CONSTRAINT quiz_questions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;


--
-- Name: quiz_sessions quiz_sessions_invited_by_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_invited_by_student_id_fkey FOREIGN KEY (invited_by_student_id) REFERENCES public.students(id);


--
-- Name: quiz_sessions quiz_sessions_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;


--
-- Name: quiz_sessions quiz_sessions_share_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_share_code_id_fkey FOREIGN KEY (share_code_id) REFERENCES public.quiz_share_codes(id) ON DELETE SET NULL;


--
-- Name: quiz_sessions quiz_sessions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: quiz_sessions quiz_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_sessions
    ADD CONSTRAINT quiz_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: quiz_share_codes quiz_share_codes_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id);


--
-- Name: quiz_share_codes quiz_share_codes_invited_by_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_invited_by_student_id_fkey FOREIGN KEY (invited_by_student_id) REFERENCES public.students(id);


--
-- Name: quiz_share_codes quiz_share_codes_parent_share_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_parent_share_code_id_fkey FOREIGN KEY (parent_share_code_id) REFERENCES public.quiz_share_codes(id);


--
-- Name: quiz_share_codes quiz_share_codes_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE CASCADE;


--
-- Name: quiz_share_codes quiz_share_codes_teacher_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_teacher_user_id_fkey FOREIGN KEY (teacher_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: quiz_share_codes quiz_share_codes_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_share_codes
    ADD CONSTRAINT quiz_share_codes_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.student_videos(id) ON DELETE SET NULL;


--
-- Name: quizzes quizzes_coaching_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_coaching_session_id_fkey FOREIGN KEY (coaching_session_id) REFERENCES public.coaching_sessions(id) ON DELETE SET NULL;


--
-- Name: quizzes quizzes_lesson_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_lesson_plan_id_fkey FOREIGN KEY (lesson_plan_id) REFERENCES public.lesson_plans(id) ON DELETE SET NULL;


--
-- Name: quizzes quizzes_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.student_lists(id) ON DELETE SET NULL;


--
-- Name: quizzes quizzes_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: quizzes quizzes_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quizzes
    ADD CONSTRAINT quizzes_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.student_videos(id) ON DELETE CASCADE;


--
-- Name: reading_assessments reading_assessments_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_assessments
    ADD CONSTRAINT reading_assessments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id);


--
-- Name: reading_assessments reading_assessments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reading_assessments
    ADD CONSTRAINT reading_assessments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: schools schools_principal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_principal_user_id_fkey FOREIGN KEY (principal_user_id) REFERENCES public.users(id);


--
-- Name: student_lists student_lists_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;


--
-- Name: student_lists student_lists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_lists
    ADD CONSTRAINT student_lists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: student_video_feedback student_video_feedback_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_video_feedback
    ADD CONSTRAINT student_video_feedback_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.video_quiz_deliveries(id);


--
-- Name: student_video_feedback student_video_feedback_quiz_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_video_feedback
    ADD CONSTRAINT student_video_feedback_quiz_session_id_fkey FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(id);


--
-- Name: student_video_feedback student_video_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_video_feedback
    ADD CONSTRAINT student_video_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: student_video_feedback student_video_feedback_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_video_feedback
    ADD CONSTRAINT student_video_feedback_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.student_videos(id) ON DELETE SET NULL;


--
-- Name: student_videos student_videos_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_videos
    ADD CONSTRAINT student_videos_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.student_videos(id) ON DELETE SET NULL;


--
-- Name: students students_enrolled_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_enrolled_by_user_id_fkey FOREIGN KEY (enrolled_by_user_id) REFERENCES public.users(id);


--
-- Name: students students_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.student_lists(id);


--
-- Name: students students_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.students(id);


--
-- Name: students students_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: subjects subjects_parent_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subjects
    ADD CONSTRAINT subjects_parent_code_fkey FOREIGN KEY (parent_code) REFERENCES public.subjects(code);


--
-- Name: supervisor_remark_scores supervisor_remark_scores_remark_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remark_scores
    ADD CONSTRAINT supervisor_remark_scores_remark_id_fkey FOREIGN KEY (remark_id) REFERENCES public.supervisor_remarks(id) ON DELETE CASCADE;


--
-- Name: supervisor_remarks supervisor_remarks_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.evaluation_cycles(id);


--
-- Name: supervisor_remarks supervisor_remarks_principal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_principal_user_id_fkey FOREIGN KEY (principal_user_id) REFERENCES public.users(id);


--
-- Name: supervisor_remarks supervisor_remarks_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: supervisor_remarks supervisor_remarks_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_remarks
    ADD CONSTRAINT supervisor_remarks_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id);


--
-- Name: teacher_attendance_records teacher_attendance_records_marked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_attendance_records
    ADD CONSTRAINT teacher_attendance_records_marked_by_user_id_fkey FOREIGN KEY (marked_by_user_id) REFERENCES public.users(id);


--
-- Name: teacher_attendance_records teacher_attendance_records_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_attendance_records
    ADD CONSTRAINT teacher_attendance_records_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: teacher_attendance_records teacher_attendance_records_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_attendance_records
    ADD CONSTRAINT teacher_attendance_records_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.users(id);


--
-- Name: teacher_facts teacher_facts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_facts
    ADD CONSTRAINT teacher_facts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: teacher_nudges teacher_nudges_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_nudges
    ADD CONSTRAINT teacher_nudges_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quizzes(id) ON DELETE SET NULL;


--
-- Name: teacher_nudges teacher_nudges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_nudges
    ADD CONSTRAINT teacher_nudges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: teacher_progress teacher_progress_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_progress
    ADD CONSTRAINT teacher_progress_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.audio_sessions(id);


--
-- Name: teacher_progress teacher_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_progress
    ADD CONSTRAINT teacher_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: teacher_training_assignments teacher_training_assignments_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_assignments
    ADD CONSTRAINT teacher_training_assignments_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.training_programs(id);


--
-- Name: teacher_training_assignments teacher_training_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_assignments
    ADD CONSTRAINT teacher_training_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: teacher_training_progress teacher_training_progress_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_progress
    ADD CONSTRAINT teacher_training_progress_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id);


--
-- Name: teacher_training_progress teacher_training_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teacher_training_progress
    ADD CONSTRAINT teacher_training_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: textbook_pages textbook_pages_textbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbook_pages
    ADD CONSTRAINT textbook_pages_textbook_id_fkey FOREIGN KEY (textbook_id) REFERENCES public.textbooks(id) ON DELETE CASCADE;


--
-- Name: textbook_toc textbook_toc_textbook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.textbook_toc
    ADD CONSTRAINT textbook_toc_textbook_id_fkey FOREIGN KEY (textbook_id) REFERENCES public.textbooks(id) ON DELETE CASCADE;


--
-- Name: training_assessment_answers training_assessment_answers_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_answers
    ADD CONSTRAINT training_assessment_answers_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.training_assessment_attempts(id) ON DELETE CASCADE;


--
-- Name: training_assessment_answers training_assessment_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_answers
    ADD CONSTRAINT training_assessment_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.training_questions(id);


--
-- Name: training_assessment_attempts training_assessment_attempts_grand_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_grand_quiz_id_fkey FOREIGN KEY (grand_quiz_id) REFERENCES public.training_grand_quizzes(id);


--
-- Name: training_assessment_attempts training_assessment_attempts_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.training_levels(id);


--
-- Name: training_assessment_attempts training_assessment_attempts_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.training_programs(id);


--
-- Name: training_assessment_attempts training_assessment_attempts_training_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_training_module_id_fkey FOREIGN KEY (training_module_id) REFERENCES public.training_modules(id);


--
-- Name: training_assessment_attempts training_assessment_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assessment_attempts
    ADD CONSTRAINT training_assessment_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: training_certificates training_certificates_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.training_assessment_attempts(id);


--
-- Name: training_certificates training_certificates_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.training_levels(id);


--
-- Name: training_certificates training_certificates_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.training_programs(id);


--
-- Name: training_certificates training_certificates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: training_courses training_courses_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_courses
    ADD CONSTRAINT training_courses_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.training_levels(id);


--
-- Name: training_grand_quizzes training_grand_quizzes_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_grand_quizzes
    ADD CONSTRAINT training_grand_quizzes_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.training_levels(id);


--
-- Name: training_levels training_levels_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_levels
    ADD CONSTRAINT training_levels_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.training_vendors(id);


--
-- Name: training_modules training_modules_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_modules
    ADD CONSTRAINT training_modules_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.training_courses(id);


--
-- Name: training_program_scopes training_program_scopes_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_program_scopes
    ADD CONSTRAINT training_program_scopes_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.training_programs(id) ON DELETE CASCADE;


--
-- Name: training_program_scopes training_program_scopes_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_program_scopes
    ADD CONSTRAINT training_program_scopes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.training_vendors(id);


--
-- Name: training_questions training_questions_grand_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_questions
    ADD CONSTRAINT training_questions_grand_quiz_id_fkey FOREIGN KEY (grand_quiz_id) REFERENCES public.training_grand_quizzes(id);


--
-- Name: training_questions training_questions_training_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_questions
    ADD CONSTRAINT training_questions_training_module_id_fkey FOREIGN KEY (training_module_id) REFERENCES public.training_modules(id);


--
-- Name: user_feature_first_use user_feature_first_use_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_first_use
    ADD CONSTRAINT user_feature_first_use_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.users(id);


--
-- Name: users users_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: video_quiz_deliveries video_quiz_deliveries_quiz_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_quiz_deliveries
    ADD CONSTRAINT video_quiz_deliveries_quiz_session_id_fkey FOREIGN KEY (quiz_session_id) REFERENCES public.quiz_sessions(id);


--
-- Name: video_quiz_deliveries video_quiz_deliveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_quiz_deliveries
    ADD CONSTRAINT video_quiz_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: video_quiz_deliveries video_quiz_deliveries_video_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_quiz_deliveries
    ADD CONSTRAINT video_quiz_deliveries_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.student_videos(id);


--
-- Name: video_requests video_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_requests
    ADD CONSTRAINT video_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: video_tasks video_tasks_video_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_tasks
    ADD CONSTRAINT video_tasks_video_request_id_fkey FOREIGN KEY (video_request_id) REFERENCES public.video_requests(id);


--
-- Name: web_quiz_challenge_runs web_quiz_challenge_runs_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_quiz_challenge_runs
    ADD CONSTRAINT web_quiz_challenge_runs_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- Name: ab_test_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_test_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_test_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_test_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: ab_tests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_tests ENABLE ROW LEVEL SECURITY;

--
-- Name: academic_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.academic_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: ama_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ama_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: ama_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ama_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: ama_query_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ama_query_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: api_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: audio_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audio_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users authenticated_read_dashboard_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_dashboard_users ON public.dashboard_users FOR SELECT TO authenticated USING (true);


--
-- Name: broadcast_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: byof_approval_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.byof_approval_log ENABLE ROW LEVEL SECURITY;

--
-- Name: byof_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.byof_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: byof_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.byof_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: byof_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.byof_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_starts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_starts ENABLE ROW LEVEL SECURITY;

--
-- Name: child_test_blocks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.child_test_blocks ENABLE ROW LEVEL SECURITY;

--
-- Name: child_test_draws; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.child_test_draws ENABLE ROW LEVEL SECURITY;

--
-- Name: child_test_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.child_test_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: class_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: class_teacher_subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_teacher_subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: class_teachers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.class_teachers ENABLE ROW LEVEL SECURITY;

--
-- Name: classes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_processing_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_processing_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_quality_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_quality_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: cta_clicks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cta_clicks ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_cycles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evaluation_cycles ENABLE ROW LEVEL SECURITY;

--
-- Name: evaluation_cycles evaluation_cycles_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evaluation_cycles_read_all ON public.evaluation_cycles FOR SELECT USING (true);


--
-- Name: exam_check_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_check_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_grades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_grades ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: failed_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.failed_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_suggestions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: grade_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grade_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: grade_levels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grade_levels ENABLE ROW LEVEL SECURITY;

--
-- Name: image_analysis_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.image_analysis_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: lcpm_benchmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lcpm_benchmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: leader_roster_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leader_roster_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_plan_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_plan_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: lesson_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: migration_test; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.migration_test ENABLE ROW LEVEL SECURITY;

--
-- Name: niete_lp_opens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.niete_lp_opens ENABLE ROW LEVEL SECURITY;

--
-- Name: users portal_admin_users_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_admin_users_read ON public.users FOR SELECT TO portal_app_user USING (true);


--
-- Name: portal_organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users postgres_all_dashboard_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY postgres_all_dashboard_users ON public.dashboard_users TO postgres USING (true) WITH CHECK (true);


--
-- Name: qa_analyst_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qa_analyst_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: qa_bug_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qa_bug_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: qa_test_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qa_test_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: reading_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reading_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: release_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schema_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- Name: schools schools_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY schools_read_all ON public.schools FOR SELECT USING (true);


--
-- Name: ab_test_events service_role_ab_test_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ab_test_events ON public.ab_test_events USING ((auth.role() = 'service_role'::text));


--
-- Name: ab_test_variants service_role_ab_test_variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ab_test_variants ON public.ab_test_variants USING ((auth.role() = 'service_role'::text));


--
-- Name: ab_tests service_role_ab_tests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ab_tests ON public.ab_tests USING ((auth.role() = 'service_role'::text));


--
-- Name: academic_sessions service_role_academic_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_academic_sessions ON public.academic_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: access_scopes service_role_access_scopes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_access_scopes ON public.access_scopes USING ((auth.role() = 'service_role'::text));


--
-- Name: ama_conversations service_role_ama_conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ama_conversations ON public.ama_conversations USING ((auth.role() = 'service_role'::text));


--
-- Name: ama_messages service_role_ama_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ama_messages ON public.ama_messages USING ((auth.role() = 'service_role'::text));


--
-- Name: ama_query_audit service_role_ama_query_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_ama_query_audit ON public.ama_query_audit USING ((auth.role() = 'service_role'::text));


--
-- Name: api_usage_log service_role_api_usage_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_api_usage_log ON public.api_usage_log USING ((auth.role() = 'service_role'::text));


--
-- Name: attendance_records service_role_attendance_records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_attendance_records ON public.attendance_records USING ((auth.role() = 'service_role'::text));


--
-- Name: attendance_sessions service_role_attendance_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_attendance_sessions ON public.attendance_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: audio_sessions service_role_audio_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_audio_sessions ON public.audio_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: broadcast_logs service_role_broadcast_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_broadcast_logs ON public.broadcast_logs USING ((auth.role() = 'service_role'::text));


--
-- Name: broadcast_messages service_role_broadcast_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_broadcast_messages ON public.broadcast_messages USING ((auth.role() = 'service_role'::text));


--
-- Name: byof_approval_log service_role_byof_approval_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_byof_approval_log ON public.byof_approval_log USING ((auth.role() = 'service_role'::text));


--
-- Name: byof_messages service_role_byof_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_byof_messages ON public.byof_messages USING ((auth.role() = 'service_role'::text));


--
-- Name: byof_plans service_role_byof_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_byof_plans ON public.byof_plans USING ((auth.role() = 'service_role'::text));


--
-- Name: byof_sessions service_role_byof_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_byof_sessions ON public.byof_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: chat_sessions service_role_chat_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_chat_sessions ON public.chat_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: chat_starts service_role_chat_starts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_chat_starts ON public.chat_starts USING ((auth.role() = 'service_role'::text));


--
-- Name: class_enrollments service_role_class_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_class_enrollments ON public.class_enrollments USING ((auth.role() = 'service_role'::text));


--
-- Name: class_teacher_subjects service_role_class_teacher_subjects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_class_teacher_subjects ON public.class_teacher_subjects USING ((auth.role() = 'service_role'::text));


--
-- Name: class_teachers service_role_class_teachers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_class_teachers ON public.class_teachers USING ((auth.role() = 'service_role'::text));


--
-- Name: classes service_role_classes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_classes ON public.classes USING ((auth.role() = 'service_role'::text));


--
-- Name: coaching_jobs service_role_coaching_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_coaching_jobs ON public.coaching_jobs USING ((auth.role() = 'service_role'::text));


--
-- Name: coaching_quality_metrics service_role_coaching_metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_coaching_metrics ON public.coaching_quality_metrics USING ((auth.role() = 'service_role'::text));


--
-- Name: coaching_processing_queue service_role_coaching_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_coaching_queue ON public.coaching_processing_queue USING ((auth.role() = 'service_role'::text));


--
-- Name: coaching_sessions service_role_coaching_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_coaching_sessions ON public.coaching_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: conversations service_role_conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_conversations ON public.conversations USING ((auth.role() = 'service_role'::text));


--
-- Name: cta_clicks service_role_cta_clicks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_cta_clicks ON public.cta_clicks USING ((auth.role() = 'service_role'::text));


--
-- Name: dashboard_audit_log service_role_dashboard_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_dashboard_audit ON public.dashboard_audit_log USING ((auth.role() = 'service_role'::text));


--
-- Name: dashboard_users service_role_dashboard_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_dashboard_users ON public.dashboard_users USING ((auth.role() = 'service_role'::text));


--
-- Name: exam_grades service_role_exam_grades; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_exam_grades ON public.exam_grades USING ((auth.role() = 'service_role'::text));


--
-- Name: exam_check_sessions service_role_exam_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_exam_sessions ON public.exam_check_sessions USING ((auth.role() = 'service_role'::text));


--
-- Name: exam_submissions service_role_exam_submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_exam_submissions ON public.exam_submissions USING ((auth.role() = 'service_role'::text));


--
-- Name: exam_templates service_role_exam_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_exam_templates ON public.exam_templates USING ((auth.role() = 'service_role'::text));


--
-- Name: failed_operations service_role_failed_operations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_failed_operations ON public.failed_operations USING ((auth.role() = 'service_role'::text));


--
-- Name: user_feature_first_use service_role_feature_first_use; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_feature_first_use ON public.user_feature_first_use USING ((auth.role() = 'service_role'::text));


--
-- Name: feature_permissions service_role_feature_perms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_feature_perms ON public.feature_permissions USING ((auth.role() = 'service_role'::text));


--
-- Name: feature_suggestions service_role_feature_suggestions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_feature_suggestions ON public.feature_suggestions USING ((auth.role() = 'service_role'::text));


--
-- Name: grade_audit_log service_role_grade_audit_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_grade_audit_log ON public.grade_audit_log USING ((auth.role() = 'service_role'::text));


--
-- Name: grade_levels service_role_grade_levels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_grade_levels ON public.grade_levels USING ((auth.role() = 'service_role'::text));


--
-- Name: image_analysis_requests service_role_image_analysis; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_image_analysis ON public.image_analysis_requests USING ((auth.role() = 'service_role'::text));


--
-- Name: invitations service_role_invitations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_invitations ON public.invitations USING ((auth.role() = 'service_role'::text));


--
-- Name: lcpm_benchmarks service_role_lcpm_benchmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_lcpm_benchmarks ON public.lcpm_benchmarks USING ((auth.role() = 'service_role'::text));


--
-- Name: leader_roster_audit service_role_leader_roster_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_leader_roster_audit ON public.leader_roster_audit USING ((auth.role() = 'service_role'::text));


--
-- Name: lesson_plan_requests service_role_lesson_plan_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_lesson_plan_requests ON public.lesson_plan_requests USING ((auth.role() = 'service_role'::text));


--
-- Name: lesson_plans service_role_lesson_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_lesson_plans ON public.lesson_plans USING ((auth.role() = 'service_role'::text));


--
-- Name: migration_test service_role_migration_test; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_migration_test ON public.migration_test USING ((auth.role() = 'service_role'::text));


--
-- Name: portal_organizations service_role_portal_orgs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_portal_orgs ON public.portal_organizations USING ((auth.role() = 'service_role'::text));


--
-- Name: qa_analyst_proposals service_role_qa_analyst_proposals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_qa_analyst_proposals ON public.qa_analyst_proposals USING ((auth.role() = 'service_role'::text));


--
-- Name: qa_bug_patterns service_role_qa_bug_patterns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_qa_bug_patterns ON public.qa_bug_patterns USING ((auth.role() = 'service_role'::text));


--
-- Name: qa_test_runs service_role_qa_test_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_qa_test_runs ON public.qa_test_runs USING ((auth.role() = 'service_role'::text));


--
-- Name: reading_assessments service_role_reading_assessments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_reading_assessments ON public.reading_assessments USING ((auth.role() = 'service_role'::text));


--
-- Name: release_notes service_role_release_notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_release_notes ON public.release_notes USING ((auth.role() = 'service_role'::text));


--
-- Name: schema_versions service_role_schema_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_schema_versions ON public.schema_versions USING ((auth.role() = 'service_role'::text));


--
-- Name: student_lists service_role_student_lists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_student_lists ON public.student_lists USING ((auth.role() = 'service_role'::text));


--
-- Name: student_videos service_role_student_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_student_videos ON public.student_videos USING ((auth.role() = 'service_role'::text));


--
-- Name: students service_role_students; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_students ON public.students USING ((auth.role() = 'service_role'::text));


--
-- Name: subjects service_role_subjects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_subjects ON public.subjects USING ((auth.role() = 'service_role'::text));


--
-- Name: teacher_facts service_role_teacher_facts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_teacher_facts ON public.teacher_facts USING ((auth.role() = 'service_role'::text));


--
-- Name: teacher_progress service_role_teacher_progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_teacher_progress ON public.teacher_progress USING ((auth.role() = 'service_role'::text));


--
-- Name: users service_role_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_users ON public.users USING ((auth.role() = 'service_role'::text));


--
-- Name: video_requests service_role_video_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_video_requests ON public.video_requests USING ((auth.role() = 'service_role'::text));


--
-- Name: video_tasks service_role_video_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_video_tasks ON public.video_tasks USING ((auth.role() = 'service_role'::text));


--
-- Name: videos service_role_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_videos ON public.videos USING ((auth.role() = 'service_role'::text));


--
-- Name: wcpm_percentiles service_role_wcpm_percentiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_wcpm_percentiles ON public.wcpm_percentiles USING ((auth.role() = 'service_role'::text));


--
-- Name: website_visits service_role_website_visits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_website_visits ON public.website_visits USING ((auth.role() = 'service_role'::text));


--
-- Name: student_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: student_videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.student_videos ENABLE ROW LEVEL SECURITY;

--
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- Name: subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: supervisor_remark_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supervisor_remark_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: supervisor_remark_scores supervisor_remark_scores_read_principal; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supervisor_remark_scores_read_principal ON public.supervisor_remark_scores FOR SELECT USING ((remark_id IN ( SELECT supervisor_remarks.id
   FROM public.supervisor_remarks
  WHERE (supervisor_remarks.principal_user_id = auth.uid()))));


--
-- Name: supervisor_remarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supervisor_remarks ENABLE ROW LEVEL SECURITY;

--
-- Name: supervisor_remarks supervisor_remarks_read_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supervisor_remarks_read_scoped ON public.supervisor_remarks FOR SELECT USING (((principal_user_id = auth.uid()) OR (teacher_id = auth.uid())));


--
-- Name: teacher_attendance_records teacher_attendance_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY teacher_attendance_read_own ON public.teacher_attendance_records FOR SELECT USING (((teacher_id = auth.uid()) OR (school_id IN ( SELECT schools.id
   FROM public.schools
  WHERE (schools.principal_user_id = auth.uid())))));


--
-- Name: teacher_attendance_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_attendance_records ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_facts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_facts ENABLE ROW LEVEL SECURITY;

--
-- Name: teacher_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teacher_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: user_feature_first_use; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_feature_first_use ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: video_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.video_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: video_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.video_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

--
-- Name: wcpm_percentiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wcpm_percentiles ENABLE ROW LEVEL SECURITY;

--
-- Name: web_quiz_challenge_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.web_quiz_challenge_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: website_visits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.website_visits ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _bd_a21ks_probe(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._bd_a21ks_probe() TO service_role;


--
-- Name: FUNCTION acquire_assessment_lock(p_assessment_id uuid, p_expected_status character varying); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.acquire_assessment_lock(p_assessment_id uuid, p_expected_status character varying) TO service_role;


--
-- Name: FUNCTION acquire_broadcast_lock(p_broadcast_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.acquire_broadcast_lock(p_broadcast_id uuid) TO service_role;


--
-- Name: FUNCTION auto_title_conversation(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.auto_title_conversation() TO service_role;


--
-- Name: FUNCTION backfill_chat_sessions(p_session_timeout_minutes integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.backfill_chat_sessions(p_session_timeout_minutes integer) TO service_role;


--
-- Name: FUNCTION calculate_attendance_percentage(p_present_count integer, p_total_students integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calculate_attendance_percentage(p_present_count integer, p_total_students integer) TO service_role;


--
-- Name: FUNCTION calculate_retention(p_feature_type text, p_start_date date, p_end_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calculate_retention(p_feature_type text, p_start_date date, p_end_date date) TO service_role;


--
-- Name: FUNCTION calculate_wcpm(p_words_correct integer, p_time_seconds double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calculate_wcpm(p_words_correct integer, p_time_seconds double precision) TO service_role;


--
-- Name: FUNCTION check_benchmark_status(p_wcpm double precision, p_grade integer, p_language character varying, p_is_l2 boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_benchmark_status(p_wcpm double precision, p_grade integer, p_language character varying, p_is_l2 boolean) TO service_role;


--
-- Name: FUNCTION check_lcpm_benchmark_status(p_lcpm double precision, p_grade integer, p_language character varying); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_lcpm_benchmark_status(p_lcpm double precision, p_grade integer, p_language character varying) TO service_role;


--
-- Name: FUNCTION claim_next_coaching_job(p_worker_id text, p_max_attempts integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_next_coaching_job(p_worker_id text, p_max_attempts integer) TO service_role;


--
-- Name: FUNCTION cleanup_old_coaching_jobs(p_days_old integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_old_coaching_jobs(p_days_old integer) TO service_role;


--
-- Name: FUNCTION complete_coaching_job(p_job_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.complete_coaching_job(p_job_id uuid) TO service_role;


--
-- Name: FUNCTION exec_sql(query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.exec_sql(query text) TO service_role;


--
-- Name: FUNCTION fail_coaching_job(p_job_id uuid, p_error_message text, p_error_stack text, p_retry_delay_seconds integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fail_coaching_job(p_job_id uuid, p_error_message text, p_error_stack text, p_retry_delay_seconds integer) TO service_role;


--
-- Name: FUNCTION get_attendance_summary(p_list_id uuid, p_start_date date, p_end_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_attendance_summary(p_list_id uuid, p_start_date date, p_end_date date) TO service_role;


--
-- Name: FUNCTION get_broadcast_counts(p_broadcast_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_broadcast_counts(p_broadcast_id uuid) TO service_role;


--
-- Name: FUNCTION get_or_create_session(p_user_id uuid, p_session_timeout_minutes integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_or_create_session(p_user_id uuid, p_session_timeout_minutes integer) TO service_role;


--
-- Name: FUNCTION get_portal_users(p_portal_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_portal_users(p_portal_user_id uuid) TO service_role;


--
-- Name: FUNCTION get_users_with_last_activity(p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_users_with_last_activity(p_limit integer, p_offset integer) TO service_role;


--
-- Name: FUNCTION increment_broadcast_count(p_broadcast_id uuid, p_column_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_broadcast_count(p_broadcast_id uuid, p_column_name text) TO service_role;


--
-- Name: FUNCTION increment_quiz_completions(quiz_id_param uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_quiz_completions(quiz_id_param uuid) TO service_role;


--
-- Name: FUNCTION increment_replied_count(p_broadcast_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_replied_count(p_broadcast_id uuid) TO service_role;


--
-- Name: FUNCTION increment_turn_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_turn_count() TO service_role;


--
-- Name: FUNCTION increment_variant_impressions(p_test_id uuid, p_variant_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_variant_impressions(p_test_id uuid, p_variant_name text) TO service_role;


--
-- Name: FUNCTION is_invitation_valid(p_token character varying); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_invitation_valid(p_token character varying) TO service_role;


--
-- Name: FUNCTION log_broadcast_changes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_broadcast_changes() TO service_role;


--
-- Name: FUNCTION lp_latency_stats(p_source text, p_lookback_hours integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.lp_latency_stats(p_source text, p_lookback_hours integer) TO service_role;


--
-- Name: FUNCTION queue_coaching_job(p_session_id uuid, p_job_type text, p_payload jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.queue_coaching_job(p_session_id uuid, p_job_type text, p_payload jsonb) TO service_role;


--
-- Name: FUNCTION refresh_dashboard_views(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.refresh_dashboard_views() TO service_role;


--
-- Name: FUNCTION release_broadcast_lock(p_broadcast_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.release_broadcast_lock(p_broadcast_id uuid) TO service_role;


--
-- Name: FUNCTION roster_apply_edits(p_class_id uuid, p_run_id text, p_edited_by uuid, p_updates jsonb, p_moves jsonb, p_adds jsonb, p_removes jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_apply_edits(p_class_id uuid, p_run_id text, p_edited_by uuid, p_updates jsonb, p_moves jsonb, p_adds jsonb, p_removes jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_apply_edits(p_class_id uuid, p_run_id text, p_edited_by uuid, p_updates jsonb, p_moves jsonb, p_adds jsonb, p_removes jsonb) TO service_role;


--
-- Name: FUNCTION roster_change_class_details(p_class_id uuid, p_school_id uuid, p_grade_code text, p_section text, p_shift_code text, p_actor uuid, p_merge boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_change_class_details(p_class_id uuid, p_school_id uuid, p_grade_code text, p_section text, p_shift_code text, p_actor uuid, p_merge boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_change_class_details(p_class_id uuid, p_school_id uuid, p_grade_code text, p_section text, p_shift_code text, p_actor uuid, p_merge boolean) TO service_role;


--
-- Name: FUNCTION roster_class_timeline(p_class_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_class_timeline(p_class_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_class_timeline(p_class_id uuid) TO service_role;


--
-- Name: FUNCTION roster_hand_over_class(p_class_id uuid, p_school_id uuid, p_teacher_user_id uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_hand_over_class(p_class_id uuid, p_school_id uuid, p_teacher_user_id uuid, p_actor uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_hand_over_class(p_class_id uuid, p_school_id uuid, p_teacher_user_id uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb) TO service_role;


--
-- Name: FUNCTION roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb, p_school_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb, p_school_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.roster_import_students(p_class_id uuid, p_list_id uuid, p_run_id text, p_enrolled_by uuid, p_students jsonb, p_school_id uuid) TO service_role;


--
-- Name: FUNCTION set_portal_user_context(p_portal_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_portal_user_context(p_portal_user_id uuid) TO service_role;


--
-- Name: FUNCTION update_access_scopes_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_access_scopes_updated_at() TO service_role;


--
-- Name: FUNCTION update_assessment_status(p_assessment_id uuid, p_new_status character varying, p_error_message text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_assessment_status(p_assessment_id uuid, p_new_status character varying, p_error_message text) TO service_role;


--
-- Name: FUNCTION update_byof_session_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_byof_session_timestamp() TO service_role;


--
-- Name: FUNCTION update_conversation_on_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_conversation_on_message() TO service_role;


--
-- Name: FUNCTION update_exam_checker_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_exam_checker_updated_at() TO service_role;


--
-- Name: FUNCTION update_qa_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_qa_updated_at() TO service_role;


--
-- Name: FUNCTION update_session_message_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_session_message_count() TO service_role;


--
-- Name: FUNCTION update_student_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_student_count() TO service_role;


--
-- Name: FUNCTION update_student_videos_search_vector(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_student_videos_search_vector() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE _coltypes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public._coltypes TO service_role;


--
-- Name: TABLE ab_test_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ab_test_events TO service_role;
GRANT SELECT ON TABLE public.ab_test_events TO anon;
GRANT SELECT ON TABLE public.ab_test_events TO authenticated;


--
-- Name: TABLE ab_test_variants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ab_test_variants TO service_role;
GRANT SELECT ON TABLE public.ab_test_variants TO anon;
GRANT SELECT ON TABLE public.ab_test_variants TO authenticated;


--
-- Name: TABLE ab_tests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ab_tests TO service_role;
GRANT SELECT ON TABLE public.ab_tests TO anon;
GRANT SELECT ON TABLE public.ab_tests TO authenticated;


--
-- Name: TABLE academic_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.academic_sessions TO service_role;
GRANT SELECT ON TABLE public.academic_sessions TO anon;
GRANT SELECT ON TABLE public.academic_sessions TO authenticated;


--
-- Name: TABLE access_scopes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_scopes TO service_role;
GRANT SELECT ON TABLE public.access_scopes TO anon;
GRANT SELECT ON TABLE public.access_scopes TO authenticated;


--
-- Name: TABLE ama_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ama_conversations TO service_role;
GRANT SELECT ON TABLE public.ama_conversations TO anon;
GRANT SELECT ON TABLE public.ama_conversations TO authenticated;


--
-- Name: TABLE ama_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ama_messages TO service_role;
GRANT SELECT ON TABLE public.ama_messages TO anon;
GRANT SELECT ON TABLE public.ama_messages TO authenticated;


--
-- Name: TABLE ama_query_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ama_query_audit TO service_role;
GRANT SELECT ON TABLE public.ama_query_audit TO anon;
GRANT SELECT ON TABLE public.ama_query_audit TO authenticated;


--
-- Name: TABLE api_usage_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.api_usage_log TO service_role;
GRANT SELECT ON TABLE public.api_usage_log TO anon;
GRANT SELECT ON TABLE public.api_usage_log TO authenticated;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT ON TABLE public.app_settings TO anon;
GRANT SELECT ON TABLE public.app_settings TO authenticated;


--
-- Name: TABLE assessment_papers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.assessment_papers TO service_role;


--
-- Name: TABLE assessment_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.assessment_requests TO service_role;


--
-- Name: TABLE attendance_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance_records TO service_role;
GRANT SELECT ON TABLE public.attendance_records TO anon;
GRANT SELECT ON TABLE public.attendance_records TO authenticated;


--
-- Name: TABLE attendance_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance_sessions TO service_role;
GRANT SELECT ON TABLE public.attendance_sessions TO anon;
GRANT SELECT ON TABLE public.attendance_sessions TO authenticated;


--
-- Name: TABLE audio_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audio_sessions TO service_role;
GRANT SELECT ON TABLE public.audio_sessions TO anon;
GRANT SELECT ON TABLE public.audio_sessions TO authenticated;


--
-- Name: TABLE broadcast_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.broadcast_logs TO service_role;
GRANT SELECT ON TABLE public.broadcast_logs TO anon;
GRANT SELECT ON TABLE public.broadcast_logs TO authenticated;


--
-- Name: TABLE broadcast_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.broadcast_messages TO service_role;
GRANT SELECT ON TABLE public.broadcast_messages TO anon;
GRANT SELECT ON TABLE public.broadcast_messages TO authenticated;


--
-- Name: TABLE byof_approval_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.byof_approval_log TO service_role;
GRANT SELECT ON TABLE public.byof_approval_log TO anon;
GRANT SELECT ON TABLE public.byof_approval_log TO authenticated;


--
-- Name: TABLE byof_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.byof_messages TO service_role;
GRANT SELECT ON TABLE public.byof_messages TO anon;
GRANT SELECT ON TABLE public.byof_messages TO authenticated;


--
-- Name: TABLE byof_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.byof_plans TO service_role;
GRANT SELECT ON TABLE public.byof_plans TO anon;
GRANT SELECT ON TABLE public.byof_plans TO authenticated;


--
-- Name: TABLE byof_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.byof_sessions TO service_role;
GRANT SELECT ON TABLE public.byof_sessions TO anon;
GRANT SELECT ON TABLE public.byof_sessions TO authenticated;


--
-- Name: TABLE call_memory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.call_memory TO service_role;


--
-- Name: TABLE call_recall_docs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.call_recall_docs TO service_role;


--
-- Name: TABLE call_trace; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.call_trace TO service_role;


--
-- Name: SEQUENCE call_trace_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.call_trace_id_seq TO service_role;


--
-- Name: TABLE calls; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.calls TO service_role;


--
-- Name: TABLE chat_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_sessions TO service_role;
GRANT SELECT ON TABLE public.chat_sessions TO anon;
GRANT SELECT ON TABLE public.chat_sessions TO authenticated;


--
-- Name: TABLE chat_starts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_starts TO service_role;
GRANT SELECT ON TABLE public.chat_starts TO anon;
GRANT SELECT ON TABLE public.chat_starts TO authenticated;


--
-- Name: TABLE child_test_blocks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.child_test_blocks TO service_role;


--
-- Name: TABLE child_test_draws; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.child_test_draws TO service_role;


--
-- Name: TABLE child_test_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.child_test_sessions TO service_role;


--
-- Name: TABLE class_enrollments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.class_enrollments TO service_role;
GRANT SELECT ON TABLE public.class_enrollments TO anon;
GRANT SELECT ON TABLE public.class_enrollments TO authenticated;


--
-- Name: TABLE class_teacher_subjects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.class_teacher_subjects TO service_role;
GRANT SELECT ON TABLE public.class_teacher_subjects TO anon;
GRANT SELECT ON TABLE public.class_teacher_subjects TO authenticated;


--
-- Name: TABLE class_teachers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.class_teachers TO service_role;
GRANT SELECT ON TABLE public.class_teachers TO anon;
GRANT SELECT ON TABLE public.class_teachers TO authenticated;


--
-- Name: TABLE classes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.classes TO service_role;
GRANT SELECT ON TABLE public.classes TO anon;
GRANT SELECT ON TABLE public.classes TO authenticated;


--
-- Name: TABLE coach_directory; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coach_directory TO service_role;
GRANT SELECT ON TABLE public.coach_directory TO anon;
GRANT SELECT ON TABLE public.coach_directory TO authenticated;


--
-- Name: TABLE coaching_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coaching_jobs TO service_role;
GRANT SELECT ON TABLE public.coaching_jobs TO anon;
GRANT SELECT ON TABLE public.coaching_jobs TO authenticated;


--
-- Name: TABLE coaching_processing_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coaching_processing_queue TO service_role;
GRANT SELECT ON TABLE public.coaching_processing_queue TO anon;
GRANT SELECT ON TABLE public.coaching_processing_queue TO authenticated;


--
-- Name: TABLE coaching_quality_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coaching_quality_metrics TO service_role;
GRANT SELECT ON TABLE public.coaching_quality_metrics TO anon;
GRANT SELECT ON TABLE public.coaching_quality_metrics TO authenticated;


--
-- Name: TABLE coaching_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coaching_sessions TO service_role;
GRANT SELECT ON TABLE public.coaching_sessions TO anon;
GRANT SELECT ON TABLE public.coaching_sessions TO authenticated;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO service_role;
GRANT SELECT ON TABLE public.conversations TO anon;
GRANT SELECT ON TABLE public.conversations TO authenticated;


--
-- Name: TABLE cta_clicks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cta_clicks TO service_role;
GRANT SELECT ON TABLE public.cta_clicks TO anon;
GRANT SELECT ON TABLE public.cta_clicks TO authenticated;


--
-- Name: TABLE curriculum_lp_ast; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.curriculum_lp_ast TO service_role;
GRANT SELECT ON TABLE public.curriculum_lp_ast TO anon;
GRANT SELECT ON TABLE public.curriculum_lp_ast TO authenticated;


--
-- Name: TABLE dashboard_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_audit_log TO service_role;
GRANT SELECT ON TABLE public.dashboard_audit_log TO anon;
GRANT SELECT ON TABLE public.dashboard_audit_log TO authenticated;


--
-- Name: TABLE dashboard_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dashboard_users TO service_role;
GRANT SELECT ON TABLE public.dashboard_users TO anon;
GRANT SELECT ON TABLE public.dashboard_users TO authenticated;


--
-- Name: TABLE evaluation_cycles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evaluation_cycles TO service_role;
GRANT SELECT ON TABLE public.evaluation_cycles TO anon;
GRANT SELECT ON TABLE public.evaluation_cycles TO authenticated;


--
-- Name: TABLE exam_check_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_check_sessions TO service_role;
GRANT SELECT ON TABLE public.exam_check_sessions TO anon;
GRANT SELECT ON TABLE public.exam_check_sessions TO authenticated;


--
-- Name: TABLE exam_grades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_grades TO service_role;
GRANT SELECT ON TABLE public.exam_grades TO anon;
GRANT SELECT ON TABLE public.exam_grades TO authenticated;


--
-- Name: TABLE exam_question_bank; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_question_bank TO service_role;
GRANT SELECT ON TABLE public.exam_question_bank TO anon;
GRANT SELECT ON TABLE public.exam_question_bank TO authenticated;


--
-- Name: TABLE exam_question_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_question_groups TO service_role;
GRANT SELECT ON TABLE public.exam_question_groups TO anon;
GRANT SELECT ON TABLE public.exam_question_groups TO authenticated;


--
-- Name: TABLE exam_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_questions TO service_role;
GRANT SELECT ON TABLE public.exam_questions TO anon;
GRANT SELECT ON TABLE public.exam_questions TO authenticated;


--
-- Name: TABLE exam_submissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_submissions TO service_role;
GRANT SELECT ON TABLE public.exam_submissions TO anon;
GRANT SELECT ON TABLE public.exam_submissions TO authenticated;


--
-- Name: TABLE exam_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exam_templates TO service_role;
GRANT SELECT ON TABLE public.exam_templates TO anon;
GRANT SELECT ON TABLE public.exam_templates TO authenticated;


--
-- Name: TABLE exams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.exams TO service_role;
GRANT SELECT ON TABLE public.exams TO anon;
GRANT SELECT ON TABLE public.exams TO authenticated;


--
-- Name: TABLE failed_operations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.failed_operations TO service_role;
GRANT SELECT ON TABLE public.failed_operations TO anon;
GRANT SELECT ON TABLE public.failed_operations TO authenticated;


--
-- Name: TABLE feature_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feature_permissions TO service_role;
GRANT SELECT ON TABLE public.feature_permissions TO anon;
GRANT SELECT ON TABLE public.feature_permissions TO authenticated;


--
-- Name: TABLE feature_suggestions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feature_suggestions TO service_role;
GRANT SELECT ON TABLE public.feature_suggestions TO anon;
GRANT SELECT ON TABLE public.feature_suggestions TO authenticated;


--
-- Name: TABLE grade_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.grade_audit_log TO service_role;
GRANT SELECT ON TABLE public.grade_audit_log TO anon;
GRANT SELECT ON TABLE public.grade_audit_log TO authenticated;


--
-- Name: TABLE grade_levels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.grade_levels TO service_role;
GRANT SELECT ON TABLE public.grade_levels TO anon;
GRANT SELECT ON TABLE public.grade_levels TO authenticated;


--
-- Name: TABLE hcp_coaching_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hcp_coaching_actions TO service_role;
GRANT SELECT ON TABLE public.hcp_coaching_actions TO anon;
GRANT SELECT ON TABLE public.hcp_coaching_actions TO authenticated;


--
-- Name: SEQUENCE hcp_coaching_actions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.hcp_coaching_actions_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.hcp_coaching_actions_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.hcp_coaching_actions_id_seq TO authenticated;


--
-- Name: TABLE hcp_feedback_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hcp_feedback_deliveries TO service_role;
GRANT SELECT ON TABLE public.hcp_feedback_deliveries TO anon;
GRANT SELECT ON TABLE public.hcp_feedback_deliveries TO authenticated;


--
-- Name: TABLE hcp_visit_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hcp_visit_schedules TO service_role;
GRANT SELECT ON TABLE public.hcp_visit_schedules TO anon;
GRANT SELECT ON TABLE public.hcp_visit_schedules TO authenticated;


--
-- Name: TABLE homework_chapters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.homework_chapters TO service_role;
GRANT SELECT ON TABLE public.homework_chapters TO anon;
GRANT SELECT ON TABLE public.homework_chapters TO authenticated;


--
-- Name: TABLE image_analysis_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.image_analysis_requests TO service_role;
GRANT SELECT ON TABLE public.image_analysis_requests TO anon;
GRANT SELECT ON TABLE public.image_analysis_requests TO authenticated;


--
-- Name: TABLE invitations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invitations TO service_role;
GRANT SELECT ON TABLE public.invitations TO anon;
GRANT SELECT ON TABLE public.invitations TO authenticated;


--
-- Name: SEQUENCE lcpm_benchmarks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.lcpm_benchmarks_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.lcpm_benchmarks_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.lcpm_benchmarks_id_seq TO authenticated;


--
-- Name: TABLE lcpm_benchmarks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lcpm_benchmarks TO service_role;
GRANT SELECT ON TABLE public.lcpm_benchmarks TO anon;
GRANT SELECT ON TABLE public.lcpm_benchmarks TO authenticated;


--
-- Name: TABLE leader_roster_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leader_roster_audit TO service_role;


--
-- Name: TABLE leader_schools; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leader_schools TO service_role;
GRANT SELECT ON TABLE public.leader_schools TO anon;
GRANT SELECT ON TABLE public.leader_schools TO authenticated;


--
-- Name: TABLE leader_teachers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leader_teachers TO service_role;
GRANT SELECT ON TABLE public.leader_teachers TO anon;
GRANT SELECT ON TABLE public.leader_teachers TO authenticated;


--
-- Name: TABLE lesson_plan_catalog; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_plan_catalog TO service_role;
GRANT SELECT ON TABLE public.lesson_plan_catalog TO anon;
GRANT SELECT ON TABLE public.lesson_plan_catalog TO authenticated;


--
-- Name: SEQUENCE lesson_plan_catalog_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.lesson_plan_catalog_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.lesson_plan_catalog_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.lesson_plan_catalog_id_seq TO authenticated;


--
-- Name: TABLE lesson_plan_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_plan_requests TO service_role;
GRANT SELECT ON TABLE public.lesson_plan_requests TO anon;
GRANT SELECT ON TABLE public.lesson_plan_requests TO authenticated;


--
-- Name: TABLE lesson_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lesson_plans TO service_role;
GRANT SELECT ON TABLE public.lesson_plans TO anon;
GRANT SELECT ON TABLE public.lesson_plans TO authenticated;


--
-- Name: TABLE lp_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lp_feedback TO service_role;
GRANT SELECT ON TABLE public.lp_feedback TO anon;
GRANT SELECT ON TABLE public.lp_feedback TO authenticated;


--
-- Name: SEQUENCE migration_test_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.migration_test_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.migration_test_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.migration_test_id_seq TO authenticated;


--
-- Name: TABLE migration_test; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.migration_test TO service_role;
GRANT SELECT ON TABLE public.migration_test TO anon;
GRANT SELECT ON TABLE public.migration_test TO authenticated;


--
-- Name: TABLE reading_assessments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reading_assessments TO service_role;
GRANT SELECT ON TABLE public.reading_assessments TO anon;
GRANT SELECT ON TABLE public.reading_assessments TO authenticated;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO service_role;
GRANT SELECT ON TABLE public.users TO anon;
GRANT SELECT ON TABLE public.users TO authenticated;


--
-- Name: TABLE video_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.video_requests TO service_role;
GRANT SELECT ON TABLE public.video_requests TO anon;
GRANT SELECT ON TABLE public.video_requests TO authenticated;


--
-- Name: TABLE mv_dashboard_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mv_dashboard_stats TO service_role;
GRANT SELECT ON TABLE public.mv_dashboard_stats TO anon;
GRANT SELECT ON TABLE public.mv_dashboard_stats TO authenticated;


--
-- Name: TABLE mv_dashboard_stats_by_country; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mv_dashboard_stats_by_country TO service_role;
GRANT SELECT ON TABLE public.mv_dashboard_stats_by_country TO anon;
GRANT SELECT ON TABLE public.mv_dashboard_stats_by_country TO authenticated;


--
-- Name: TABLE mv_retention_cohorts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mv_retention_cohorts TO service_role;
GRANT SELECT ON TABLE public.mv_retention_cohorts TO anon;
GRANT SELECT ON TABLE public.mv_retention_cohorts TO authenticated;


--
-- Name: TABLE niete_lp612_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp612_deliveries TO service_role;


--
-- Name: TABLE niete_lp612_renders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp612_renders TO service_role;


--
-- Name: TABLE niete_lp612_segments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp612_segments TO service_role;


--
-- Name: TABLE niete_lp_ab_assignment; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_ab_assignment TO service_role;


--
-- Name: TABLE niete_lp_asset_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_asset_sources TO service_role;


--
-- Name: TABLE niete_lp_assets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_assets TO service_role;
GRANT SELECT ON TABLE public.niete_lp_assets TO anon;
GRANT SELECT ON TABLE public.niete_lp_assets TO authenticated;


--
-- Name: TABLE niete_lp_downloads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_downloads TO service_role;
GRANT SELECT ON TABLE public.niete_lp_downloads TO anon;
GRANT SELECT ON TABLE public.niete_lp_downloads TO authenticated;


--
-- Name: TABLE niete_lp_fidelity_moves; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_fidelity_moves TO service_role;
GRANT SELECT ON TABLE public.niete_lp_fidelity_moves TO anon;
GRANT SELECT ON TABLE public.niete_lp_fidelity_moves TO authenticated;


--
-- Name: TABLE niete_lp_opens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.niete_lp_opens TO service_role;


--
-- Name: TABLE nietemigrated_observation_answers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observation_answers TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observation_answers TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observation_answers TO authenticated;


--
-- Name: TABLE nietemigrated_observation_question_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observation_question_groups TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observation_question_groups TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observation_question_groups TO authenticated;


--
-- Name: TABLE nietemigrated_observation_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observation_questions TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observation_questions TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observation_questions TO authenticated;


--
-- Name: TABLE nietemigrated_observation_sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observation_sections TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observation_sections TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observation_sections TO authenticated;


--
-- Name: TABLE nietemigrated_observation_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observation_templates TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observation_templates TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observation_templates TO authenticated;


--
-- Name: TABLE nietemigrated_observations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_observations TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_observations TO anon;
GRANT SELECT ON TABLE public.nietemigrated_observations TO authenticated;


--
-- Name: TABLE nietemigrated_question_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_question_options TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_question_options TO anon;
GRANT SELECT ON TABLE public.nietemigrated_question_options TO authenticated;


--
-- Name: TABLE nietemigrated_school_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_school_visits TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_school_visits TO anon;
GRANT SELECT ON TABLE public.nietemigrated_school_visits TO authenticated;


--
-- Name: TABLE nietemigrated_teacher_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_teacher_visits TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_teacher_visits TO anon;
GRANT SELECT ON TABLE public.nietemigrated_teacher_visits TO authenticated;


--
-- Name: TABLE nietemigrated_visit_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.nietemigrated_visit_plans TO service_role;
GRANT SELECT ON TABLE public.nietemigrated_visit_plans TO anon;
GRANT SELECT ON TABLE public.nietemigrated_visit_plans TO authenticated;


--
-- Name: TABLE observation_field_forms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.observation_field_forms TO service_role;


--
-- Name: TABLE observation_schedules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.observation_schedules TO service_role;
GRANT SELECT ON TABLE public.observation_schedules TO anon;
GRANT SELECT ON TABLE public.observation_schedules TO authenticated;


--
-- Name: TABLE pic_lp_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pic_lp_sessions TO service_role;
GRANT SELECT ON TABLE public.pic_lp_sessions TO anon;
GRANT SELECT ON TABLE public.pic_lp_sessions TO authenticated;


--
-- Name: TABLE portal_organizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.portal_organizations TO service_role;
GRANT SELECT ON TABLE public.portal_organizations TO anon;
GRANT SELECT ON TABLE public.portal_organizations TO authenticated;


--
-- Name: TABLE pre_generated_lps; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pre_generated_lps TO service_role;
GRANT SELECT ON TABLE public.pre_generated_lps TO anon;
GRANT SELECT ON TABLE public.pre_generated_lps TO authenticated;


--
-- Name: TABLE qa_analyst_proposals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.qa_analyst_proposals TO service_role;
GRANT SELECT ON TABLE public.qa_analyst_proposals TO anon;
GRANT SELECT ON TABLE public.qa_analyst_proposals TO authenticated;


--
-- Name: TABLE qa_bug_patterns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.qa_bug_patterns TO service_role;
GRANT SELECT ON TABLE public.qa_bug_patterns TO anon;
GRANT SELECT ON TABLE public.qa_bug_patterns TO authenticated;


--
-- Name: SEQUENCE qa_test_runs_run_number_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.qa_test_runs_run_number_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.qa_test_runs_run_number_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.qa_test_runs_run_number_seq TO authenticated;


--
-- Name: TABLE qa_test_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.qa_test_runs TO service_role;
GRANT SELECT ON TABLE public.qa_test_runs TO anon;
GRANT SELECT ON TABLE public.qa_test_runs TO authenticated;


--
-- Name: TABLE quiz_answers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quiz_answers TO service_role;
GRANT SELECT ON TABLE public.quiz_answers TO anon;
GRANT SELECT ON TABLE public.quiz_answers TO authenticated;


--
-- Name: TABLE quiz_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quiz_questions TO service_role;
GRANT SELECT ON TABLE public.quiz_questions TO anon;
GRANT SELECT ON TABLE public.quiz_questions TO authenticated;


--
-- Name: TABLE quiz_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quiz_sessions TO service_role;
GRANT SELECT ON TABLE public.quiz_sessions TO anon;
GRANT SELECT ON TABLE public.quiz_sessions TO authenticated;


--
-- Name: TABLE quiz_share_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quiz_share_codes TO service_role;
GRANT SELECT ON TABLE public.quiz_share_codes TO anon;
GRANT SELECT ON TABLE public.quiz_share_codes TO authenticated;


--
-- Name: TABLE quizzes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.quizzes TO service_role;
GRANT SELECT ON TABLE public.quizzes TO anon;
GRANT SELECT ON TABLE public.quizzes TO authenticated;


--
-- Name: TABLE record_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.record_history TO service_role;


--
-- Name: SEQUENCE record_history_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.record_history_id_seq TO service_role;


--
-- Name: TABLE region_features; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.region_features TO service_role;
GRANT SELECT ON TABLE public.region_features TO anon;
GRANT SELECT ON TABLE public.region_features TO authenticated;


--
-- Name: TABLE release_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.release_notes TO service_role;
GRANT SELECT ON TABLE public.release_notes TO anon;
GRANT SELECT ON TABLE public.release_notes TO authenticated;


--
-- Name: TABLE schema_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.schema_versions TO service_role;
GRANT SELECT ON TABLE public.schema_versions TO anon;
GRANT SELECT ON TABLE public.schema_versions TO authenticated;


--
-- Name: TABLE schools; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.schools TO service_role;
GRANT SELECT ON TABLE public.schools TO anon;
GRANT SELECT ON TABLE public.schools TO authenticated;


--
-- Name: TABLE sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sections TO service_role;
GRANT SELECT ON TABLE public.sections TO anon;
GRANT SELECT ON TABLE public.sections TO authenticated;


--
-- Name: TABLE shifts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shifts TO service_role;
GRANT SELECT ON TABLE public.shifts TO anon;
GRANT SELECT ON TABLE public.shifts TO authenticated;


--
-- Name: SEQUENCE student_code_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.student_code_seq TO service_role;


--
-- Name: TABLE student_lists; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_lists TO service_role;
GRANT SELECT ON TABLE public.student_lists TO anon;
GRANT SELECT ON TABLE public.student_lists TO authenticated;


--
-- Name: TABLE student_video_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_video_feedback TO service_role;
GRANT SELECT ON TABLE public.student_video_feedback TO anon;
GRANT SELECT ON TABLE public.student_video_feedback TO authenticated;


--
-- Name: TABLE student_videos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.student_videos TO service_role;
GRANT SELECT ON TABLE public.student_videos TO anon;
GRANT SELECT ON TABLE public.student_videos TO authenticated;


--
-- Name: TABLE students; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.students TO service_role;
GRANT SELECT ON TABLE public.students TO anon;
GRANT SELECT ON TABLE public.students TO authenticated;


--
-- Name: TABLE subjects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subjects TO service_role;
GRANT SELECT ON TABLE public.subjects TO anon;
GRANT SELECT ON TABLE public.subjects TO authenticated;


--
-- Name: TABLE supervisor_remark_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.supervisor_remark_scores TO service_role;
GRANT SELECT ON TABLE public.supervisor_remark_scores TO anon;
GRANT SELECT ON TABLE public.supervisor_remark_scores TO authenticated;


--
-- Name: TABLE supervisor_remarks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.supervisor_remarks TO service_role;
GRANT SELECT ON TABLE public.supervisor_remarks TO anon;
GRANT SELECT ON TABLE public.supervisor_remarks TO authenticated;


--
-- Name: TABLE teacher_attendance_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_attendance_records TO service_role;
GRANT SELECT ON TABLE public.teacher_attendance_records TO anon;
GRANT SELECT ON TABLE public.teacher_attendance_records TO authenticated;


--
-- Name: TABLE teacher_facts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_facts TO service_role;
GRANT SELECT ON TABLE public.teacher_facts TO anon;
GRANT SELECT ON TABLE public.teacher_facts TO authenticated;


--
-- Name: TABLE teacher_nudges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_nudges TO service_role;


--
-- Name: TABLE teacher_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_progress TO service_role;
GRANT SELECT ON TABLE public.teacher_progress TO anon;
GRANT SELECT ON TABLE public.teacher_progress TO authenticated;


--
-- Name: TABLE teacher_training_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_training_assignments TO service_role;
GRANT SELECT ON TABLE public.teacher_training_assignments TO anon;
GRANT SELECT ON TABLE public.teacher_training_assignments TO authenticated;


--
-- Name: TABLE teacher_training_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teacher_training_progress TO service_role;
GRANT SELECT ON TABLE public.teacher_training_progress TO anon;
GRANT SELECT ON TABLE public.teacher_training_progress TO authenticated;


--
-- Name: TABLE textbook_pages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.textbook_pages TO service_role;
GRANT SELECT ON TABLE public.textbook_pages TO anon;
GRANT SELECT ON TABLE public.textbook_pages TO authenticated;


--
-- Name: TABLE textbook_toc; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.textbook_toc TO service_role;
GRANT SELECT ON TABLE public.textbook_toc TO anon;
GRANT SELECT ON TABLE public.textbook_toc TO authenticated;


--
-- Name: TABLE textbooks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.textbooks TO service_role;
GRANT SELECT ON TABLE public.textbooks TO anon;
GRANT SELECT ON TABLE public.textbooks TO authenticated;


--
-- Name: TABLE training_assessment_answers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_assessment_answers TO service_role;
GRANT SELECT ON TABLE public.training_assessment_answers TO anon;
GRANT SELECT ON TABLE public.training_assessment_answers TO authenticated;


--
-- Name: TABLE training_assessment_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_assessment_attempts TO service_role;
GRANT SELECT ON TABLE public.training_assessment_attempts TO anon;
GRANT SELECT ON TABLE public.training_assessment_attempts TO authenticated;


--
-- Name: TABLE training_certificates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_certificates TO service_role;
GRANT SELECT ON TABLE public.training_certificates TO anon;
GRANT SELECT ON TABLE public.training_certificates TO authenticated;


--
-- Name: TABLE training_content_change_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_content_change_events TO service_role;
GRANT SELECT ON TABLE public.training_content_change_events TO anon;
GRANT SELECT ON TABLE public.training_content_change_events TO authenticated;


--
-- Name: TABLE training_courses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_courses TO service_role;
GRANT SELECT ON TABLE public.training_courses TO anon;
GRANT SELECT ON TABLE public.training_courses TO authenticated;


--
-- Name: SEQUENCE training_courses_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.training_courses_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.training_courses_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.training_courses_id_seq TO authenticated;


--
-- Name: TABLE training_grand_quizzes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_grand_quizzes TO service_role;
GRANT SELECT ON TABLE public.training_grand_quizzes TO anon;
GRANT SELECT ON TABLE public.training_grand_quizzes TO authenticated;


--
-- Name: SEQUENCE training_grand_quizzes_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.training_grand_quizzes_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.training_grand_quizzes_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.training_grand_quizzes_id_seq TO authenticated;


--
-- Name: TABLE training_levels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_levels TO service_role;
GRANT SELECT ON TABLE public.training_levels TO anon;
GRANT SELECT ON TABLE public.training_levels TO authenticated;


--
-- Name: SEQUENCE training_levels_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.training_levels_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.training_levels_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.training_levels_id_seq TO authenticated;


--
-- Name: TABLE training_modules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_modules TO service_role;
GRANT SELECT ON TABLE public.training_modules TO anon;
GRANT SELECT ON TABLE public.training_modules TO authenticated;


--
-- Name: SEQUENCE training_modules_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.training_modules_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.training_modules_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.training_modules_id_seq TO authenticated;


--
-- Name: TABLE training_program_scopes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_program_scopes TO service_role;
GRANT SELECT ON TABLE public.training_program_scopes TO anon;
GRANT SELECT ON TABLE public.training_program_scopes TO authenticated;


--
-- Name: TABLE training_programs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_programs TO service_role;
GRANT SELECT ON TABLE public.training_programs TO anon;
GRANT SELECT ON TABLE public.training_programs TO authenticated;


--
-- Name: TABLE training_questions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_questions TO service_role;
GRANT SELECT ON TABLE public.training_questions TO anon;
GRANT SELECT ON TABLE public.training_questions TO authenticated;


--
-- Name: SEQUENCE training_questions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.training_questions_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.training_questions_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.training_questions_id_seq TO authenticated;


--
-- Name: TABLE training_vendors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_vendors TO service_role;
GRANT SELECT ON TABLE public.training_vendors TO anon;
GRANT SELECT ON TABLE public.training_vendors TO authenticated;


--
-- Name: TABLE user_feature_first_use; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_feature_first_use TO service_role;
GRANT SELECT ON TABLE public.user_feature_first_use TO anon;
GRANT SELECT ON TABLE public.user_feature_first_use TO authenticated;


--
-- Name: TABLE v_exam_bank_chapters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_exam_bank_chapters TO service_role;
GRANT SELECT ON TABLE public.v_exam_bank_chapters TO anon;
GRANT SELECT ON TABLE public.v_exam_bank_chapters TO authenticated;


--
-- Name: TABLE v_exam_bank_grades; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_exam_bank_grades TO service_role;
GRANT SELECT ON TABLE public.v_exam_bank_grades TO anon;
GRANT SELECT ON TABLE public.v_exam_bank_grades TO authenticated;


--
-- Name: TABLE v_exam_bank_subjects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_exam_bank_subjects TO service_role;
GRANT SELECT ON TABLE public.v_exam_bank_subjects TO anon;
GRANT SELECT ON TABLE public.v_exam_bank_subjects TO authenticated;


--
-- Name: TABLE v_supervisor_remark_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_supervisor_remark_scores TO service_role;
GRANT SELECT ON TABLE public.v_supervisor_remark_scores TO anon;
GRANT SELECT ON TABLE public.v_supervisor_remark_scores TO authenticated;


--
-- Name: TABLE video_quiz_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.video_quiz_deliveries TO service_role;
GRANT SELECT ON TABLE public.video_quiz_deliveries TO anon;
GRANT SELECT ON TABLE public.video_quiz_deliveries TO authenticated;


--
-- Name: TABLE video_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.video_tasks TO service_role;
GRANT SELECT ON TABLE public.video_tasks TO anon;
GRANT SELECT ON TABLE public.video_tasks TO authenticated;


--
-- Name: TABLE videos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.videos TO service_role;
GRANT SELECT ON TABLE public.videos TO anon;
GRANT SELECT ON TABLE public.videos TO authenticated;


--
-- Name: SEQUENCE wcpm_percentiles_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.wcpm_percentiles_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.wcpm_percentiles_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.wcpm_percentiles_id_seq TO authenticated;


--
-- Name: TABLE wcpm_percentiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wcpm_percentiles TO service_role;
GRANT SELECT ON TABLE public.wcpm_percentiles TO anon;
GRANT SELECT ON TABLE public.wcpm_percentiles TO authenticated;


--
-- Name: TABLE web_quiz_challenge_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.web_quiz_challenge_runs TO service_role;


--
-- Name: TABLE website_visits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.website_visits TO service_role;
GRANT SELECT ON TABLE public.website_visits TO anon;
GRANT SELECT ON TABLE public.website_visits TO authenticated;


--
-- Name: TABLE mv_users_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mv_users_activity TO service_role;
GRANT SELECT ON TABLE public.mv_users_activity TO anon;
GRANT SELECT ON TABLE public.mv_users_activity TO authenticated;


--
-- Name: TABLE mv_view_refresh_status; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mv_view_refresh_status TO service_role;
GRANT SELECT ON TABLE public.mv_view_refresh_status TO anon;
GRANT SELECT ON TABLE public.mv_view_refresh_status TO authenticated;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


