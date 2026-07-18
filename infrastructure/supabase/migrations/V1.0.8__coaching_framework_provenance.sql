-- V1.0.8  Coaching Framework Provenance (FEAT-060 / bd-2105)
--
-- Persist WHICH observation framework was used for a coaching session AND
-- WHY it was selected. Prior to this migration the framework choice was
-- computed at analysis-time from user preferences + region config + env
-- defaults, and thrown away once the report was written. That made post-hoc
-- audits ("were all NIETE sessions actually scored on FICO?") impossible
-- without re-running the selector.
--
-- Anti-sprawl notes (per root CLAUDE.md Rule 15):
--   * Both columns are added to the existing `coaching_sessions` table — no
--     new table. The values are session-scoped and change with each session.
--   * `framework` (TEXT) mirrors the framework registry key
--     ('fico' | 'oecd' | 'hots' | 'teach' | 'mewaka'). Not an enum — keeping
--     the registry as the single source of truth for valid keys and letting
--     the app fail fast on unknown values via the selector's fallback path.
--   * `framework_selection_reason` (TEXT) is one of:
--       'user_preference'      – users.preferences.observation_framework set
--       'region_default'       – REGION_FRAMEWORK_MAP hit for user.region
--       'deployment_default'   – DEFAULT_OBSERVATION_FRAMEWORK env
--       'fallback_no_user'     – user row missing at analysis-time
--       'fallback_error'       – supabase read threw; oecd emergency fallback
--       'fallback_unknown_key' – explicit preference key not in registry
--   * Nullable + no default: historical rows stay NULL (unknown provenance).
--     Backfill for the live NIETE user pool is a separate operational step
--     (see the pre-seed SQL in the FEAT-060 ship notes).

BEGIN;

ALTER TABLE coaching_sessions
  ADD COLUMN IF NOT EXISTS framework                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS framework_selection_reason TEXT NULL;

COMMENT ON COLUMN coaching_sessions.framework IS
  'Framework registry key used to score this session (fico/oecd/hots/teach/mewaka). NULL for pre-V1.0.8 rows.';

COMMENT ON COLUMN coaching_sessions.framework_selection_reason IS
  'Provenance of the framework choice: user_preference | region_default | deployment_default | fallback_no_user | fallback_error | fallback_unknown_key.';

-- Modest index — expected query pattern is analytics filtering by reason
-- (e.g. "how many sessions fell back to error last week?") and by framework
-- for cross-region rollups. Both are low-cardinality so a plain btree is
-- fine; no partial index needed.
CREATE INDEX IF NOT EXISTS idx_coaching_sessions_framework
  ON coaching_sessions (framework)
  WHERE framework IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coaching_sessions_framework_selection_reason
  ON coaching_sessions (framework_selection_reason)
  WHERE framework_selection_reason IS NOT NULL;

COMMIT;
