'use strict';
/**
 * One tick of the A/B tracker's rollup (docs/ab-tracker-store.md). Railway's cron (bot/scripts/ab-tracker-cron.js)
 * calls run() every 15 minutes; the run happens once per slot — 15 minutes in school hours, 2 hours outside them
 * (ab-tracker-cadence.js). It is the only caller: the worker's hourly tick was retired (bd-3kshar.6.5.1).
 *
 * In order, each step a way out:
 *   1. The read replica (config/supabase-replica-only.js). None configured on this tier → off. Test sites (staging,
 *      sandbox) have no paid replica and read their own database instead (supabase-replica-only.js says how).
 *   2. The server must say it is a replica (rpc db_is_replica) — the FIRST call, before any other read.
 *   3. app_settings ab_tracker_rollup_enabled, read on the replica: true, or a well-formed {"at":"HH:MM"} (kept so the
 *      old value still reads as on; the time is unused). No row, a malformed value or a failed read → off.
 *   4. One caller per tick (claimTick, a lock under 15 minutes), once per slot (marker).
 *   5. The live tests (rpc ab_tracker_live_tests) and, per test and database measure, its rows for a short window
 *      (rpc ab_tracker_metric_rows) — all on the replica, one call at a time, a pause between calls. Windows end
 *      TODAY: today's numbers are provisional and the next slot overwrites them. On Mondays and the read day the
 *      first complete run re-reads from the test's start (late rows get counted), in slices of SLICE_DAYS; later
 *      runs that date use the short window (marker ab_tracker:v1:full:<date>).
 *   6. Writes on the PRIMARY, and only the three ab_tracker_* functions (they touch the ab_ tables only): open a
 *      refresh, upsert the rows in batches of BATCH_ROWS, close the refresh. The primary client is loaded only here.
 *   7. Every read landed → 'ran', the slot marker (and the full marker if it read full). A failed read → 'partial', no marker: the next tick retries.
 * Logged with a correlation id: counts and timings only, never a unit id. Never throws.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent, generateCorrelationId, runWithCorrelation } = require('../../utils/structured-logger');
const { pktDate } = require('../nudges/pkt-time');
const { slotFor } = require('./ab-tracker-cadence');

const SWITCH_KEY = 'ab_tracker_rollup_enabled';
const TICK_KEY = 'ab_tracker:v1:tick';
const markerKey = (slot) => `ab_tracker:v1:run:${slot}`;
const fullKey = (date) => `ab_tracker:v1:full:${date}`;
const MARKER_TTL_SECONDS = 36 * 60 * 60;
const TICK_MIN = 15;
const LOOKBACK_DAYS = 4;
const SLICE_DAYS = 7;
const BATCH_ROWS = 1000;
const PAUSE_MS = 500;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** The measures this job can read from the database (ab_tracker_metric_rows); any other is skipped and counted. */
const DB_METRICS = { plan_fidelity: 'day', teachers_coming_back: 'week', child_quiz_objectives_secured: 'day', send_failures: 'day' };

/** On or off. true, or a well-formed {"at":"HH:MM"} (the pre-cadence value; its time is no longer used). */
function parseSwitch(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return false; } }
  if (v === true) return true;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.at !== 'string') return false;
  return HHMM.test(v.at);
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Mondays (Pakistan) and the test's read day re-read from the start, so rows that land late are counted. */
const isFullDay = (test, today) => monday(today) === today || today === test.read_on;

/**
 * The window a test's measure is re-read for: {from, to} (Pakistan dates, to = today), or null before day one.
 * Usually from LOOKBACK_DAYS back; on a full day (and fullAllowed) from start_on (weekly: its Monday), full: true.
 */
function windowFor(test, kind, today, fullAllowed = true) {
  const to = today;
  const full = fullAllowed && isFullDay(test, today);
  let from = full ? test.start_on : addDays(today, -LOOKBACK_DAYS);
  if (test.start_on > from) from = test.start_on;
  if (kind === 'week') from = monday(from) < test.start_on ? monday(test.start_on) : monday(from);
  if (from > to) return null;
  return full ? { from, to, full } : { from, to };
}

/** A window cut into reads of at most SLICE_DAYS days, so each read stays near a normal night's size. */
function slices({ from, to }) {
  const out = [];
  for (let f = from; f <= to; f = addDays(f, SLICE_DAYS)) {
    const end = addDays(f, SLICE_DAYS - 1);
    out.push({ from: f, to: end < to ? end : to });
  }
  return out;
}

async function readSwitch(db) {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', SWITCH_KEY).maybeSingle();
    return error || !data ? false : parseSwitch(data.value);
  } catch (_) {
    return false;
  }
}

async function call(db, name, args, opts) {
  const { data, error } = await db.rpc(name, args, opts);
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}

/** A read on the replica: sent as GET, because the Supabase read replica refuses POST rpc calls (HTTP 400). */
const read = (db, name, args) => call(db, name, args, { get: true });

/** Reads every live test's database measures (replica), then writes them (primary). Returns the counts. */
async function rollup({ reader, writer, today, fullAllowed, sleep, pauseMs, batchRows }) {
  const tests = (await read(reader, 'ab_tracker_live_tests')) || [];
  if (!Array.isArray(tests)) throw new Error('live tests is not a list');
  const rows = [];
  const counts = { tests: tests.length, reads: 0, full_windows: 0, skipped_metrics: 0, failed: 0, rows: 0, read_ms: 0, write_ms: 0 };
  for (const t of tests) {
    for (const metric of t.metric_ids || []) {
      const kind = DB_METRICS[metric];
      const w = kind ? windowFor(t, kind, today, fullAllowed) : null;
      if (!w) { counts.skipped_metrics += 1; continue; }
      if (w.full) counts.full_windows += 1;
      for (const s of slices(w)) {
        if (counts.reads > 0) await sleep(pauseMs);
        const started = Date.now();
        try {
          const got = await read(reader, 'ab_tracker_metric_rows', { p_test_id: t.test_id, p_metric_id: metric, p_from: s.from, p_to: s.to });
          for (const r of got || []) rows.push({ ...r, test_id: t.test_id, metric_id: metric });
        } catch (err) {
          counts.failed += 1;
          logToFile('⚠️ A/B tracker: a read failed — that slice keeps its earlier numbers', { metric, error: err && err.message }, 'warn');
        }
        counts.reads += 1;
        counts.read_ms += Date.now() - started;
      }
    }
  }
  const db = writer();
  const startedWrite = Date.now();
  const refreshId = await call(db, 'ab_tracker_refresh_open', { p_tests: tests.length, p_watermark: addDays(today, -1) });
  for (let i = 0; i < rows.length; i += batchRows) {
    counts.rows += Number(await call(db, 'ab_tracker_upsert_rollup', { p_refresh_id: refreshId, p_rows: rows.slice(i, i + batchRows) })) || 0;
  }
  counts.write_ms = Date.now() - startedWrite;
  const status = counts.failed ? 'partial' : 'ran';
  await call(db, 'ab_tracker_refresh_close', { p_refresh_id: refreshId, p_status: status, p_detail: counts });
  return { status, counts };
}

async function tick({ now, redis, reader, writer, sleep, pauseMs, batchRows }) {
  if (!reader) return { outcome: 'off', reason: 'no_replica' };
  const { checkReplica } = require('../../config/supabase-replica-only');
  const check = await checkReplica(reader);
  if (!check.ok) {
    logToFile('⚠️ A/B tracker: refused — not reading a replica; nothing read or written', { reason: check.reason }, 'warn');
    return { outcome: 'refused', reason: check.reason };
  }
  if (!(await readSwitch(reader))) return { outcome: 'off', reason: 'switch_off' };

  const { claimTick } = require('../monitoring/quiz-funnel-watch.service');
  const claim = await claimTick(redis, { tickMin: TICK_MIN }, TICK_KEY);
  if (claim !== 'owner') return { outcome: 'skipped', reason: claim };
  const today = pktDate(now);
  const slot = slotFor(now);
  if (await redis.get(markerKey(slot))) return { outcome: 'done_already' };
  const fullAllowed = !(await redis.get(fullKey(today)));

  const started = Date.now();
  const { status, counts } = await rollup({ reader, writer, today, fullAllowed, sleep, pauseMs, batchRows });
  if (status === 'ran') {
    await redis.set(markerKey(slot), now.toISOString(), MARKER_TTL_SECONDS);
    if (counts.full_windows > 0) await redis.set(fullKey(today), now.toISOString(), MARKER_TTL_SECONDS);
  }
  const summary = { outcome: status, slot, ...counts, ms: Date.now() - started };
  logEvent(`ab_tracker.rollup.${status}`, summary);
  return summary;
}

/**
 * @param {{ now?: Date, redis?: object, reader?: object|null, writer?: () => object, sleep?: (ms:number)=>Promise<void>,
 *   pauseMs?: number, batchRows?: number }} deps all injectable; reader defaults to the replica client (null when none
 *   is configured), writer to a loader of the primary client (called only after the replica check and the switch).
 */
async function run(deps = {}) {
  const {
    now = new Date(),
    redis = require('../cache/railway-redis.service'),
    reader = require('../../config/supabase-replica-only').replicaClient(),
    writer = () => require('../../config/supabase'),
    sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }),
    pauseMs = PAUSE_MS,
    batchRows = BATCH_ROWS,
  } = deps;
  return runWithCorrelation(generateCorrelationId(), async () => {
    try {
      return await tick({ now, redis, reader, writer, sleep, pauseMs, batchRows });
    } catch (err) {
      logToFile('❌ A/B tracker: the rollup stopped', { error: err && err.message }, 'error');
      return { outcome: 'error' };
    }
  });
}

module.exports = {
  run, parseSwitch, windowFor, isFullDay, slices, SWITCH_KEY, TICK_KEY, DB_METRICS, BATCH_ROWS, PAUSE_MS, TICK_MIN, LOOKBACK_DAYS, SLICE_DAYS,
};
