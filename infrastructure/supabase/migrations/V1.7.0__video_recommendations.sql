-- V1.7.0 — video_recommendations + video_reco_events: the training-video clip recommended after a NIETE
-- coaching report, and what the teacher did with it (bd-gzfdu9). Versioned migration.
-- Applied per environment, in order, from infrastructure/supabase/migrations. SANDBOX ONLY tonight.
--
-- WHAT. One row per coaching session (the A/B unit): which chapter of which training module was picked
-- for the report's one next step, why (a transcript moment + the model's reason, en + ur), the arm, and
-- how it was sent. Control-arm rows are written as status 'shadow' and never sent. One row per player /
-- delivery event in video_reco_events (click, play, t30, p50, p90, segment_end, ended, …).
--
-- WHY NEW TABLES (schema-first, root CLAUDE.md rule 15). analysis_data is rewritten whole in several places
-- (next-step-store.js) and the report without a recommendation must stay byte-identical, so nothing goes
-- there. ab_test_events is the bandit's per-variant log (FK to ab_tests, variant_name NOT NULL, a
-- phone_number column) and cta_clicks is the website funnel (no user_id, no tz): neither fits
-- (r-ab ab/EVENTS_SCHEMA.md §0). The catalogue itself is a versioned JSON data file in the repo, not rows.
--
-- DATA. Ids, catalogue keys, model output text (reason_en/ur, a short transcript quote with names replaced
-- by "[a student]"), timestamps. No names, no phone numbers.
-- LOAD. One row per analysed coaching report while VIDEO_RECO_ENABLED is on; a handful of events per row.
-- IDEMPOTENT. IF NOT EXISTS throughout. Rollback: ROLLBACK_V1.7.0__video_recommendations.sql
-- ORDER. Safe either side of the code: nothing reads or writes these tables while VIDEO_RECO_ENABLED is off.

CREATE TABLE IF NOT EXISTS video_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coaching_session_id UUID NOT NULL REFERENCES coaching_sessions (id),
  user_id             UUID NOT NULL REFERENCES users (id),
  status              TEXT NOT NULL CHECK (status IN ('shown', 'shadow', 'none', 'error')),
  arm                 TEXT NOT NULL CHECK (arm IN ('video', 'control')),
  module_id           INTEGER,
  seg_id              TEXT,
  start_s             NUMERIC,
  end_s               NUMERIC,
  indicator           TEXT,      -- the id AS STORED in this session's analysis (37-id on prod), r-ab outcome join key
  catalog_indicator   TEXT,      -- the v4 id after the crosswalk, used for retrieval
  indicator_scheme    TEXT,      -- fico_main_37 | fico_v4
  step_indicator      TEXT,
  differs_from_step   BOOLEAN NOT NULL DEFAULT false,
  repeat_module       BOOLEAN NOT NULL DEFAULT false,
  target_source       TEXT,      -- step | card | scorer | phase
  loop_angle          TEXT,      -- tell | cue | show | shrink | hand_over | NULL
  observation_type    TEXT,      -- self | leader_observation
  language            TEXT,
  teacher_level       INTEGER,
  reason_en           TEXT,
  reason_ur           TEXT,
  moment_at           TEXT,
  moment_quote        TEXT,
  confidence          NUMERIC,
  none_reason         TEXT,      -- hole | language | level | history | no_target | phase | top_rung | unknown_indicator | scheme_observe2 | llm_none | validation | error:<class>
  candidates          JSONB,     -- the shortlist as sent to the model: [{seg_id, score, indicator}]
  model               TEXT,
  catalog_version     TEXT,
  prompt_version      TEXT,
  usage               JSONB,
  experiment          TEXT,      -- the A/B salt id when VIDEO_RECO_AB_ENABLED, else NULL (r-ab PREREG §11)
  v10_group           TEXT,      -- snapshot of the teacher's v10 coaching-test group at write time: A|B|C|D|NULL
  engine_ms           INTEGER,   -- wall time of the engine (guardrail: report delay)
  sent_via            TEXT,      -- cta_header | cta | text | NULL (written by the sender after the send)
  wamid               TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coaching_session_id)
);

COMMENT ON TABLE video_recommendations IS
  'bd-gzfdu9: the training-video chapter recommended after one coaching report (one row per session; '
  'control arm = status shadow, never sent). Written by bot/shared/services/coaching/video-reco/store.js.';

CREATE INDEX IF NOT EXISTS idx_video_reco_user_created ON video_recommendations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_reco_wamid ON video_recommendations (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_reco_experiment ON video_recommendations (experiment, created_at) WHERE experiment IS NOT NULL;

CREATE TABLE IF NOT EXISTS video_reco_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES video_recommendations (id),
  event             TEXT NOT NULL CHECK (event IN ('delivered', 'read', 'send_failed', 'click', 'open', 'play', 't30',
                                                   'segment_start', 'p50', 'p90', 'segment_end', 'ended', 'error')),
  at_s              NUMERIC,
  ua_class          TEXT,      -- in_app | browser | crawler
  surface           TEXT CHECK (surface IN ('wa', 'cr', 'portal')),
  code              TEXT,      -- Meta error code on send_failed
  device            TEXT,      -- first 16 hex of sha256 of a random first-party cookie: forward count, never a phone
  client_ts         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE video_reco_events IS
  'bd-gzfdu9: delivery and player events for one video recommendation (first-only per event, surface and '
  'ua_class, except error). Written by the /v player routes and the status webhook.';

CREATE INDEX IF NOT EXISTS idx_video_reco_events_rec ON video_reco_events (recommendation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_reco_events_first
  ON video_reco_events (recommendation_id, event, COALESCE(surface, 'wa'), COALESCE(ua_class, '-')) WHERE event <> 'error';

NOTIFY pgrst, 'reload schema';
