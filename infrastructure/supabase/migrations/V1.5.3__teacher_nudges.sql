-- V1.5.3 — teacher_nudges: one row per teacher, per calendar day, per kind of ask.
--
-- WHY A TABLE AT ALL. Two new asks reach a teacher on a schedule rather than in
-- reply to something the teacher just did: a coaching ask ten minutes after their first
-- lesson plan of the day, and a 15:00 PKT offer to make a quiz from the lessons
-- they planned. Both need the same four facts that no existing table holds
-- together: WHICH teacher, WHICH day, WHETHER it has been sent, and WHAT they
-- answered. Without a row, "have we already asked them today" is a guess, five
-- worker replicas ask five times, and a decline is invisible the next morning.
--
-- WHY NOT REUSE (checked against the live schema, 22 Sep, not from memory):
--   · user_feature_first_use  — has no date and no outcome: it can say a teacher
--     has seen a feature once, never that they were asked today and said no.
--   · lesson_plans.quiz_nudge_sent — per LESSON, not per teacher-day. A teacher
--     who planned four lessons has four flags and no answer to "were they asked".
--   · niete_lp_fidelity_moves — lags the served asset (3 of 1,211 rows on prod),
--     so scheduling off it silently skips teachers.
-- A new table is the last resort here, and it is the one that fits.
--
-- THE UNIQUE IS THE POINT. (user_id, nudge_date, kind) is not a tidiness
-- constraint, it is the concurrency control: cohort building at 15:00 runs on
-- every replica, and the second insert is meant to be a no-op (23505), not a
-- second message. The sending side is claimed separately, pending -> sending,
-- so two replicas sweeping the same second each own only the rows their own
-- UPDATE flipped.
--
-- STATUS VOCABULARY (six words, and the CHECK is the contract):
--   pending  scheduled, not yet due or not yet claimed
--   sending  claimed by one sweeper tick; nobody else may touch it
--   sent     the teacher has it
--   failed   the send threw, or the row was stuck in `sending` past the ceiling
--   skipped  deliberately not sent; `context.skip_reason` says which rule fired
--   expired  the ask aged out unanswered
-- `skipped` and `failed` are deliberately different words: one is the product
-- working (a cap, a quiet hour, a closed 24h window), the other is a defect.
-- Collapsing them would make the daily counts unreadable, which is exactly how
-- a silent fallback hides (root rule 24b).
--
-- KIND VOCABULARY: only the two kinds this build ships. A third kind is a
-- migration, on purpose — an unregistered kind must never be claimable.
--
-- LOAD (Class R). The sweeper reads `teacher_nudges` through the partial index
-- every TEACHER_NUDGES_SWEEP_MINUTES (default 5): one index scan over the
-- pending rows due now, capped at 200 per tick. Steady state on the ICT roster
-- is <= ~1,500 rows/day across both kinds, so the pending set is small and the
-- table grows ~550k rows/year at the outside. `teacher_nudges_user_recent`
-- serves the weekly-cap and declined-streak reads, which are per teacher and
-- newest-first.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS: the runner's ledger on sandbox
-- is behind the files (1.3.6 applied vs 1.5.1 on disk), so this file will be
-- read more than once across environments.

CREATE TABLE IF NOT EXISTS teacher_nudges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nudge_date    date NOT NULL,                       -- PKT calendar date
  kind          text NOT NULL CHECK (kind IN ('coaching_after_lp','lp_quiz_offer')),
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sending','sent','failed','skipped','expired')),
  scheduled_at  timestamptz NOT NULL,
  sent_at       timestamptz,
  answered_at   timestamptz,
  choice        text,                                -- 'yes' | 'no' | 'ignored' | 'class:<key>'
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- lessons, class groups, skip reason, message ids
  quiz_id       uuid REFERENCES quizzes(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_nudges_one_per_day UNIQUE (user_id, nudge_date, kind)
);

-- The sweeper's due-scan. PARTIAL on status = 'pending' because that is the only
-- state it ever selects, and the partial index stays small as sent rows pile up.
CREATE INDEX IF NOT EXISTS teacher_nudges_due ON teacher_nudges (scheduled_at) WHERE status = 'pending';

-- The per-teacher reads: this week's asks (the weekly cap), yesterday's answer
-- (the declined streak), today's row of the other kind (the "no offer on a day
-- they said yes" rule).
CREATE INDEX IF NOT EXISTS teacher_nudges_user_recent ON teacher_nudges (user_id, nudge_date DESC);

COMMENT ON TABLE teacher_nudges IS
  'One scheduled ask per teacher, per PKT calendar day, per kind. The UNIQUE (user_id, nudge_date, kind) makes cohort building idempotent across worker replicas; the pending -> sending claim makes sending single-flight.';
COMMENT ON COLUMN teacher_nudges.context IS
  'jsonb sidecar: the lessons the ask is about, the class groups offered, skip_reason when status = skipped, error when status = failed, and the WhatsApp message ids once sent. Merged, never replaced, by the services that write it.';
COMMENT ON COLUMN teacher_nudges.choice IS
  'What the teacher tapped: yes | no | ignored | class:<grade>_<subject>. A stable token, never the button title (button copy is translated and changes).';

-- down
--   DROP INDEX IF EXISTS teacher_nudges_user_recent;
--   DROP INDEX IF EXISTS teacher_nudges_due;
--   DROP TABLE IF EXISTS teacher_nudges;
