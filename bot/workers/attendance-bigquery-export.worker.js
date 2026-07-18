/**
 * Attendance → BigQuery Export Worker (STEPS teacher presence, Round 2)
 *
 * Runs nightly at 22:00 UTC (03:00 PKT next day) — inside the partner's
 * approved 02:00–04:00 PKT maintenance window — and exports the last-24h
 * teacher presence rollup to the STEPS BigQuery warehouse.
 *
 * Wiring:
 *   Cron:   Railway Cron / any external scheduler → `node bot/workers/attendance-bigquery-export.worker.js`
 *   Source: NIETE Rumi Supabase — teacher_attendance_records + users + schools
 *   Sink:   BigQuery — ${BIGQUERY_STEPS_PROJECT_ID}.${BIGQUERY_STEPS_DATASET}.${BIGQUERY_STEPS_TABLE}
 *           (default tbproddb.steps.attendance)
 *
 * Pattern lifted from bot/workers/stale-session.worker.js — one-shot exec,
 * structured logs, process.exit on completion, --dry-run flag for local
 * verification without writing to BigQuery.
 *
 * Idempotency: the write step DELETEs existing rows for the target period_end
 * before INSERTing, so a same-day re-run is safe.
 *
 * Flags:
 *   --dry-run          Print the payload and skip the BigQuery write.
 *   --date=YYYY-MM-DD  Override the target date (default = "yesterday in Asia/Karachi").
 */

'use strict';

require('dotenv').config();

const supabase = require('../shared/config/supabase');
const { logToFile } = require('../shared/utils/logger');
const {
  computePresence,
} = require('../../dashboard/services/attendance-repository.service');
const {
  getBigQueryConfig,
  qualifiedTable,
  toBigQueryRow,
  createBigQueryClient,
  ensureTable,
  upsertRows,
} = require('../shared/services/attendance/bigquery-sync.service');

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

/**
 * Parse process.argv for --dry-run and --date=YYYY-MM-DD.
 * @param {string[]} [argv=process.argv.slice(2)]
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = { dryRun: false, date: null };
  for (const a of argv) {
    if (a === '--dry-run' || a === '-n') args.dryRun = true;
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
  }
  return args;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Return YYYY-MM-DD for "yesterday" in the Asia/Karachi timezone. The nightly
 * cron fires at 22:00 UTC = 03:00 PKT, so "yesterday PKT" = the day that just
 * ended at midnight PKT.
 */
function yesterdayInKarachi(now = new Date()) {
  // Intl gives us the current date in PKT, then we subtract one day.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayPkt = fmt.format(now); // "YYYY-MM-DD"
  const d = new Date(`${todayPkt}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── Sector normalization + approved-sector filter ────────────────────────────

/**
 * Six sectors approved by Hasnat (STEPS owner) for TASK-133. Anything else —
 * NULL, unrecognized value, or a typo — is dropped from the export and logged
 * via the "dropped N: NULL/unrecognized region" line so the count is never
 * a silent filter.
 *
 * Source of truth for sector = users.region (NOT schools.region — only 4/8813
 * users have a non-NULL school_id and the schools table has 1 row; the
 * effective sector lives directly on the user record).
 */
const APPROVED_SECTORS = new Set([
  'Urban-I',
  'Urban-II',
  'Sihala',
  'Nilore',
  'Tarnol',
  'Barakahu',
]);

/**
 * TEMP: B.K → Barakahu until source-of-truth team fixes upstream
 * migration. A subset of user records were seeded with the shorthand "B.K"
 * instead of the full sector name. We accept it here and rewrite at export
 * time so STEPS only ever sees the approved value.
 *
 * @param {string|null|undefined} raw — users.region as read from the DB
 * @returns {string|null} — normalized sector, or null if the input is empty
 */
function normalizeSector(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (s === 'B.K') return 'Barakahu';
  return s;
}

// ─── Supabase pull ────────────────────────────────────────────────────────────

/**
 * Fetch all teacher_attendance_records for the target date, joined to the
 * teacher's canonical phone + region via a nested select. Supabase's
 * PostgREST-style embedding handles the JOIN on
 * teacher_attendance_records.teacher_id → users.
 *
 * NOTE: sector is now read from `users.region` DIRECTLY. The earlier design
 * (users.school_id → schools.region) was wrong for this dataset: only 4/8813
 * users have a non-NULL school_id and the schools table has 1 row. We keep
 * school_id on the row for downstream identification but do NOT embed the
 * schools table — sector comes from users.region + normalizeSector() + the
 * APPROVED_SECTORS filter.
 *
 * We DO NOT filter by school here — the export covers every teacher who has a
 * row for the target date across every ICT sector.
 *
 * @param {object} client — Supabase client
 * @param {string} targetDate — YYYY-MM-DD
 */
async function fetchAttendanceForDate(client, targetDate) {
  const { data, error } = await client
    .from('teacher_attendance_records')
    .select(`
      id, teacher_id, school_id, date, status, leave_type,
      teacher:users!teacher_attendance_records_teacher_id_fkey (
        id, phone_number, school_id, region
      )
    `)
    .eq('date', targetDate);
  if (error) throw error;
  return data || [];
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Group raw teacher_attendance_records by teacher_id and roll each group into
 * one Presence contract row (teacher_id, mobile, school_id, sector,
 * period_start, period_end, present_days, absent_days, leave_days,
 * working_days, presence_pct). Uses the same computePresence() helper the
 * portal already ships so the numbers match everywhere.
 *
 * Sector rules (per Hasnat's TASK-133 review):
 *   1. Read sector from users.region DIRECTLY (not schools.region).
 *   2. Normalize B.K → Barakahu (TEMP; upstream source-of-truth team should fix).
 *   3. Drop any teacher whose normalized sector is NULL or not in APPROVED_SECTORS.
 *      The dropped count is returned to the caller so the worker can log
 *      "dropped N: NULL/unrecognized region" — never a silent filter.
 *
 * For a single-day window (nightly cron) each teacher will have at most one
 * record per date, so present_days ∈ {0,1} per row. The math still applies
 * unchanged — we do NOT special-case the single-day path.
 *
 * @param {object[]} rawRows — from fetchAttendanceForDate
 * @param {string} targetDate — YYYY-MM-DD, used for period_start + period_end
 * @returns {{ rows: object[], droppedCount: number, droppedTeacherIds: string[] }}
 *   `rows` are the presence rows for teachers with an approved sector;
 *   `droppedCount` is how many teachers were filtered out (NULL / unrecognized);
 *   `droppedTeacherIds` is a bounded sample (first 20) for debugging.
 */
function aggregatePresence(rawRows, targetDate) {
  const byTeacher = new Map();
  for (const r of rawRows) {
    if (!r || !r.teacher_id) continue;
    if (!byTeacher.has(r.teacher_id)) {
      byTeacher.set(r.teacher_id, {
        teacher: r.teacher || null,
        records: [],
      });
    }
    const bucket = byTeacher.get(r.teacher_id);
    bucket.records.push({ date: r.date, status: r.status });
    // A given teacher's teacher snapshot may be missing on some rows if the FK
    // embed failed — keep the first non-null value we see.
    if (!bucket.teacher && r.teacher) bucket.teacher = r.teacher;
  }

  const rows = [];
  const droppedTeacherIds = [];
  let droppedCount = 0;
  for (const [teacherId, bucket] of byTeacher.entries()) {
    // Sector = users.region (normalized), then filtered against APPROVED_SECTORS.
    const rawRegion = bucket.teacher ? bucket.teacher.region : null;
    const sector = normalizeSector(rawRegion);
    if (!sector || !APPROVED_SECTORS.has(sector)) {
      droppedCount += 1;
      if (droppedTeacherIds.length < 20) droppedTeacherIds.push(teacherId);
      continue;
    }
    const roll = computePresence(bucket.records);
    rows.push({
      teacher_id: teacherId,
      mobile: bucket.teacher ? bucket.teacher.phone_number : null,
      school_id: bucket.teacher ? bucket.teacher.school_id : null,
      sector,
      period_start: targetDate,
      period_end: targetDate,
      ...roll,
    });
  }
  return { rows, droppedCount, droppedTeacherIds };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const startTime = Date.now();
  const args = parseArgs(argv);
  const targetDate = args.date || yesterdayInKarachi();

  console.log('=================================================================');
  console.log(`Attendance→BigQuery export starting ${new Date().toISOString()}`);
  console.log(`  target date : ${targetDate}`);
  console.log(`  dry-run     : ${args.dryRun}`);
  console.log('=================================================================');

  try {
    // 1) Pull raw records for the target date from Supabase.
    const rawRows = await fetchAttendanceForDate(supabase, targetDate);
    console.log(`Supabase: fetched ${rawRows.length} teacher_attendance_records for ${targetDate}`);

    // 2) Aggregate into Presence contract rows (one per teacher), filter to
    //    the 6 approved sectors, and surface the drop count so it's never a
    //    silent filter (per Hasnat's TASK-133 review).
    const { rows: presenceRows, droppedCount, droppedTeacherIds } = aggregatePresence(rawRows, targetDate);
    console.log(`Aggregation: rolled up to ${presenceRows.length} teacher-presence rows`);
    if (droppedCount > 0) {
      console.warn(`dropped ${droppedCount}: NULL/unrecognized region`);
      logToFile('attendance-bigquery-export dropped rows', {
        droppedCount,
        droppedTeacherIdsSample: droppedTeacherIds,
        approvedSectors: Array.from(APPROVED_SECTORS),
        targetDate,
      }, 'warn');
    }

    // 3) Shape into BigQuery rows + drop any missing identity.
    const syncedAt = new Date().toISOString();
    const bqRows = [];
    let skipped = 0;
    for (const p of presenceRows) {
      const row = toBigQueryRow(p, syncedAt);
      if (row) bqRows.push(row);
      else skipped++;
    }
    if (skipped > 0) {
      console.warn(`WARN: skipped ${skipped} teacher rows missing teacher_id or phone_number`);
      logToFile('attendance-bigquery-export skipped rows', { skipped, targetDate }, 'warn');
    }
    console.log(`Shaped: ${bqRows.length} rows ready for BigQuery`);

    // 4) Dry-run OR write.
    if (args.dryRun) {
      const preview = bqRows.slice(0, 5);
      console.log('--- DRY RUN — payload preview (first 5 rows) ---');
      console.log(JSON.stringify(preview, null, 2));
      console.log(`--- Would write ${bqRows.length} rows total, skipping actual BigQuery call.`);
    } else if (bqRows.length === 0) {
      console.log('No rows to write — exiting successfully.');
    } else {
      const cfg = getBigQueryConfig();
      console.log(`BigQuery target: ${qualifiedTable(cfg)}`);
      const client = createBigQueryClient(cfg);
      await ensureTable(client, cfg);
      const { deleted, inserted } = await upsertRows(client, bqRows, cfg);
      console.log(`BigQuery upsert: deleted=${deleted} inserted=${inserted}`);
      logToFile('attendance-bigquery-export success', {
        targetDate,
        rows: bqRows.length,
        deleted,
        inserted,
        durationMs: Date.now() - startTime,
      });
    }

    const durationMs = Date.now() - startTime;
    console.log(`Worker completed in ${durationMs}ms`);
    process.exit(0);
  } catch (error) {
    console.error('Worker error:', error);
    logToFile('attendance-bigquery-export error', {
      error: error.message,
      stack: error.stack,
      targetDate,
    }, 'error');
    process.exit(1);
  }
}

// Gated — requiring this file from tests does NOT fire the export. Invoke main()
// explicitly.
if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  yesterdayInKarachi,
  fetchAttendanceForDate,
  aggregatePresence,
  normalizeSector,
  APPROVED_SECTORS,
};
