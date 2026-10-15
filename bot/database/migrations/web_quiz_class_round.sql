-- Migration: the once-a-term class round (web quiz), one row per drawn class per term, and the view the term's
-- statement reads.
--
-- NON-DESTRUCTIVE. One new table and one view; nothing existing changes. Written only by the bot (service role) and
-- only while app_settings web_quiz_class_round is on (with its parents web_quiz_challenge_v2 and web_quiz_challenge).
-- The table and view below are mirrored byte for byte in infrastructure/supabase/00_complete-schema.sql.
--
--   round         an opaque random id minted at the draw (16 hex), never derived from anything; it names the round
--                 in events, never the class
--   term_code     '2026-27a' (1 Apr–30 Sep) / '2026-27b' (1 Oct–31 Mar), PKT boundaries (the round runs once a TERM)
--   stratum       '<sector>|G23' or '<sector>|G45' (sector = schools.region, grade band from classes.grade_code)
--   N_h, n_h      the stratum's eligible classes and the classes drawn from it; p_incl = n_h / N_h
--   seed          the stored seed that reproduces the draw (always stored)
--   weights_version, plan_sha256   the signed analysis plan's weights version and the sha256 of that plan, written
--                 on every row of the term's draw before the draw is used (no default: the draw names its plan)
--   window_start/end        the round's window [start, end): no claim outside it; the round closes at its end
--   k_counted     counted positions (positions 1..k of the server-random order are mode class_round, later practice)
--   order_arm     round_first | week_first (randomised by class at the draw); week_start/end the class week's window,
--                 >= 21 days from the round's window on the ordered side; week_forwarded_at when the teacher forwarded it
--   accepted_at / declined_at   the teacher started the round / tapped "Not this term" (no replacement draw, ever)
--   roster_k      active enrolments at the draw
--   started_at    the teacher pressed Start (the server-random order is fixed then; positions never move)
--   ran_at        when the round ran (= started_at, written at the close)
--   finished_at   the round closed (the teacher's long-press with nobody left to call, or the window's end)
--   children_present / children_played   present (not marked absent) and done children, written at the close
--   counted_k     the counted positions: k_counted, or the roster at Start when smaller
--   present_counted_k   counted positions whose child was not marked absent
--   position_aggregates [{band, pos_bin, n, zero_k, rapid_k}] per position bin (1-5, 6-10, 11-20, 21-30, 31+): the
--                 children with an anchor-block run, of whom none right / flagged rapid. No child key, id or name.
--   state         the server's round state: the order of canonical student ids (server-random), each position's
--                 status todo|absent|declined|done, the open turn, paused, and the counts at the close. Never a name;
--                 nothing of it lives on the teacher's browser.
-- A class is drawn at most once a term and once an academic year (left(term_code, 7): '2027-28a' and '2027-28b').
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS class_round_draws (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round               text NOT NULL UNIQUE CHECK (round ~ '^[0-9a-f]{16}$'),
  term_code           text NOT NULL CHECK (term_code ~ '^\d{4}-\d{2}[ab]$'),
  class_id            uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  stratum             text NOT NULL,
  "N_h"               integer NOT NULL CHECK ("N_h" > 0),
  "n_h"               integer NOT NULL CHECK ("n_h" > 0 AND "n_h" <= "N_h"),
  p_incl              numeric NOT NULL CHECK (p_incl > 0 AND p_incl <= 1),
  seed                bigint NOT NULL,
  weights_version     text NOT NULL,
  plan_sha256         text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  window_start        timestamptz NOT NULL,
  window_end          timestamptz NOT NULL,
  k_counted           integer NOT NULL DEFAULT 10 CHECK (k_counted > 0),
  order_arm           text NOT NULL CHECK (order_arm IN ('round_first', 'week_first')),
  week_start          timestamptz,
  week_end            timestamptz,
  week_forwarded_at   timestamptz,
  roster_k            integer NOT NULL CHECK (roster_k >= 0),
  drawn_at            timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  declined_at         timestamptz,
  started_at          timestamptz,
  ran_at              timestamptz,
  finished_at         timestamptz,
  children_present    integer CHECK (children_present >= 0),
  children_played     integer CHECK (children_played >= 0),
  counted_k           integer CHECK (counted_k >= 0),
  present_counted_k   integer CHECK (present_counted_k >= 0),
  position_aggregates jsonb,
  state               jsonb,
  CONSTRAINT class_round_draws_once_a_term UNIQUE (term_code, class_id),
  CONSTRAINT class_round_draws_key UNIQUE (term_code, round, class_id),
  CONSTRAINT class_round_draws_window CHECK (window_start < window_end),
  CONSTRAINT class_round_draws_week CHECK ((week_start IS NULL) = (week_end IS NULL) AND (week_start IS NULL OR week_start < week_end))
);

CREATE UNIQUE INDEX IF NOT EXISTS class_round_draws_once_a_year
  ON public.class_round_draws (class_id, left(term_code, 7));
CREATE INDEX IF NOT EXISTS class_round_draws_open_idx
  ON public.class_round_draws (class_id, term_code) WHERE finished_at IS NULL AND declined_at IS NULL;

ALTER TABLE public.class_round_draws ENABLE ROW LEVEL SECURITY;

-- The term's lines read the draw through this view: one row per draw, in the shape the statement reads. Counts and
-- position-only aggregates; no child key, no name, no child's position. security_invoker: it reads the table with the
-- caller's rights, so the table's row level security (no policy: service role only) applies to it as well.
--   band        G23 | G45, from the stratum
--   state       not_yet | accepted (the teacher started the round) | declined ("Not this term")
--   closed      the round has closed (on the teacher's long-press or at the window's end)
--   present_k, absent_k, declined_k, done_k   from the close (or the round as it stands while it runs); NULL before Start
--   week_forwarded                             the class week's line was forwarded by the teacher
--   roster_k    the active roster at the draw (the statement's roster denominator)
CREATE OR REPLACE VIEW public.class_round_lines_v WITH (security_invoker = true) AS
SELECT d.round,
       d.term_code,
       d.class_id,
       c.school_id,
       substring(d.stratum FROM '(G23|G45)$') AS band,
       d.stratum,
       d.p_incl,
       d."N_h",
       d."n_h",
       d.weights_version,
       d.plan_sha256,
       d.order_arm,
       d.window_start,
       d.window_end,
       d.week_start,
       d.week_end,
       CASE WHEN d.declined_at IS NOT NULL THEN 'declined'
            WHEN d.accepted_at IS NOT NULL THEN 'accepted'
            ELSE 'not_yet' END AS state,
       (d.finished_at IS NOT NULL) AS closed,
       CASE WHEN d.state IS NULL THEN NULL
            ELSE COALESCE(d.children_present, (SELECT count(*) FROM jsonb_array_elements(d.state -> 'order') e WHERE e ->> 's' <> 'absent'))::integer END AS present_k,
       CASE WHEN d.state IS NULL THEN NULL
            ELSE COALESCE((d.state -> 'k' ->> 'absent')::integer, (SELECT count(*) FROM jsonb_array_elements(d.state -> 'order') e WHERE e ->> 's' = 'absent'))::integer END AS absent_k,
       CASE WHEN d.state IS NULL THEN NULL
            ELSE COALESCE((d.state -> 'k' ->> 'declined')::integer, (SELECT count(*) FROM jsonb_array_elements(d.state -> 'order') e WHERE e ->> 's' = 'declined'))::integer END AS declined_k,
       CASE WHEN d.state IS NULL THEN NULL
            ELSE COALESCE(d.children_played, (SELECT count(*) FROM jsonb_array_elements(d.state -> 'order') e WHERE e ->> 's' = 'done'))::integer END AS done_k,
       d.counted_k,
       d.present_counted_k,
       d.position_aggregates,
       (d.week_forwarded_at IS NOT NULL) AS week_forwarded,
       d.roster_k
  FROM public.class_round_draws d
  LEFT JOIN public.classes c ON c.id = d.class_id;

COMMENT ON TABLE public.class_round_draws IS
  'web quiz class round: one row per drawn class per term (sampler + the teacher''s locked round mode); written only by the bot (service role)';
