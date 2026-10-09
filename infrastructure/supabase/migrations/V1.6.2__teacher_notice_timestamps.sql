-- V1.6.2 — teacher app v2 "ready" notices: two nullable timestamps on the two per-teacher item rows. No new table.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
--
-- WHY. The teacher app follows a paper or a grades 6-12 lesson plan she asked for (a strip of "Being made", a
-- 10-second ready banner, "Ready for you" on Home). Whether she SAW the banner and whether she OPENED the item
-- is known only to the app, and nothing records it, so a refresh or a second phone loses it and Home cannot
-- tell a finished item from one she has already used.
--
-- WHY NOT NEW STORAGE (checked against the LIVE schema of sandbox olvritwoqujtjvwfulbh on 9 Oct 2026, not from
-- memory; the sandbox ledger is at 1.6.1):
--   * an item IS a row that already exists per teacher. A paper = assessment_requests (one per request, user_id,
--     surface 'portal'); its state is its latest assessment_papers attempt. A grades 6-12 plan she waited for =
--     her 'portal' row(s) in niete_lp612_deliveries (one per teacher per render; the bot's per-teacher claim,
--     bd-5rz1v.21). Not niete_lp612_renders: a render is SHARED by every teacher waiting on that lesson.
--   * "opened" for a lesson plan is ALSO already recorded, as a niete_lp_opens row; the read counts that too, so
--     the column below is only what the app reports for a plan opened from the banner or Home. Papers have no
--     open record anywhere, so this is the first.
--   * app_settings / feature_suggestions / cta_clicks / users.source hold flags, funnels and attribution — not a
--     per-item, per-teacher fact.
--   * a computed answer cannot hold these: they are events that happened in her app.
--
-- WHAT THE COLUMNS MEAN (identical on both tables; NULL = it has not happened):
--   notice_seen_at    she CLOSED the ready banner with its X, or went to Home from it (closing counts as seen:
--                     operator, 9 Oct 2026). A banner that ran its 10 seconds untouched is NOT seen — nothing is
--                     written — so the WhatsApp fallback (a later change, switched off) may still follow.
--   notice_opened_at  she opened the item (the banner's Open, a Home or list row, its own page) — or, for a
--                     FAILED paper, tapped its row. Opened also means seen; the writer sets both.
-- Each is written once (UPDATE … SET col = COALESCE(col, now())), never rewritten.
--
-- READERS / WRITERS. dashboard/services/teacher-notices.service.js: the only writer (the portal, on behalf of
-- the signed-in teacher, by her own id) and the reader behind GET /api/portal/me/notices. The WhatsApp fallback
-- (a later change, switched off) reads the same two columns to decide whether to send anything.
--
-- DATA. Timestamps only; no phone, name or message text. Classification: internal. The rows already cascade with
-- the teacher's account (assessment_requests.user_id and niete_lp612_deliveries.user_id are FKs to users).
-- LOAD (Class R). Nullable columns with no default and no index: a metadata-only ALTER in Postgres 11+, no table
-- rewrite. Every read is the existing per-teacher path (assessment_requests by user_id, deliveries by user_id).
-- SECURITY. RLS is already on both tables, service role only; nothing changes.
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS. Rollback: ROLLBACK_V1.6.2__teacher_notice_timestamps.sql
-- ORDER. Apply BEFORE the code that selects them (PostgREST/SQL reject an unknown column). Additive and nullable:
-- the code before it is unaffected.
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

ALTER TABLE assessment_requests
  ADD COLUMN IF NOT EXISTS notice_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS notice_opened_at timestamptz;

ALTER TABLE niete_lp612_deliveries
  ADD COLUMN IF NOT EXISTS notice_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS notice_opened_at timestamptz;

COMMENT ON COLUMN assessment_requests.notice_seen_at IS
  'Internal. When the teacher closed the app''s ready banner for this paper with its X (or went to Home from it). A banner that ran out untouched leaves it NULL. Written once by the portal.';
COMMENT ON COLUMN assessment_requests.notice_opened_at IS
  'Internal. When the teacher opened this paper in the app (or, for a failed one, tapped it). NULL = not yet. Written once by the portal; also sets notice_seen_at.';
COMMENT ON COLUMN niete_lp612_deliveries.notice_seen_at IS
  'Internal. When the teacher closed the app''s ready banner for this 6-12 lesson plan with its X (or went to Home from it). A banner that ran out untouched leaves it NULL. Portal rows only.';
COMMENT ON COLUMN niete_lp612_deliveries.notice_opened_at IS
  'Internal. When the teacher opened this lesson plan from the banner or Home. Portal rows only. NULL = not yet. (Opens by any other way are niete_lp_opens rows.)';

NOTIFY pgrst, 'reload schema';
