-- V1.6.1 — niete_lp_opens: one row per lesson plan a teacher OPENED in the portal.
-- Versioned migration in infrastructure/supabase/migrations (applied per environment, in order).
--
-- WHY. The portal's Lesson Plans page shows "Last opened", Coaching offers "your recent lesson
-- plans", and the new Home counts "Lesson plans used" for a date range. Opening a plan in the
-- portal leaves no record anywhere today: GET /curriculum/lp/:id/file|pdf and GET
-- /lp612/file|status/:render_id relay or mint a link and write nothing about the teacher. So
-- "when did she last open it" cannot be computed from any existing row.
--
-- WHY NOT REUSE (checked against the LIVE schema of prod ihzciabopbttygxxgrkm, read-only, and of
-- sandbox olvritwoqujtjvwfulbh on 3 Oct 2026 — 145 / 149 public tables — not from memory):
--   · niete_lp_downloads (99,061 rows on prod) — the K-5 WhatsApp DELIVERY ledger, K-5 only, no
--     surface column, carries phone. Eight readers treat every 'sent' row as a lesson that reached
--     her on WhatsApp: the 15:00 lp_quiz_offer cohort (it SENDS WhatsApp messages), lp-context (the
--     LLM's lesson context), coaching subject resolution, the WhatsApp recent-LP list and fidelity
--     resolution, call tools, the v8 quiz provider, the transcript quiz digest and the ✓ tick. A
--     portal open written there would change who gets an outbound WhatsApp quiz offer — a product
--     change, not a log line.
--   · niete_lp612_deliveries (3,972 rows) — 6-12 only: segment_id is a FK to niete_lp612_segments
--     and template_version is NOT NULL, so a K-5 open cannot live there, and one feature split over
--     two ledgers is two definitions of "opened". Its reserved surface='portal' would also put
--     portal opens into the WhatsApp /quiz lesson list.
--   · lesson_plans (97,704 rows) — one row per K-5 WhatsApp delivery that the feedback survey hangs
--     off (lp_feedback FKs it); content jsonb; wrong grain.
--   · lesson_plan_requests (67) — Gamma generation jobs. cta_clicks (0) — website WhatsApp-link
--     clicks keyed by an anonymous session_id, no user. user_feature_first_use — first use only.
--     dashboard_audit_log (0) — admin audit, resource_id is uuid (a K-5 lesson id is text).
--     record_history — trigger-written row-change audit.
-- A new table is the last resort here, and it is the one that fits: narrow, append-only, one index.
--
-- WHAT A ROW IS. One portal open by one teacher (user_id = users.id, never a phone):
--   plan_kind  'k5'   — grades 1-5; plan_ref = the catalogue lesson_id (data/lp_catalog.json, the
--                       same id niete_lp_downloads.lesson_id holds) — a catalogue entry, not a row,
--                       hence no foreign key.
--              'g612' — grades 6-12; plan_ref = niete_lp612_segments.segment_id; lang = the
--                       document's language. Not a FK either: one column serves both kinds.
--   source     'viewer'   — the portal's own PDF viewer (bytes relayed by GET …/file);
--              'external' — handed to another app (a presigned link from GET …/pdf or …/status?open=1).
-- The stable plan key the API speaks is `<plan_kind>:<plan_ref>`.
--
-- DE-DUPLICATION. The writer stores an open only if the same (user, kind, ref, lang) has no row in
-- the last 5 minutes (a conditional INSERT probing idx_lp_opens_user_recent), so a re-render, a
-- double tap or a viewer→external fallback is one open. Not a UNIQUE: a later open IS a new open.
--
-- ONE WRITER: the portal service (dashboard/services/lp-activity.service.js), fire-and-forget,
-- after the open succeeded. READERS: the same module — "recent lesson plans" and the Home's
-- "lesson plans used" count, both per teacher.
--
-- DATA. Ids, a language code and a timestamp. No phone, name or message text. Classification:
-- internal. ON DELETE CASCADE with the teacher's account, like niete_lp_downloads.
-- LOAD (Class R). One indexed probe + one insert per portal open. Upper bound: the K-5 WhatsApp
-- lane peaks at ~2.4k deliveries/school day (prod, Sep 2026); portal opens are a fraction of that,
-- so < 1M rows/year. Every read is per teacher via idx_lp_opens_user_recent.
-- SECURITY. RLS on, no policies: service role only, like every table the portal reaches.
-- IDEMPOTENT. IF NOT EXISTS throughout. Rollback: ROLLBACK_V1.6.1__niete_lp_opens.sql
-- One RPC call from the migration runner = one transaction; no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS niete_lp_opens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_kind   text NOT NULL CHECK (plan_kind IN ('k5', 'g612')),
  plan_ref    text NOT NULL CHECK (length(plan_ref) BETWEEN 1 AND 200),
  lang        text CHECK (lang IN ('en', 'ur')),
  source      text NOT NULL CHECK (source IN ('viewer', 'external')),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Every read and the de-dupe probe: one teacher's opens, newest first.
CREATE INDEX IF NOT EXISTS idx_lp_opens_user_recent
  ON niete_lp_opens (user_id, opened_at DESC);

ALTER TABLE niete_lp_opens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE niete_lp_opens IS
  'Internal. One row per lesson plan a teacher opened in the portal (append-only; same teacher + plan + lang within 5 minutes is stored once). Written by the portal service after the open succeeded; read for "last opened", recent lesson plans and the Home''s lesson-plans-used count. Ids only — no phone, name or message text. Owner: Digital Coach team.';
COMMENT ON COLUMN niete_lp_opens.plan_kind IS
  'Internal. k5 = grades 1-5 (plan_ref is a catalogue lesson_id); g612 = grades 6-12 (plan_ref is a niete_lp612_segments.segment_id).';
COMMENT ON COLUMN niete_lp_opens.plan_ref IS
  'Internal. The plan within its kind: a K-5 catalogue lesson_id or a 6-12 segment_id. With plan_kind, the stable plan key <kind>:<ref>.';
COMMENT ON COLUMN niete_lp_opens.lang IS
  'Internal. The 6-12 document language (en | ur); NULL for K-5.';
COMMENT ON COLUMN niete_lp_opens.source IS
  'Internal. viewer = the portal''s own PDF viewer; external = handed to another app by a presigned link.';

NOTIFY pgrst, 'reload schema';
