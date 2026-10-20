-- V1.6.17 — coach_visit_requests.coach_plan: the coach's choices in the card's "Coaching suggestion" box (bd-tbprit.11).
-- Versioned migration. Applied per environment, in order, from infrastructure/supabase/migrations.
--
-- WHAT. Rifat's prototype step 4: the coach picks what she found (0-3) and a way (msg|call|visit). "The teacher
-- was right" flags the report to the DC team (flagged, flaggedAt; Undo clears it); "Add to my next visit" stamps
-- addedToVisitAt; opening the WhatsApp link stamps sentAt. ai holds the AI-tailored suggestion per answer, cached
-- so a second open does not call the model again. Written only by POST /coach/disagreements/:id/plan and
-- /suggestion, for the request's own coach, from a whitelist of keys.
--
-- WHY NO NEW TABLE. One row per request already exists and carries the coach who may write it. Checked and not
-- fitting: hcp_visit_schedules (needs a visit date, feeds the bot's call context), feature_suggestions,
-- cta_clicks, coaching_quality_metrics (other shapes, other owners).
--
-- DATA. Sensitivity: internal. Codes, booleans and timestamps. The AI text is stored with a {name} placeholder,
-- never the teacher's name; the coach's edited message is NOT stored (it rides the wa.me link only).
-- IDEMPOTENT. ADD COLUMN IF NOT EXISTS.
-- Rollback: ROLLBACK_V1.6.17__coach_visit_plan.sql
-- ORDER. Before the code: the card selects coach_plan, and a select of a missing column fails the card.

ALTER TABLE coach_visit_requests ADD COLUMN IF NOT EXISTS coach_plan JSONB;

COMMENT ON COLUMN coach_visit_requests.coach_plan IS
  'bd-tbprit.11: the coach''s step-4 choices {found, mode, flagged, flaggedAt, addedToVisitAt, sentAt, ai{0..3}}. Sensitivity: internal. No names or message text. NULL = untouched.';

NOTIFY pgrst, 'reload schema';
