-- Migration: the Challenge content registry (passages, maths items, periods, equating links, draws).
--
-- NON-DESTRUCTIVE. Five new tables; nothing existing changes shape. Apply to sandbox first; staging and prod only
-- on a go. Seed after this file: web_quiz_challenge_registry_seed.sql. Rollback: web_quiz_challenge_registry_rollback.sql.
--
-- Text lives in the deployed bank files (bot/shared/data/child-test/item-bank.v4.json and passages/<passage_id>.json,
-- immutable per id); these rows are the registry: status ladder, release time, band, pool, readability, review,
-- n, adjustment and sign-off. A deploy adds text; a row change releases it. Nothing at runtime writes or reads these
-- tables yet: the draw that reads them comes later under web_quiz_challenge_pool (parent web_quiz_challenge_v2).
--
--   challenge_passages  one row per passage id (check or practice pool, disjoint forever)
--   challenge_items     one row per maths item id (anchor blocks, item sets, clones); params as shown + answer
--   challenge_periods   Pakistan calendar months: boundaries, anchor block version, weights and bank version
--   challenge_links     one row per calibration attempt against the band reference; live only once signed
--   challenge_draws     one row per draw, served or not (the draw audit); run_id references web_quiz_challenge_runs
--
-- One change from the design text: challenge_items_params_hash_idx is UNIQUE on (params_hash, form), not on
-- params_hash alone. Set A's first six "which is bigger" pairs are the same on the G3 and G5 forms (item-bank.v3.json),
-- so bigger.G3.A.01-06 and bigger.G5.A.01-06 carry the same params; a table-wide unique hash refuses the seed.
-- One parameter set still exists once per form; a clone generator must check params_hash across pools before writing.

CREATE TABLE IF NOT EXISTS public.challenge_passages (
  passage_id        text PRIMARY KEY,
  lang              text NOT NULL CHECK (lang IN ('en', 'ur')),
  kind              text NOT NULL CHECK (kind IN ('read', 'listen')),
  pool              text NOT NULL CHECK (pool IN ('check', 'practice')),
  band              smallint NOT NULL CHECK (band BETWEEN 1 AND 3),
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'reviewed', 'provisional', 'calibrated', 'retired')),
  is_reference      boolean NOT NULL DEFAULT false,
  released_at       timestamptz,
  withdrawn_at      timestamptz,
  withdraw_reason   text,
  tokens            smallint,
  sentences         smallint,
  mean_sent_len     numeric(4,1),
  max_word_len      smallint,
  readability       numeric(4,3) CHECK (readability BETWEEN 0 AND 1),
  readability_list  text,
  q_reach_1         smallint NOT NULL DEFAULT 0,
  q_reach_2         smallint NOT NULL DEFAULT 0,
  q_n               smallint NOT NULL DEFAULT 0,
  title_en          text,
  title_ur          text,
  source_ref        text,
  licence           text CHECK (licence IN ('textbook', 'cc_by', 'cc_by_sa', 'generated')),
  reviewer          text,
  reviewed_at       timestamptz,
  n_first_exposures integer NOT NULL DEFAULT 0,
  adjustment        numeric,
  se                numeric,
  method            text CHECK (method IN ('none', 'mean', 'ratio', 'linear')),
  signed_by         text,
  signed_at         timestamptz,
  twin_of           text REFERENCES public.challenge_passages(passage_id),
  text_hash         text,
  bank_version      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_passages_practice_status
    CHECK (pool = 'check' OR status IN ('draft', 'reviewed', 'retired')),
  CONSTRAINT challenge_passages_reviewed_has_reviewer
    CHECK (status = 'draft' OR (reviewer IS NOT NULL AND reviewed_at IS NOT NULL))
);

-- exactly one live reference per (lang, band, kind) in the check pool
CREATE UNIQUE INDEX IF NOT EXISTS challenge_passages_reference_idx
  ON public.challenge_passages (lang, band, kind)
  WHERE is_reference AND pool = 'check' AND status <> 'retired';

-- at most two provisional passages per (lang, band, kind): enforced by the service and checked here
CREATE INDEX IF NOT EXISTS challenge_passages_cell_idx
  ON public.challenge_passages (lang, band, kind, pool, status, released_at);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_passages_text_hash_idx
  ON public.challenge_passages (text_hash) WHERE text_hash IS NOT NULL;

ALTER TABLE public.challenge_passages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.challenge_passages IS
  'Challenge passage registry: band, pool, status ladder, release time, readability, review and calibration sign-off; text is in the bank file';


CREATE TABLE IF NOT EXISTS public.challenge_items (
  item_id           text PRIMARY KEY,
  task              text NOT NULL CHECK (task IN ('bigger', 'missing', 'number_id')),
  form              text NOT NULL CHECK (form IN ('G3', 'G5', 'G1', 'shared')),
  band              smallint CHECK (band BETWEEN 1 AND 3),
  pool              text NOT NULL CHECK (pool IN ('check', 'practice')),
  template_id       text,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  params_hash       text NOT NULL,
  anchor            boolean NOT NULL DEFAULT false,
  anchor_block      text CHECK (anchor_block IN ('A1', 'A2', 'G1A')),
  anchor_pos        smallint,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'reviewed', 'provisional', 'operational', 'retired')),
  difficulty        numeric,
  se                numeric,
  n                 integer NOT NULL DEFAULT 0,
  n_right           integer NOT NULL DEFAULT 0,
  n_wrong           integer NOT NULL DEFAULT 0,
  infit             numeric,
  outfit            numeric,
  dif_lang          numeric,
  signed_by         text,
  signed_at         timestamptz,
  retired_at        timestamptz,
  retire_reason     text,
  bank_version      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_items_anchor_shape
    CHECK (NOT anchor OR (anchor_block IS NOT NULL AND anchor_pos IS NOT NULL AND status = 'operational' AND pool = 'check'))
);

-- practice and check pools are disjoint: one parameter set exists once per form (see the header)
CREATE UNIQUE INDEX IF NOT EXISTS challenge_items_params_hash_idx
  ON public.challenge_items (params_hash, form);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_items_anchor_pos_idx
  ON public.challenge_items (anchor_block, anchor_pos) WHERE anchor;

ALTER TABLE public.challenge_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.challenge_items IS
  'Challenge maths item registry: task, form, band, pool, template and params, anchor block and position, Rasch estimates, status and sign-off';


CREATE TABLE IF NOT EXISTS public.challenge_periods (
  period_id             text PRIMARY KEY,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  anchor_block_version  text NOT NULL CHECK (anchor_block_version IN ('A1', 'A1+A2')),
  weights_v             text NOT NULL,
  bank_version          text NOT NULL,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT challenge_periods_order CHECK (ends_at > starts_at)
);

ALTER TABLE public.challenge_periods ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.challenge_periods IS
  'Challenge periods (Pakistan calendar months): boundaries, the anchor block version, draw weights version and bank version in force';


CREATE TABLE IF NOT EXISTS public.challenge_links (
  id                     uuid PRIMARY KEY,
  from_passage           text NOT NULL REFERENCES public.challenge_passages(passage_id),
  to_passage             text NOT NULL REFERENCES public.challenge_passages(passage_id),
  lang                   text NOT NULL CHECK (lang IN ('en', 'ur')),
  band                   smallint NOT NULL CHECK (band BETWEEN 1 AND 3),
  design                 text NOT NULL CHECK (design IN ('random_groups', 'common_child')),
  window_from            text NOT NULL REFERENCES public.challenge_periods(period_id),
  window_to              text NOT NULL REFERENCES public.challenge_periods(period_id),
  n_from                 integer NOT NULL,
  n_to                   integer NOT NULL,
  ref_eligible_only      boolean NOT NULL DEFAULT true,
  method                 text NOT NULL CHECK (method IN ('none', 'mean', 'ratio', 'linear')),
  gap_sd                 numeric,
  adjustment             numeric,
  se                     numeric,
  comp_adjustment        numeric,
  entry_vs_promoted_sd   numeric,
  computed_at            timestamptz NOT NULL DEFAULT now(),
  proposed_by            text NOT NULL,
  signed_by              text,
  signed_at              timestamptz,
  CONSTRAINT challenge_links_signed_is_ref_eligible CHECK (signed_at IS NULL OR ref_eligible_only)
);

CREATE INDEX IF NOT EXISTS challenge_links_from_idx
  ON public.challenge_links (from_passage, signed_at DESC);

ALTER TABLE public.challenge_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.challenge_links IS
  'Passage equating links to the band reference: design, window, n, method, adjustment and SE; a row is live only once signed';


CREATE TABLE IF NOT EXISTS public.challenge_draws (
  draw_id            uuid PRIMARY KEY,
  run_id             uuid REFERENCES public.web_quiz_challenge_runs(id) ON DELETE SET NULL,
  canonical_id       uuid NOT NULL,
  period_id          text NOT NULL REFERENCES public.challenge_periods(period_id),
  stop               text NOT NULL CHECK (stop IN ('read', 'listen', 'bigger', 'missing', 'numbers')),
  lang               text NOT NULL CHECK (lang IN ('en', 'ur')),
  fixed_grade_band   text NOT NULL CHECK (fixed_grade_band IN ('G1', 'G23', 'G45')),
  open_band          smallint CHECK (open_band BETWEEN 1 AND 3),
  band               smallint CHECK (band BETWEEN 1 AND 3),
  band_reason        text NOT NULL
                     CHECK (band_reason IN ('entry_grade', 'promoted', 'line1_drop', 'fallback_exhausted', 'floor', 'anchor', 'set')),
  eligible           jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligible_n         smallint NOT NULL DEFAULT 0,
  ref_eligible       boolean NOT NULL DEFAULT false,
  p                  numeric,
  weights_v          text NOT NULL,
  served_id          text,
  outcome            text NOT NULL CHECK (outcome IN ('served', 'lower_band', 'on_its_way')),
  seed               text,
  drawn_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS challenge_draws_cell_idx
  ON public.challenge_draws (lang, band, stop, period_id, drawn_at DESC);

CREATE INDEX IF NOT EXISTS challenge_draws_child_idx
  ON public.challenge_draws (canonical_id, period_id, stop);

ALTER TABLE public.challenge_draws ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.challenge_draws IS
  'One row per passage or item-set draw, served or not: eligible set with weights, probability, band reason and weights version (the draw audit)';
