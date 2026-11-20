'use strict';
/**
 * One tick of the A/B tracker's nightly rollup (docs/ab-tracker-store.md). The worker calls run() every hour
 * (workers/ab-tracker-schedule.js); almost every tick ends at once ("off" or "not_due").
 *
 * In order, each step a way out:
 *   1. The read replica (config/supabase-replica-only.js). None configured on this tier → off. Test sites (staging,
 *      sandbox) have no paid replica and read their own database instead (supabase-replica-only.js says how).
 *   2. The server must say it is a replica (rpc db_is_replica) — the FIRST call, before any other read.
 *   3. app_settings ab_tracker_rollup_enabled, read on the replica: {"at":"HH:MM"} (Pakistan time) or true (03:00).
 *      No row, a malformed value or a failed read → off.
 *   4. Due from that time for DUE_WINDOW_MIN minutes; one worker per tick (claimTick), once per Pakistan date (marker).
 *   5. The live tests (rpc ab_tracker_live_tests) and, per test and database measure, its rows for a short window
 *      (rpc ab_tracker_metric_rows) — all on the replica, one call at a time, a pause between calls.
 *   6. Writes on the PRIMARY, and only the three ab_tracker_* functions (they touch the ab_ tables only): open a
 *      refresh, upsert the rows in batches of BATCH_ROWS, close the refresh. The primary client is loaded only here.
 *   7. Every read landed → 'ran' and the run marker. A failed read → 'partial', no marker: the next tick retries.
 * Logged with a correlation id: counts and timings only, never a unit id. Never throws.
 */
const { logToFile } = require('../../utils/logger');
const { logEvent, generateCorrelationId, runWithCorrelation } = require('../../utils/structured-logger');
const { pktDate, pktHour, pktMinute } = require('../nudges/pkt-time');

const SWITCH_KEY = 'ab_tracker_rollup_enabled';
const TICK_KEY = 'ab_tracker:v1:tick';
const markerKey = (date) => `ab_tracker:v1:run:${date}`;
const MARKER_TTL_SECONDS = 36 * 60 * 60;
const DEFAULT_AT_MIN = 3 * 60;
const DUE_WINDOW_MIN = 90;
const LOOKBACK_DAYS = 4;
const BATCH_ROWS = 1000;
const PAUSE_MS = 500;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** The measures this job can read from the database (ab_tracker_metric_rows); any other is skipped and counted. */
const DB_METRICS = { plan_fidelity: 'day', teachers_coming_back: 'week', child_quiz_objectives_secured: 'day', send_failures: 'day' };

/** Minutes after Pakistan midnight to start, or null (off). The 90-minute window must end by midnight. */
function parseSwitch(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (v === true) return DEFAULT_AT_MIN;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.at !== 'string') return null;
  const m = HHMM.exec(v.at);
  if (!m) return null;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return at + DUE_WINDOW_MIN > 24 * 60 ? null : at;
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = (iso) => addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The window a test's measure is re-read for tonight: {from, to} (Pakistan dates), or null before day one. */
function windowFor(test, kind, today) {
  const to = addDays(today, -1);
  let from = addDays(today, -LOOKBACK_DAYS);
  if (test.start_on > from) from = test.start_on;
  if (kind === 'week') from = monday(from) < test.start_on ? monday(test.start_on) : monday(from);
  return from > to ? null : { from, to };
}

async function readSwitch(db) {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', SWITCH_KEY).maybeSingle();
    return error || !data ? null : parseSwitch(data.value);
  } catch (_) {
    return null;
  }
}

async function call(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message || `${name} failed`);
  return data;
}

/** Reads every live test's database measures (replica), then writes them (primary). Returns the counts. */
async function rollup({ reader, writer, today, sleep, pauseMs, batchRows }) {
  const tests = (await call(reader, 'ab_tracker_live_tests')) || [];
  if (!Array.isArray(tests)) throw new Error('live tests is not a list');
  const rows = [];
  const counts = { tests: tests.length, reads: 0, skipped_metrics: 0, failed: 0, rows: 0, read_ms: 0, write_ms: 0 };
  for (const t of tests) {
    for (const metric of t.metric_ids || []) {
      const kind = DB_METRICS[metric];
      const w = kind ? windowFor(t, kind, today) : null;
      if (!w) { counts.skipped_metrics += 1; continue; }
      if (counts.reads > 0) await sleep(pauseMs);
      const started = Date.now();
      try {
        const got = await call(reader, 'ab_tracker_metric_rows', { p_test_id: t.test_id, p_metric_id: metric, p_from: w.from, p_to: w.to });
        for (const r of got || []) rows.push({ ...r, test_id: t.test_id, metric_id: metric });
      } catch (err) {
        counts.failed += 1;
        logToFile('⚠️ A/B tracker: a read failed — that measure keeps its earlier numbers', { metric, error: err && err.message }, 'warn');
      }
      counts.reads += 1;
      counts.read_ms += Date.now() - started;
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
  const at = await readSwitch(reader);
  if (at === null) return { outcome: 'off', reason: 'switch_off' };
  const minute = pktHour(now) * 60 + pktMinute(now);
  if (minute < at || minute >= at + DUE_WINDOW_MIN) return { outcome: 'not_due' };

  const { claimTick } = require('../monitoring/quiz-funnel-watch.service');
  const claim = await claimTick(redis, { tickMin: 60 }, TICK_KEY);
  if (claim !== 'owner') return { outcome: 'skipped', reason: claim };
  const today = pktDate(now);
  if (await redis.get(markerKey(today))) return { outcome: 'done_already' };

  const started = Date.now();
  const { status, counts } = await rollup({ reader, writer, today, sleep, pauseMs, batchRows });
  if (status === 'ran') await redis.set(markerKey(today), now.toISOString(), MARKER_TTL_SECONDS);
  const summary = { outcome: status, ...counts, ms: Date.now() - started };
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
      logToFile('❌ A/B tracker: the nightly rollup stopped', { error: err && err.message }, 'error');
      return { outcome: 'error' };
    }
  });
}

module.exports = {
  run, parseSwitch, windowFor, SWITCH_KEY, TICK_KEY, DB_METRICS, BATCH_ROWS, PAUSE_MS, DUE_WINDOW_MIN, LOOKBACK_DAYS,
};
