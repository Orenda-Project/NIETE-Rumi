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

// ─── Supabase pull ────────────────────────────────────────────────────────────

/**
 * Fetch all teacher_attendance_records for the target date, joined to the
 * teacher's canonical phone + school + sector via nested selects. Supabase's
 * PostgREST-style embedding handles the JOIN across the two FKs on
 * teacher_attendance_records (teacher_id → users, school_id → schools).
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
        id, phone_number, school_id
      ),
      school:schools!teacher_attendance_records_school_id_fkey (
        id, region
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
 * For a single-day window (nightly cron) each teacher will have at most one
 * record per date, so present_days ∈ {0,1} per row. The math still applies
 * unchanged — we do NOT special-case the single-day path.
 *
 * @param {object[]} rawRows — from fetchAttendanceForDate
 * @param {string} targetDate — YYYY-MM-DD, used for period_start + period_end
 * @returns {object[]} presence rows
 */
function aggregatePresence(rawRows, targetDate) {
  const byTeacher = new Map();
  for (const r of rawRows) {
    if (!r || !r.teacher_id) continue;
    if (!byTeacher.has(r.teacher_id)) {
      byTeacher.set(r.teacher_id, {
        teacher: r.teacher || null,
        school: r.school || null,
        records: [],
      });
    }
    const bucket = byTeacher.get(r.teacher_id);
    bucket.records.push({ date: r.date, status: r.status });
    // A given teacher's teacher/school snapshot may be missing on some rows if
    // the FK embed failed — keep the first non-null value we see.
    if (!bucket.teacher && r.teacher) bucket.teacher = r.teacher;
    if (!bucket.school && r.school) bucket.school = r.school;
  }

  const out = [];
  for (const [teacherId, bucket] of byTeacher.entries()) {
    const roll = computePresence(bucket.records);
    out.push({
      teacher_id: teacherId,
      mobile: bucket.teacher ? bucket.teacher.phone_number : null,
      school_id: bucket.school ? bucket.school.id : (bucket.teacher ? bucket.teacher.school_id : null),
      sector: bucket.school ? bucket.school.region : null,
      period_start: targetDate,
      period_end: targetDate,
      ...roll,
    });
  }
  return out;
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

    // 2) Aggregate into Presence contract rows (one per teacher).
    const presenceRows = aggregatePresence(rawRows, targetDate);
    console.log(`Aggregation: rolled up to ${presenceRows.length} teacher-presence rows`);

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
};
