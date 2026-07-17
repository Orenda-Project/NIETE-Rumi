/**
 * BigQuery Sync Service — STEPS Teacher Presence (Round 2)
 *
 * Thin wrapper around @google-cloud/bigquery for writing the daily teacher
 * presence rollup into the STEPS warehouse.
 *
 * Contract owner : this deployment (Round 1 shipped dashboard/services/attendance-repository.service.js)
 * Consumer       : STEPS dashboard (default target: <PROJECT>.steps.attendance)
 * DDL            : scripts/bigquery-steps-attendance-ddl.sql (source of truth)
 * Docs           : docs/attendance-bigquery-sync.md
 *
 * Why factor it out of the worker?
 *   * A future ad-hoc backfill / manual re-sync can require this service
 *     without dragging in the worker's cron scaffolding.
 *   * Testable in isolation with a mocked BigQuery client.
 *
 * Env (validated by getBigQueryConfig()):
 *   GOOGLE_SERVICE_ACCOUNT_PATH   (required) — path to GCP SA JSON key file.
 *   BIGQUERY_STEPS_PROJECT_ID     (required) — target GCP project.
 *                                              Placeholder until partner
 *                                              confirms; no default.
 *   BIGQUERY_STEPS_DATASET        (optional) — default `steps`.
 *   BIGQUERY_STEPS_TABLE          (optional) — default `attendance`.
 */

'use strict';

const path = require('path');

// ─── Config + validation ──────────────────────────────────────────────────────

/**
 * Read + validate BigQuery config from env. Fails loud on missing required vars.
 * @returns {{projectId: string, dataset: string, table: string, keyFilename: string}}
 */
function getBigQueryConfig() {
  const projectId = process.env.BIGQUERY_STEPS_PROJECT_ID;
  const dataset = process.env.BIGQUERY_STEPS_DATASET || 'steps';
  const table = process.env.BIGQUERY_STEPS_TABLE || 'attendance';
  const keyFilename = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;

  if (!keyFilename) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_PATH env var is required. Set it to the path of the GCP service-account JSON key with BigQuery Data Editor + Job User on the target project.'
    );
  }
  if (!projectId) {
    throw new Error('BIGQUERY_STEPS_PROJECT_ID env var is required.');
  }
  return { projectId, dataset, table, keyFilename };
}

/**
 * Build the fully-qualified table name — `project.dataset.table`.
 * @param {ReturnType<typeof getBigQueryConfig>} cfg
 */
function qualifiedTable(cfg) {
  return `${cfg.projectId}.${cfg.dataset}.${cfg.table}`;
}

// ─── Row shape (mirrors the DDL) ──────────────────────────────────────────────

/**
 * Convert a Presence contract object (as emitted by
 * dashboard/services/attendance-repository.service.js :: getPresence) into the
 * BigQuery row shape defined in scripts/bigquery-steps-attendance-ddl.sql.
 *
 * Guardrails:
 *   * teacher_phone_e164 + teacher_id are REQUIRED — rows without them are
 *     skipped by the worker (logged separately).
 *   * period_start / period_end are ISO date strings (YYYY-MM-DD).
 *   * synced_at is stamped by the caller (worker) so a whole batch shares one
 *     timestamp — simplifies debugging.
 *
 * @param {object} presence — from getPresence() + extra school metadata
 *   Shape: { teacher_id, mobile, school_id, sector, period_start, period_end,
 *            present_days, absent_days, leave_days, working_days, presence_pct }
 * @param {string} syncedAtIso
 * @returns {object|null} — null if required identity fields are missing
 */
function toBigQueryRow(presence, syncedAtIso) {
  if (!presence || !presence.teacher_id || !presence.mobile) return null;
  return {
    teacher_phone_e164: String(presence.mobile),
    teacher_id: String(presence.teacher_id),
    school_id: presence.school_id ? String(presence.school_id) : null,
    sector: presence.sector || null,
    period_start: String(presence.period_start),
    period_end: String(presence.period_end),
    present_days: Number(presence.present_days) || 0,
    absent_days: Number(presence.absent_days) || 0,
    leave_days: Number(presence.leave_days) || 0,
    working_days: Number(presence.working_days) || 0,
    presence_pct: Number(presence.presence_pct) || 0,
    synced_at: syncedAtIso,
  };
}

// ─── BigQuery client factory ──────────────────────────────────────────────────

/**
 * Lazy-load @google-cloud/bigquery so unit tests that don't hit the client can
 * run without the dep installed (CI installs bot deps in a later step).
 */
function createBigQueryClient(cfg = getBigQueryConfig()) {
  // eslint-disable-next-line global-require
  const { BigQuery } = require('@google-cloud/bigquery');
  return new BigQuery({
    projectId: cfg.projectId,
    keyFilename: cfg.keyFilename,
  });
}

// ─── Table ensure (CREATE IF NOT EXISTS) ──────────────────────────────────────

/**
 * Ensure the target table exists. Idempotent — creates it with the schema from
 * scripts/bigquery-steps-attendance-ddl.sql on first run, no-op afterwards.
 *
 * We execute the DDL via a query rather than the metadata API because the DDL
 * carries partition/clustering/column-description options that are cleaner to
 * express in SQL.
 *
 * @param {ReturnType<typeof createBigQueryClient>} client
 * @param {ReturnType<typeof getBigQueryConfig>} cfg
 */
async function ensureTable(client, cfg = getBigQueryConfig()) {
  const fq = qualifiedTable(cfg);
  const ddl = `
    CREATE TABLE IF NOT EXISTS \`${fq}\` (
      teacher_phone_e164   STRING     NOT NULL,
      teacher_id           STRING     NOT NULL,
      school_id            STRING,
      sector               STRING,
      period_start         DATE       NOT NULL,
      period_end           DATE       NOT NULL,
      present_days         INT64      NOT NULL,
      absent_days          INT64      NOT NULL,
      leave_days           INT64      NOT NULL,
      working_days         INT64      NOT NULL,
      presence_pct         FLOAT64    NOT NULL,
      synced_at            TIMESTAMP  NOT NULL
    )
    PARTITION BY period_end
    CLUSTER BY sector, teacher_id
    OPTIONS (
      description = "Teacher presence rollup from Rumi. Written nightly by bot/workers/attendance-bigquery-export.worker.js."
    );
  `;
  await client.query({ query: ddl, location: 'US' });
}

// ─── Upsert (delete-then-insert per period_end) ───────────────────────────────

/**
 * Idempotent upsert for a single period_end batch.
 *
 * Semantics:
 *   1. DELETE FROM {table} WHERE period_end = @period_end
 *      (streaming buffer note: if a prior batch is still in the streaming
 *       buffer BigQuery will refuse the DELETE. Round 2 uses `insert()` with
 *       the classic API; the buffer window is minutes. For the ICT cohort
 *       (~few thousand teachers/night) this is not a problem in the nightly
 *       cadence, but the option is exposed via `useLoadJob` for future scale.)
 *   2. INSERT the fresh batch.
 *
 * All rows in a batch must share the same period_end. This is enforced at the
 * worker level (one worker run = one period).
 *
 * @param {ReturnType<typeof createBigQueryClient>} client
 * @param {object[]} rows
 * @param {ReturnType<typeof getBigQueryConfig>} cfg
 * @returns {Promise<{deleted: number, inserted: number}>}
 */
async function upsertRows(client, rows, cfg = getBigQueryConfig()) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { deleted: 0, inserted: 0 };
  }
  const periods = new Set(rows.map((r) => r.period_end));
  if (periods.size !== 1) {
    throw new Error(
      `upsertRows expects all rows to share one period_end; got ${periods.size} distinct values.`
    );
  }
  const [periodEnd] = periods;
  const fq = qualifiedTable(cfg);

  // 1) delete existing rows for this period_end
  const deleteResp = await client.query({
    query: `DELETE FROM \`${fq}\` WHERE period_end = @period_end`,
    params: { period_end: periodEnd },
    location: 'US',
  });
  const deleted = (deleteResp && deleteResp[0] && deleteResp[0].numDmlAffectedRows) || 0;

  // 2) insert the fresh batch via the streaming API (fast + small volumes)
  const dataset = client.dataset(cfg.dataset);
  const table = dataset.table(cfg.table);
  await table.insert(rows, { skipInvalidRows: false, ignoreUnknownValues: false });

  return { deleted: Number(deleted) || 0, inserted: rows.length };
}

module.exports = {
  getBigQueryConfig,
  qualifiedTable,
  toBigQueryRow,
  createBigQueryClient,
  ensureTable,
  upsertRows,
};
