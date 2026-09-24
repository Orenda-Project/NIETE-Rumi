-- V1.5.5 — niete_lp612_deliveries: one row per Grades 6-12 lesson a teacher RECEIVED on WhatsApp.
--
-- WHY A TABLE AT ALL. /quiz lists a teacher's recent lessons so a quiz can be made from one on
-- request (operator, 24 Sep 2026: the quiz menu shows the lesson plans' quizzes, made only when the
-- teacher asks). For K-5 lesson plans that list is `niete_lp_downloads`. The 6-12 lane has no
-- per-teacher record of what was delivered:
--   · a lesson served from the render cache writes nothing about the teacher to the database —
--     only the Redis LP shelf (24 h, cap 5, flushed on every quiz/coaching/video start) and a log
--     line. On production, 10–24 Sep 2026, 1,439 of 3,392 serves were cache hits, and the share
--     grows as the cache fills;
--   · `niete_lp612_renders.requested_by` names only the FIRST requester of a render (and a retry
--     overwrites it); `waiters` is emptied by lp612_claim_waiters the moment the render is done;
--   · `lp_feedback.lp612_segment_id` exists only when the teacher tapped the survey.
--
-- WHY NOT REUSE (checked against the live schema, 24 Sep, not from memory):
--   · niete_lp_downloads — the K-5 delivery ledger. Six consumers read it as K-5 lessons
--     (lp-context, call-tools, the transcript digest's LP hint, coaching analysis, the coaching LP
--     picker, the 15:00 lp_v8 quiz cohort); a 6-12 row there would be read as a K-5 lesson by each.
--   · niete_lp612_renders — one row per (segment, lang, template_version), shared by every teacher
--     who got it; an array of recipients on that hot row would be contention and unbounded growth.
-- A new table is the last resort here, and it is the one that fits.
--
-- ONE WRITER: lp612-serving.deliverRender, AFTER the document send succeeded (soft-fail) — the
-- one function both the cache-hit path and the worker's waiter loop call. READER: the lp612 /quiz
-- lesson provider (newest deliveries of one teacher).
--
-- APPEND-ONLY. A teacher who re-taps a lesson gets it again and that is a delivery too; the reader
-- keeps the newest row per (segment, lang). No UNIQUE.
--
-- DATA. Ids and the lesson's version triple only — no phone, no name, no message text.
--
-- LOAD (Class R). ~230 WhatsApp 6-12 deliveries per school day on production (Axiom, Sep 2026):
-- ~60k rows/year. The one read is per teacher, newest first, via idx_lp612_deliveries_user_recent.
--
-- BACKFILL. The one durable per-teacher fact that predates this table — the first requester of
-- every READY render — is copied in once, as surface 'backfill', so /quiz is not empty for every
-- teacher on the day this ships. Idempotent (NOT EXISTS), so re-running the file adds nothing.
--
-- IDEMPOTENT. Every statement is IF NOT EXISTS / NOT EXISTS. Reverse: ROLLBACK_V1.5.5__lp612_deliveries.sql.

CREATE TABLE IF NOT EXISTS niete_lp612_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the record of what she received outlives the render row.
  render_id         uuid REFERENCES niete_lp612_renders(id) ON DELETE SET NULL,
  segment_id        text NOT NULL REFERENCES niete_lp612_segments(segment_id),
  -- The DOCUMENT's language — with template_version, the exact lp_doc a quiz is written from:
  -- R2 lp612/{template_version}/{lang}/{segment_id}.lp.json.
  lang              text NOT NULL CHECK (lang IN ('en', 'ur')),
  template_version  text NOT NULL,
  surface           text NOT NULL DEFAULT 'whatsapp' CHECK (surface IN ('whatsapp', 'portal', 'backfill')),
  delivered_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The one read: a teacher's deliveries, newest first (the /quiz list).
CREATE INDEX IF NOT EXISTS idx_lp612_deliveries_user_recent
  ON niete_lp612_deliveries (user_id, delivered_at DESC);

COMMENT ON TABLE niete_lp612_deliveries IS
  'One row per Grades 6-12 lesson a teacher received (append-only; written by lp612-serving.deliverRender after a confirmed send). Read by the lp612 /quiz lesson provider. Ids and the version triple only — no phone, name or message text.';
COMMENT ON COLUMN niete_lp612_deliveries.lang IS
  'The language of the delivered DOCUMENT (with template_version, names the exact stored lp_doc a quiz is written from).';
COMMENT ON COLUMN niete_lp612_deliveries.surface IS
  'whatsapp — sent by the bot; portal — downloaded in the portal (reserved, not written yet); backfill — a render''s first requester copied in by this migration.';

INSERT INTO niete_lp612_deliveries (user_id, render_id, segment_id, lang, template_version, surface, delivered_at)
SELECT r.requested_by, r.id, r.segment_id, r.lang, r.template_version, 'backfill',
       COALESCE(r.completed_at, r.updated_at, r.created_at)
  FROM niete_lp612_renders r
 WHERE r.status = 'ready'
   AND r.requested_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM users u WHERE u.id = r.requested_by)
   AND NOT EXISTS (
     SELECT 1 FROM niete_lp612_deliveries d
      WHERE d.render_id = r.id AND d.user_id = r.requested_by AND d.surface = 'backfill'
   );

NOTIFY pgrst, 'reload schema';
