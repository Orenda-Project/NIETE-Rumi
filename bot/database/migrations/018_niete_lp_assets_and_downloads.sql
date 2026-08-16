-- Migration 018: K-5 v8 lesson-plan asset versioning + download tracking
--
-- Two new tables and one additive column. Nothing existing is dropped, retyped
-- or rewritten, and every statement is IF NOT EXISTS — safe to re-run, and safe
-- against whatever shape the live NIETE schema is actually in (bot/database/
-- schema.sql shows lesson_plans in its ORIGINAL 11-column form; the live DB may
-- have drifted and could not be read from the build environment).
--
-- WHAT THIS IS FOR
--   niete_lp_assets     — the version controller. One row per (lesson, kind,
--                         content). Content-addressed R2 keys under a NEW
--                         prefix, so the existing prod LP cache is untouched.
--   niete_lp_downloads  — every delivery attempt, sent or failed. Drives the
--                         ✓/○ resume tick in the LP Flow and answers "which
--                         version did she actually get?".
--
-- WHY CONTENT-ADDRESSED
--   A re-render that changes nothing produces the same content_hash, so the
--   uploader skips it (no R2 call, no new row). A re-render that DOES change
--   the PDF writes a new key, flips is_current, and leaves the old object and
--   row in place — a teacher who received last week's version still has a
--   working link, and the download row still names the version she got.
--
-- Apply via scripts/migration/apply-018-lp-v8-assets.js, or paste into the
-- Supabase SQL editor (service role).

-- ── The version controller ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS niete_lp_assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- {book_stem}_ch{N}_seg{M} — identical in the catalog, the render MANIFEST,
  -- the PDF filename and the R2 key. One id, end to end.
  lesson_id        TEXT        NOT NULL,
  catalog_version  TEXT        NOT NULL DEFAULT 'v8',

  -- Human-readable stamp from the render MANIFEST, e.g. 'v8-20260816T1650'
  version_stamp    TEXT        NOT NULL,
  -- sha1 of the DELIVERED (post-compression) bytes, first 12 hex chars
  content_hash     TEXT        NOT NULL,
  -- lp-cache/v8/<lesson_id>/<content_hash>.pdf — NEW prefix; the old prod LP
  -- cache is never written to by this feature.
  r2_key           TEXT        NOT NULL,

  bytes            BIGINT      NOT NULL,   -- delivered size
  source_bytes     BIGINT,                 -- pre-compression size (audit the saving)
  source_sha1      TEXT,                   -- MANIFEST pdf_sha1 — provenance back to the render
  prompt_layer_sha TEXT,                   -- MANIFEST prompt_layer_sha_at_render
  rendered_at      TIMESTAMPTZ,            -- MANIFEST rendered_at

  asset_kind       TEXT        NOT NULL DEFAULT 'lesson'
                   CHECK (asset_kind IN ('lesson', 'answer_key')),

  is_current       BOOLEAN     NOT NULL DEFAULT TRUE,
  superseded_at    TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Same bytes for the same lesson = the same row. Makes the uploader idempotent
-- at the DB level, not just in its own bookkeeping.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_assets_identity
  ON niete_lp_assets (lesson_id, asset_kind, content_hash);

-- Exactly one current asset per (lesson, kind). Without this a half-failed
-- uploader run could leave two rows claiming to be current and the endpoint
-- would serve whichever the planner happened to return first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_assets_one_current
  ON niete_lp_assets (lesson_id, asset_kind)
  WHERE is_current;

-- The endpoint's hot path: "which lessons in this chapter are servable?"
CREATE INDEX IF NOT EXISTS idx_lp_assets_current_lookup
  ON niete_lp_assets (catalog_version, lesson_id)
  WHERE is_current;

COMMENT ON TABLE niete_lp_assets IS
  'Version controller for the K-5 v8 lesson-plan corpus. One row per '
  '(lesson_id, asset_kind, content_hash); is_current marks the served version. '
  'Superseded rows are RETAINED so previously delivered links keep resolving.';

-- ── Download tracking (also the ✓/○ tick) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS niete_lp_downloads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,

  lesson_id      TEXT        NOT NULL,
  -- SET NULL, not CASCADE: the delivery record must outlive the asset row.
  asset_id       UUID REFERENCES niete_lp_assets(id) ON DELETE SET NULL,
  -- Denormalised so "which version did she get?" survives asset_id going null.
  version_stamp  TEXT,
  content_hash   TEXT,

  phone          TEXT,
  -- EVERY attempt is recorded, not just the wins. A silent failure that leaves
  -- no row is the bug class that ate a NIETE field test.
  status         TEXT        NOT NULL CHECK (status IN ('sent', 'failed')),
  error_text     TEXT,

  -- Snapshot context so analytics never has to join back to the catalog file.
  grade          INTEGER,
  subject        TEXT,
  chapter_number INTEGER,
  segment_index  INTEGER,

  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The tick query: has this teacher already received this lesson, any version?
CREATE INDEX IF NOT EXISTS idx_lp_downloads_tick
  ON niete_lp_downloads (user_id, lesson_id)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_lp_downloads_user_time
  ON niete_lp_downloads (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lp_downloads_lesson_time
  ON niete_lp_downloads (lesson_id, created_at DESC);

COMMENT ON TABLE niete_lp_downloads IS
  'One row per LP delivery ATTEMPT (sent or failed). Drives the ✓/○ resume tick '
  'on the LP Flow lesson screen and records which asset version each teacher got.';

-- ── lp_feedback: reserve the voicenote follow-up column ─────────────────────
-- Voicenotes are NOT live for NIETE, so the post-LP quiz asks about the lesson
-- plan only. This column is the one piece of schema the later voicenote
-- follow-up needs, added now so shipping it is code-only.

ALTER TABLE lp_feedback
  ADD COLUMN IF NOT EXISTS useful_component TEXT
  CHECK (useful_component IN ('lp_only', 'voicenote_only', 'both'));

COMMENT ON COLUMN lp_feedback.useful_component IS
  'Reserved: which half the teacher found more useful once voicenotes '
  'ship alongside the PDF. NULL for every after_pdf_only row.';
