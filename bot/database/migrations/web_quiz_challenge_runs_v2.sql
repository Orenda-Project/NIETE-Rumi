-- requires: web_quiz_challenge.sql
-- Migration: provenance columns on the web quiz Challenge runs, the two new run states, and two small tables
-- the weekly health numbers and the reading/numbers lamps write to.
--
-- NON-DESTRUCTIVE and re-runnable. Every new column is NULL by default and is written only by code behind the
-- web_quiz_challenge_v2 switch (the audio-consent trio behind web_quiz_challenge_audio_consent); no existing row
-- is rewritten. Base table: web_quiz_challenge.sql.
--
--   provenance   bank_version, "set", form, passage_id, item_set_id, band, anchor_block, draw_seed, scorer_v
--                — a bank or scorer change must never silently move a trend
--   the record   mode (check | practice | class_round), period_id (PKT month), exposure_no, anchor_exposure_no,
--                record (decided when the exercise is served, never inferred later)
--   who          canonical_id (after the fold; no FK so it survives a merge), id_src, id_confidence,
--                homonym_in_list, via, share_code_id, class_id, helped (self | helped | not_asked)
--   time         started_at
--   kept audio   audio_consent (kept_ok | kept_no | not_asked), audio_consent_at, audio_consent_by,
--                audio_keep_until (scored_at + 90 days, only when kept_ok) — the daily purge's key
--
-- status gains 'served' (a row inserted when an exercise is served, so the drop-out denominator exists) and
-- 'abandoned' (served, never played, closed after 24 h). Every reader written before this migration either
-- filters status = 'scored' / 'scoring' or excludes these two states in code.
-- The exercise CHECK is NOT changed. One env = one DB. Apply to sandbox first; staging and prod only on a go.

BEGIN;

ALTER TABLE public.web_quiz_challenge_runs
  ADD COLUMN IF NOT EXISTS bank_version       text,
  ADD COLUMN IF NOT EXISTS "set"              text,
  ADD COLUMN IF NOT EXISTS form               text,
  ADD COLUMN IF NOT EXISTS passage_id         text,
  ADD COLUMN IF NOT EXISTS item_set_id        text,
  ADD COLUMN IF NOT EXISTS mode               text,
  ADD COLUMN IF NOT EXISTS period_id          text,
  ADD COLUMN IF NOT EXISTS exposure_no        smallint,
  ADD COLUMN IF NOT EXISTS band               smallint,
  ADD COLUMN IF NOT EXISTS anchor_exposure_no smallint,
  ADD COLUMN IF NOT EXISTS anchor_block       text,
  ADD COLUMN IF NOT EXISTS homonym_in_list    boolean,
  ADD COLUMN IF NOT EXISTS draw_seed          text,
  ADD COLUMN IF NOT EXISTS canonical_id       uuid,
  ADD COLUMN IF NOT EXISTS id_src             text,
  ADD COLUMN IF NOT EXISTS id_confidence      text,
  ADD COLUMN IF NOT EXISTS via                text,
  ADD COLUMN IF NOT EXISTS share_code_id      uuid,
  ADD COLUMN IF NOT EXISTS class_id           uuid,
  ADD COLUMN IF NOT EXISTS helped             text,
  ADD COLUMN IF NOT EXISTS record             boolean,
  ADD COLUMN IF NOT EXISTS scorer_v           jsonb,
  ADD COLUMN IF NOT EXISTS started_at         timestamptz,
  ADD COLUMN IF NOT EXISTS audio_consent      text,
  ADD COLUMN IF NOT EXISTS audio_consent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS audio_consent_by   text,
  ADD COLUMN IF NOT EXISTS audio_keep_until   timestamptz;

-- Named CHECKs, added once. NULL passes every one, so rows written before this migration are untouched.
-- id_src and via are validated in code (a new source is not a migration).
DO $$
DECLARE c record; old_status text;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('wqcr_form_chk',          'form IN (''G1'',''G3'',''G5'')'),
    ('wqcr_mode_chk',          'mode IN (''check'',''practice'',''class_round'')'),
    ('wqcr_period_chk',        'period_id ~ ''^[0-9]{4}-(0[1-9]|1[0-2])$'''),
    ('wqcr_exposure_chk',      'exposure_no >= 1'),
    ('wqcr_band_chk',          'band BETWEEN 1 AND 3'),
    ('wqcr_anchor_exp_chk',    'anchor_exposure_no >= 1'),
    ('wqcr_anchor_block_chk',  'anchor_block IN (''A1'',''A2'',''G1A'')'),
    ('wqcr_id_conf_chk',       'id_confidence IN (''high'',''low'')'),
    ('wqcr_helped_chk',        'helped IN (''self'',''helped'',''not_asked'')'),
    ('wqcr_audio_consent_chk', 'audio_consent IN (''kept_ok'',''kept_no'',''not_asked'')'),
    ('wqcr_audio_by_chk',      'audio_consent_by IN (''grownup_tap'')'),
    ('wqcr_keep_needs_ok_chk', 'audio_keep_until IS NULL OR audio_consent = ''kept_ok'''),
    ('wqcr_status_v2_chk',     'status IN (''served'',''scoring'',''scored'',''failed'',''abandoned'')')
  ) AS t(name, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name AND conrelid = 'public.web_quiz_challenge_runs'::regclass) THEN
      EXECUTE format('ALTER TABLE public.web_quiz_challenge_runs ADD CONSTRAINT %I CHECK (%s)', c.name, c.expr);
    END IF;
  END LOOP;
  -- The original inline status CHECK has a generated name: found by its definition, then dropped, so the two new
  -- states can be written. wqcr_status_v2_chk above keeps every value it allowed.
  FOR old_status IN SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.web_quiz_challenge_runs'::regclass AND contype = 'c'
       AND conname <> 'wqcr_status_v2_chk'
       AND pg_get_constraintdef(oid) LIKE '%status%scoring%' AND pg_get_constraintdef(oid) NOT LIKE '%served%'
  LOOP
    EXECUTE format('ALTER TABLE public.web_quiz_challenge_runs DROP CONSTRAINT %I', old_status);
  END LOOP;
END $$;

-- the record rule's lookup, and the sweeper's
CREATE INDEX IF NOT EXISTS web_quiz_challenge_runs_record_idx
  ON public.web_quiz_challenge_runs (canonical_id, exercise, period_id) WHERE mode = 'check';
CREATE INDEX IF NOT EXISTS web_quiz_challenge_runs_sweep_idx
  ON public.web_quiz_challenge_runs (status, created_at) WHERE status IN ('served', 'scoring');

COMMENT ON COLUMN public.web_quiz_challenge_runs.mode IS
  'Internal. check | practice | class_round. Only check rows enter a trend; NULL on rows written before the provenance columns.';
COMMENT ON COLUMN public.web_quiz_challenge_runs.record IS
  'Internal. Decided when the exercise is served: this run is the period''s record if it scores. Never inferred later.';
COMMENT ON COLUMN public.web_quiz_challenge_runs.audio_keep_until IS
  'Internal. scored_at + 90 days, only when audio_consent = kept_ok; the daily purge deletes the kept reading after it.';

-- The weekly health numbers, kept so the trend outlives the event store's retention. One row per week × line × cell.
CREATE TABLE IF NOT EXISTS public.web_quiz_strip_weekly (
  week        text        NOT NULL,                -- ISO week in PKT, e.g. 2026-W46
  line        text        NOT NULL,
  cell        text        NOT NULL DEFAULT '',     -- e.g. G45|ur|read
  value       numeric,
  n           integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week, line, cell)
);
ALTER TABLE public.web_quiz_strip_weekly ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.web_quiz_strip_weekly IS
  'Internal. Weekly health numbers of the web quiz Challenge (counts and shares only, no child). Written by the bot (service role).';

-- A child's reading and numbers lamps. Append-only and up-only: a new row is written only above the child's last rung
-- on that ladder; computed from check rows only.
CREATE TABLE IF NOT EXISTS public.child_rungs (
  id           bigserial   PRIMARY KEY,
  canonical_id uuid        NOT NULL,
  ladder       text        NOT NULL CHECK (ladder IN ('reading', 'numbers')),
  rung         smallint    NOT NULL CHECK (rung BETWEEN 1 AND 5),
  rule_v       text        NOT NULL,
  period_id    text        NOT NULL CHECK (period_id ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  row_id       uuid,                                -- the run that set it
  set_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS child_rungs_child_idx ON public.child_rungs (canonical_id, ladder, set_at DESC);
ALTER TABLE public.child_rungs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.child_rungs IS
  'Internal. A child''s reading/numbers lamp, append-only and up-only, from check rows only. Written by the bot (service role).';

COMMIT;
