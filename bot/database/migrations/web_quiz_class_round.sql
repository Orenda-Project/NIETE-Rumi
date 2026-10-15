-- Migration: the once-a-term class round (web quiz), one row per drawn class per term.
--
-- NON-DESTRUCTIVE. One new table; nothing existing changes. Written only by the bot (service role) and only while
-- app_settings web_quiz_class_round is on (with its parents web_quiz_challenge_v2 and web_quiz_challenge).
--
--   round         an opaque random id minted at the draw (16 hex), never derived from anything; it names the round
--                 in events, never the class
--   term_code     '2026-27a' (1 Apr–30 Sep) / '2026-27b' (1 Oct–31 Mar), PKT boundaries (the spec's `quarter`,
--                 renamed: the round runs once a TERM)
--   stratum       '<sector>|G23' or '<sector>|G45' (sector = schools.region, grade band from classes.grade_code)
--   N_h, n_h      the stratum's eligible classes and the classes drawn from it; p_incl = n_h / N_h
--   seed, weights_version   the stored seed that reproduces the draw, and the weights' version
--   window_start/end        the round's window [start, end): no claim outside it; the round closes at its end
--   k_counted     counted positions (positions 1..k of the server-random order are mode class_round, later practice)
--   order_arm     round_first | week_first (randomised by class at the draw); week_start/end the class week's window,
--                 >= 21 days from the round's window on the ordered side
--   accepted_at / declined_at   the teacher started the round / tapped "Not this term" (no replacement draw, ever)
--   roster_k      active enrolments at the draw
--   started_at    the teacher pressed Start (the server-random order is fixed then)
--   ran_at        when the round ran (= started_at, written at the close)
--   finished_at   the round closed (every position done or absent)
--   state         the server's round state: the order of canonical student ids (server-random), each position's
--                 status todo|absent|declined|done, the open turn, paused. Never a name; nothing of it lives on the teacher's browser.
-- A class is drawn at most once a term: UNIQUE (term_code, class_id).
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.class_round_draws (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round             text NOT NULL UNIQUE CHECK (round ~ '^[0-9a-f]{16}$'),
  term_code         text NOT NULL CHECK (term_code ~ '^\d{4}-\d{2}[ab]$'),
  class_id          uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  stratum           text NOT NULL,
  "N_h"             integer NOT NULL CHECK ("N_h" > 0),
  "n_h"             integer NOT NULL CHECK ("n_h" > 0 AND "n_h" <= "N_h"),
  p_incl            numeric NOT NULL CHECK (p_incl > 0 AND p_incl <= 1),
  seed              bigint,
  weights_version   text NOT NULL DEFAULT 'v1',
  window_start      timestamptz NOT NULL,
  window_end        timestamptz NOT NULL,
  k_counted         integer NOT NULL DEFAULT 10 CHECK (k_counted > 0),
  order_arm         text NOT NULL CHECK (order_arm IN ('round_first', 'week_first')),
  week_start        timestamptz,
  week_end          timestamptz,
  roster_k          integer NOT NULL CHECK (roster_k >= 0),
  drawn_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  declined_at       timestamptz,
  started_at        timestamptz,
  ran_at            timestamptz,
  finished_at       timestamptz,
  children_present  integer CHECK (children_present >= 0),
  children_played   integer CHECK (children_played >= 0),
  state             jsonb,
  CONSTRAINT class_round_draws_once_a_term UNIQUE (term_code, class_id),
  CONSTRAINT class_round_draws_key UNIQUE (term_code, round, class_id),
  CONSTRAINT class_round_draws_window CHECK (window_start < window_end),
  CONSTRAINT class_round_draws_week CHECK ((week_start IS NULL) = (week_end IS NULL) AND (week_start IS NULL OR week_start < week_end))
);

CREATE INDEX IF NOT EXISTS class_round_draws_open_idx
  ON public.class_round_draws (class_id, term_code) WHERE finished_at IS NULL AND declined_at IS NULL;

ALTER TABLE public.class_round_draws ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.class_round_draws IS
  'web quiz class round: one row per drawn class per term (sampler + the teacher''s locked round mode); written only by the bot (service role)';
