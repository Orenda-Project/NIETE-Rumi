-- ═══════════════════════════════════════════════════════════════════════════
-- V1.1.1 — frontend_bundles: the OTA (live-update) bundle ledger
--
-- bd-2542. The Android portal app is Capacitor, so its UI is a web bundle
-- wrapped in a native shell. That bundle can be replaced over the air without
-- a Play release. This table is the record of which bundle is available to
-- whom.
--
-- WHY THIS TABLE EXISTS AT ALL: the endpoint the shipped app talks to today
-- lives in a RETIRED repo's Django service. It still serves, so this is a
-- migration and not an incident — but it is a single point of failure we do
-- not own, and when it stops, every installed app silently stops receiving
-- updates (the client swallows the error).
--
-- WHAT IS DELIBERATELY DIFFERENT FROM THE IMPLEMENTATION BEING REPLACED
--
--   1. `version` there is `AutoField(primary_key=True)` — the OTA version IS
--      a Postgres autoincrement PK. It cannot be set deliberately, cannot be
--      reasoned about against the native versionCode, and cannot express
--      compatibility. Here the surrogate key and the release identity are
--      separate: `id` is the PK, `bundle_version` is the release number that
--      CI sets.
--
--   2. `min_native_version` is NEW and is the entire compatibility contract
--      between the two release trains. A web bundle may only call native code
--      present in the installed binary; without this column a bundle built
--      against a newer AAB lands on an older one and crashes on a path nobody
--      tested. NOT NULL — there is no safe default.
--
--   3. `channel` is NEW. The prior schema's `environment` is a TENANT label
--      (which deployment), which got conflated with release stage. Both are
--      needed and they are orthogonal: environment says WHERE, channel says
--      HOW FAR ALONG.
--
--   4. `rollout_percent` is NEW. Previously a bundle was live to 100% of
--      devices the moment it existed. Staged rollout is the mechanism that
--      makes shipping to real teachers survivable.
--
--   5. `checksum_sha256` is NEW. Integrity was never verified; a truncated
--      download was indistinguishable from a good one.
--
-- Anti-sprawl check (root CLAUDE.md Rule 15): no existing table can hold this.
-- `app_settings` is single-valued config, not a per-artifact ledger with
-- history. The values are not derivable from a query — a bundle URL and its
-- checksum are facts about an uploaded artifact. One new table, no new
-- columns elsewhere.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS frontend_bundles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The release number CI assigns. Monotonic per (environment, channel).
  -- Deliberately NOT the primary key: conflating the two is what made the
  -- prior design unable to express compatibility.
  bundle_version      integer     NOT NULL,

  -- Minimum native versionCode that can run this bundle. The compatibility
  -- contract. NOT NULL because there is no safe default: a wrong guess here
  -- is a crash on a device we cannot reach.
  min_native_version  integer     NOT NULL,

  -- Release stage. 'internal' = team devices soaking; 'production' = teachers.
  channel             text        NOT NULL
                        CHECK (channel IN ('internal', 'production')),

  -- Tenant / deployment label (which regional install this is for). Distinct
  -- from `channel` — this says WHERE, channel says HOW FAR ALONG.
  environment         text        NOT NULL,

  -- Staged rollout. 0 = uploaded but reaching nobody (the default, so a fresh
  -- upload is inert until someone deliberately opens it up).
  rollout_percent     integer     NOT NULL DEFAULT 0
                        CHECK (rollout_percent BETWEEN 0 AND 100),

  bundle_url          text        NOT NULL,

  -- Verified client-side before the bundle is applied.
  checksum_sha256     text        NOT NULL
                        CHECK (char_length(checksum_sha256) = 64),

  -- Free-form note for humans: what shipped in this bundle.
  release_notes       text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  -- One bundle_version per tenant+channel. Makes a double-upload of the same
  -- release a database error rather than two rows that race to be `max()`.
  CONSTRAINT frontend_bundles_version_unique
    UNIQUE (environment, channel, bundle_version)
);

-- The read path is always "newest eligible bundle for this tenant+channel",
-- so the index is ordered to serve exactly that.
CREATE INDEX IF NOT EXISTS idx_frontend_bundles_lookup
  ON frontend_bundles (environment, channel, bundle_version DESC);

COMMENT ON TABLE frontend_bundles IS
  'OTA live-update bundles for the Capacitor portal app. One row per uploaded '
  'web bundle. Replaces the retired Django FrontendBundle model, whose version '
  'was an autoincrement PK and which had no compatibility, rollout, or '
  'integrity fields. bd-2542.';

COMMENT ON COLUMN frontend_bundles.min_native_version IS
  'Minimum native versionCode that can run this bundle. The contract between '
  'the Play release train and the OTA train — a device on a lower versionCode '
  'is never offered this bundle. Enforced in '
  'bot/shared/services/ota-bundle-selector.js.';

COMMENT ON COLUMN frontend_bundles.channel IS
  'Release stage: internal (team soak) or production (teachers). Orthogonal to '
  'environment, which is the tenant/deployment.';

COMMENT ON COLUMN frontend_bundles.rollout_percent IS
  'Staged rollout, 0-100. Defaults to 0 so a freshly uploaded bundle reaches '
  'nobody until deliberately opened up. Device bucketing is deterministic and '
  'monotonic — see isInRollout() in ota-bundle-selector.js.';

COMMENT ON COLUMN frontend_bundles.checksum_sha256 IS
  'SHA-256 of the bundle zip, verified on-device before the bundle is applied. '
  'A bundle without one is never served.';

COMMIT;

-- ─── PostgREST reload ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── Note on apply-telemetry (deliberately NOT in this migration) ───────────
-- Boot/apply success per bundle per device is what makes staged rollout
-- measurable and auto-halt possible. It is a separate concern with a different
-- write pattern (high-volume, append-only, per-device) from this ledger
-- (low-volume, one row per release), so it lands in its own migration with
-- bd-2546 rather than being bolted on here.
--
-- DOWN (manual):
--   DROP TABLE IF EXISTS frontend_bundles;
