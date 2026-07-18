-- BigQuery DDL — STEPS Teacher Presence (Round 2)
--
-- Target : `${BIGQUERY_STEPS_PROJECT_ID}.${BIGQUERY_STEPS_DATASET}.${BIGQUERY_STEPS_TABLE}`
-- Default dataset/table: steps.attendance   (project must be set via env)
--
-- Owner  : this deployment (source system)  ↔  STEPS dashboard (consumer)
-- Written by: nightly cron
--   bot/workers/attendance-bigquery-export.worker.js
-- Refresh:  daily @ 22:00 UTC (03:00 PKT next day)
--
-- Grain  : one row per (teacher_id, period_end) — daily snapshot of the last-24h
--          presence rollup for every teacher who had at least one
--          teacher_attendance_records row in the window (or zero rows if the
--          worker is invoked with a full-cohort override).
--
-- Idempotency: the worker deletes existing rows for the target period_end before
--              re-inserting. Re-running the same date is safe.
--
-- Contract source of truth:
--   dashboard/services/attendance-repository.service.js :: computePresence()
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Rendered example — substitute your BIGQUERY_STEPS_PROJECT_ID for `<project>`.
CREATE TABLE IF NOT EXISTS `<project>.steps.attendance` (
  -- Identity ────────────────────────────────────────────────────────────────
  teacher_phone_e164   STRING     NOT NULL  OPTIONS(description="Teacher's phone in E.164 (digits only, e.g. 92XXXXXXXXXX). Sourced from users.phone_number, already canonical E.164."),
  teacher_id           STRING     NOT NULL  OPTIONS(description="users.id (UUID as string)."),
  school_id            STRING               OPTIONS(description="users.school_id (UUID as string). NULL if teacher not yet mapped to a school."),
  sector               STRING               OPTIONS(description="Region/sector name from schools.region. NULL if school_id is NULL."),

  -- Period ──────────────────────────────────────────────────────────────────
  period_start         DATE       NOT NULL  OPTIONS(description="First day of the aggregation window (inclusive). For nightly last-24h runs, period_start = period_end."),
  period_end           DATE       NOT NULL  OPTIONS(description="Last day of the aggregation window (inclusive). Dedup key together with teacher_id."),

  -- Rollup (matches computePresence contract) ───────────────────────────────
  present_days         INT64      NOT NULL  OPTIONS(description="Distinct dates where teacher_attendance_records.status = 'present'."),
  absent_days          INT64      NOT NULL  OPTIONS(description="Distinct dates where status = 'absent'."),
  leave_days           INT64      NOT NULL  OPTIONS(description="Distinct dates where status = 'leave' (leave_type ∈ casual|sick|official)."),
  working_days         INT64      NOT NULL  OPTIONS(description="Distinct dates actually marked — present + absent + leave. Denominator for presence_pct."),
  presence_pct         FLOAT64    NOT NULL  OPTIONS(description="round(present_days / working_days * 100, 1dp). 0 when working_days = 0."),

  -- Provenance ──────────────────────────────────────────────────────────────
  synced_at            TIMESTAMP  NOT NULL  OPTIONS(description="UTC timestamp when this row was written by the export worker.")
)
PARTITION BY period_end
CLUSTER BY sector, teacher_id
OPTIONS (
  description = "Teacher presence rollup from the source Rumi deployment. One row per (teacher_id, period_end). Written nightly by bot/workers/attendance-bigquery-export.worker.js. Source table: teacher_attendance_records + users + schools."
);

-- ─── Notes for STEPS consumers ────────────────────────────────────────────
--
-- Dedup key: (teacher_id, period_end). The exporter DELETEs then INSERTs so a
--            re-run for the same period_end is safe and idempotent.
--
-- working_days === 0 → presence_pct === 0 (division-by-zero guard, per the
--                                          Round 1 spec).
--
-- Round trip check (should match the source dashboard/services/attendance-repository
-- output for the same window):
--   SELECT teacher_phone_e164, period_end, working_days, presence_pct
--   FROM `<project>.steps.attendance`
--   WHERE period_end = CURRENT_DATE('Asia/Karachi') - 1
--   ORDER BY sector, teacher_phone_e164;
