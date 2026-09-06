-- Share-code use counter, called by video-quiz.service.js when a child joins
-- through a share code (any route: Flow join, chat fallback, returning child,
-- invite). The caller has always fallen back to a read-then-write when this
-- function was absent — which it was on every NIETE database until
-- 2026-09-07 — so applying it changes no behaviour except making the count
-- atomic and silencing the per-join warning. Definition mirrors the OSS
-- schema (rumi-platform 00_complete-schema.sql §6b).
--
-- ADDITIVE ONLY. One env = one DB. Apply to STAGING first; prod on a go.

-- ─── up ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_share_code_uses(code_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.quiz_share_codes
     SET uses_count = COALESCE(uses_count, 0) + 1
   WHERE id = code_id;
END;
$$ LANGUAGE plpgsql;

-- ─── down ───────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.increment_share_code_uses(uuid);
