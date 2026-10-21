-- V1.7.3 — assessment_downloads: one row each time a teacher takes a generator paper (or its answer
-- key) from the portal. bd-ivsjk8.1.
--
-- WHY. The "Did your class sit the paper?" A/B (bd-ivsjk8) asks the school day after a teacher gets
-- a paper, and needs to know she got it. Today a portal download leaves no trace: assessment_papers
-- says a paper was made, never that it was taken. A WhatsApp paper is sent by the bot and already
-- recorded there; this table is the portal half only.
-- WHY NOT REUSE. niete_lp_opens is read as "lesson plans used" (the Home's count, recent plans, the
-- lesson-plan survey) — a paper there would be counted as a lesson plan. assessment_papers is the
-- living document, edited in place; a download is an event, many per paper.
-- WHAT A ROW IS. One successful hand-over: the signed link was returned (via 'link') or the PDF
-- went out whole through the app's viewer (via 'viewer'). Not-hers, not-ready and refused-by-storage
-- write nothing.
-- DE-DUPLICATION. Same teacher + paper + artifact within 5 minutes is stored once (a conditional
-- INSERT in dashboard/services/assessment-downloads.service.js). Not a UNIQUE: a later download is
-- a new download.
-- ONE WRITER. The portal service. Readers: the paper-ask scheduler and the A/B daily query.
-- DATA. Ids, an artifact name and a timestamp. No phone, name or paper content. Classification:
-- internal. ON DELETE CASCADE with the teacher's account and with the paper.
-- LOAD. One indexed probe + one insert per download; ready teacher-paper days run at ~700 a week, ~150 of them portal (Sep–Oct 2026),
-- so < 100k rows/year.
-- SECURITY. RLS on, no policies: service role only, like every table the portal reaches.
-- IDEMPOTENT. IF NOT EXISTS throughout. Rollback: ROLLBACK_V1.7.3__assessment_downloads.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS assessment_downloads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id    uuid NOT NULL REFERENCES assessment_papers(id) ON DELETE CASCADE,
  artifact    text NOT NULL CHECK (artifact IN ('paper', 'answer_key')),
  via         text NOT NULL CHECK (via IN ('link', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The de-dupe probe and the scheduler's read: one teacher's downloads, newest first.
CREATE INDEX IF NOT EXISTS idx_assessment_downloads_user_recent
  ON assessment_downloads (user_id, created_at DESC);

ALTER TABLE assessment_downloads ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE assessment_downloads IS
  'Internal. One row per generator paper or answer key a teacher took from the portal (append-only; same teacher + paper + artifact within 5 minutes is stored once). Written by the portal service after the hand-over succeeded; read by the paper-ask nudge and the A/B daily query. Ids only. Owner: Digital Coach team.';
COMMENT ON COLUMN assessment_downloads.artifact IS
  'Internal. paper = the test paper; answer_key = its answer key.';
COMMENT ON COLUMN assessment_downloads.via IS
  'Internal. link = a presigned link handed to another app (/download); viewer = streamed to the app''s Paper ready viewer (/file).';

NOTIFY pgrst, 'reload schema';
