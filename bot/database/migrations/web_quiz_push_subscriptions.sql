-- requires: 014_attendance_tables.sql
-- Migration: web push reminder consents (the child's "remind me tomorrow", the teacher's evening reminder).
--
-- NON-DESTRUCTIVE. One new table; nothing existing is touched.
-- Owner: notify-org. Steward: the NIETE bot team. Read and written by the bot's service role only (RLS on, no policy).
--
--   web_quiz_push_subscriptions  one row per consent: the adult holding the phone tapped Yes (family_phone), or a
--                                teacher turned the portal reminder on (teacher_portal). The push endpoint and its
--                                keys are stored encrypted (AES-256-GCM) and looked up by an HMAC; never in clear.
--
-- Retention: a live row expires at expires_at (consent + 90 days, renewed on each open). The expiry tick (bot worker,
-- every 6 h, whatever the switches say) revokes it (revoked_by = 'expiry') and nulls the ciphertext, and hard-deletes
-- revoked rows 13 months after revoked_at. A re-consent is a new row (rebind_of the old one).
-- Every statement is IF NOT EXISTS: applying it twice is a no-op.
-- Rollback: web_quiz_push_subscriptions_rollback.sql.
-- One env = one DB. Apply to sandbox first; staging and prod only on a go.

CREATE TABLE IF NOT EXISTS public.web_quiz_push_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text        NOT NULL CHECK (kind IN ('quiz_reminder','evening_plan')),
  via             text        NOT NULL CHECK (via IN ('family_phone','teacher_portal')),
  device_ref      text,                              -- the wq_dv browser id (server-random, never a phone); no parent table, as quiz_sessions.device_ref
  user_id         uuid        REFERENCES public.users(id),      -- teacher rows only
  student_id      uuid        REFERENCES public.students(id),   -- only when exactly one chip was on the device at consent; else NULL
  class_id        uuid        REFERENCES public.classes(id),    -- when resolvable from the quiz code; else NULL
  quiz_code       text,                              -- the public quiz code the child played
  lang            text        NOT NULL DEFAULT 'ur' CHECK (lang IN ('en','ur')),
  ua_class        text        NOT NULL CHECK (ua_class IN ('chrome_android','samsung','chrome_desktop','other')),
  endpoint_hash   text        NOT NULL UNIQUE,       -- hex(HMAC-SHA256(WQ_PUSH_HASH_SALT, endpoint)); 'retired:<id>' once a re-consent takes it
  endpoint_enc    text,                              -- AES-256-GCM(WQ_PUSH_ENC_KEY) of the endpoint; NULL once revoked
  keys_enc        text,                              -- AES-256-GCM of {p256dh, auth}; NULL once revoked
  consented_at    timestamptz NOT NULL,
  chips_n         smallint    NOT NULL DEFAULT 0,
  next_at         timestamptz,                       -- next send: 16:00 PKT (child) / 18:00 PKT (teacher), next school day
  last_sent_at    timestamptz,
  last_opened_at  timestamptz,
  sent_count      integer     NOT NULL DEFAULT 0,
  unopened_count  integer     NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,              -- consented_at + 90 days; renewed to now + 90 days on each open
  revoked_at      timestamptz,
  revoked_by      text        CHECK (revoked_by IN ('page','notification','browser','stop','rotated','gone','unopened','class_phone','teacher','expiry')),
  rebind_of       uuid        REFERENCES public.web_quiz_push_subscriptions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wqps_revoked_keeps_no_secret CHECK ((endpoint_enc IS NULL AND keys_enc IS NULL) OR revoked_at IS NULL),
  CONSTRAINT wqps_one_owner CHECK ((via = 'family_phone' AND user_id IS NULL AND device_ref IS NOT NULL) OR (via = 'teacher_portal' AND user_id IS NOT NULL))
);
COMMENT ON TABLE public.web_quiz_push_subscriptions IS 'Web push reminder consents (child family phone, teacher portal). Owner notify-org; steward the NIETE bot team. Service role only.';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.endpoint_hash IS 'Restricted-PII: HMAC of the push endpoint (a per-device capability URL); lookup only';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.endpoint_enc IS 'Restricted-PII: encrypted push endpoint; service role only; nulled on revoke';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.keys_enc IS 'Restricted-PII: encrypted p256dh+auth; service role only; nulled on revoke';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.device_ref IS 'PII: server-random browser id (wq_dv cookie); no parent table by design';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.student_id IS 'PII: child id; NULL unless exactly one chip on the device at consent';
COMMENT ON COLUMN public.web_quiz_push_subscriptions.user_id IS 'PII: the teacher (teacher_portal rows only)';
CREATE INDEX IF NOT EXISTS wqps_due_idx ON public.web_quiz_push_subscriptions (next_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS wqps_device_idx ON public.web_quiz_push_subscriptions (device_ref) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS wqps_revoked_idx ON public.web_quiz_push_subscriptions (revoked_at) WHERE revoked_at IS NOT NULL;
ALTER TABLE public.web_quiz_push_subscriptions ENABLE ROW LEVEL SECURITY;   -- no policy: service role only
DROP TRIGGER IF EXISTS wqps_updated_at ON public.web_quiz_push_subscriptions;
CREATE TRIGGER wqps_updated_at BEFORE UPDATE ON public.web_quiz_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
