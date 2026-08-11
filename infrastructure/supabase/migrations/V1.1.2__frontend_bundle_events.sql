-- ═══════════════════════════════════════════════════════════════════════════
-- V1.1.2 — frontend_bundle_events: did the OTA bundle actually apply?
--
-- Separate from frontend_bundles (V1.1.1) because the write
-- patterns are nothing alike: that table is one row per RELEASE (low volume,
-- mutable rollout_percent); this is one row per DEVICE PER APPLY ATTEMPT
-- (high volume, append-only, never updated).
--
-- WHY THIS EXISTS AT ALL. The implementation being replaced had two empty
-- `catch (err) {}` blocks around the entire download-and-apply path. Every OTA
-- failure in production was therefore invisible: there was no way to answer
-- "how many devices took this bundle?" or "how many broke on it?"
--
-- That is not just a missing dashboard — it makes staged rollout impossible.
-- Holding a bundle at 10% is only useful if you can see what happened to those
-- 10%, and an automatic halt needs a number to trigger on. This table is that
-- number.
--
-- 'reverted' is the row to watch: it means Capgo's watchdog fired because the
-- bundle failed to reach ready, and the device rolled itself back. A cluster of
-- those mid-rollout is the halt signal.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS frontend_bundle_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable per-install identifier, NOT a user id. This table is about binaries
  -- and bundles, not teachers — deliberately carries no PII and no user FK.
  device_id      text        NOT NULL,

  -- Not a FK to frontend_bundles: a device can report on a bundle row that was
  -- since deleted, and losing the report would lose exactly the evidence we
  -- most want (what happened to a bundle bad enough to pull).
  bundle_version integer     NOT NULL,

  environment    text        NOT NULL,

  -- applied  = installed and booted cleanly
  -- failed   = download/checksum/apply error (detail says which)
  -- reverted = the rollback watchdog fired; the device restored the previous
  --            bundle on its own. The most important outcome here.
  outcome        text        NOT NULL
                   CHECK (outcome IN ('applied', 'failed', 'reverted')),

  -- The device's native versionCode at the time. Lets a failure be attributed
  -- to a binary/bundle COMBINATION rather than just the bundle — which is how
  -- a compatibility problem is distinguished from a bad bundle.
  native_version integer,

  detail         text,

  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Serves the rollout-health question: "for this bundle, in this tenant, what is
-- the outcome mix right now?"
CREATE INDEX IF NOT EXISTS idx_frontend_bundle_events_health
  ON frontend_bundle_events (environment, bundle_version, outcome, created_at DESC);

COMMENT ON TABLE frontend_bundle_events IS
  'Per-device OTA apply outcomes. The signal staged rollout is read from — '
  'without it a rollout is blind and an auto-halt has nothing to trigger on. '
  'Append-only; carries no PII and no user FK.';

COMMENT ON COLUMN frontend_bundle_events.outcome IS
  'applied | failed | reverted. "reverted" means the on-device rollback '
  'watchdog fired because the bundle never reached ready — a cluster of these '
  'mid-rollout is the halt signal.';

COMMENT ON COLUMN frontend_bundle_events.native_version IS
  'The device native versionCode at apply time, so a failure can be attributed '
  'to a binary+bundle combination rather than the bundle alone.';

COMMIT;

-- ─── PostgREST reload ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- DOWN (manual):
--   DROP TABLE IF EXISTS frontend_bundle_events;
