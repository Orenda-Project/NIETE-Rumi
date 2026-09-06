-- The intro-video showing count (transcript quiz D7: the film rides the
-- first N offers, not just the first one).
--
-- ADDITIVE ONLY. Applying it changes no behaviour until
-- TRANSCRIPT_QUIZ_INTRO_VIDEO_SHOWS / _UR / _EN are set on a service.
--
-- Explored live (staging, 2026-09-06) before writing:
--   user_feature_first_use: id uuid, user_id uuid, feature text NOT NULL,
--     video_shown_at timestamptz default now(), feature_used_at timestamptz,
--     created_at timestamptz default now(). Unique (user_id, feature).
--   No counter column and no JSON/metadata column — a new column is the
--   schema-first last resort here, not the first move.
-- One env = one DB. Apply to STAGING first; prod only on an explicit go.

-- ─── up ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_feature_first_use
  ADD COLUMN IF NOT EXISTS intro_shown_count integer NOT NULL DEFAULT 0;

-- ─── down ───────────────────────────────────────────────────────────────────
-- ALTER TABLE public.user_feature_first_use DROP COLUMN IF EXISTS intro_shown_count;
