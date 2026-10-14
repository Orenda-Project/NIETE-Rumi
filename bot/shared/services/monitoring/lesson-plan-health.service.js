'use strict';
/**
 * Lesson-plan health — one summary an hour of every lesson-plan path that writes the lifecycle, read
 * from lesson_plan_requests itself.
 *
 * WHY. Until the lifecycle, NIETE had no lesson-plan health signal at all. With LP_LIFECYCLE_PATHS on,
 * every path writes its asks to one table, so one bounded read an hour can say, per path and channel:
 * how many asks, how many delivered, how many failed and why, how long delivery took — and whether any
 * request has got stuck.
 *
 * WHAT IT EMITS. `lesson_plan.health.checked` (Axiom), every tick: { windowStart, windowEnd, windowMin,
 * verdict, reasons, stuck, rowsRead, truncated, sources: [{ source, channel, asks, delivered, inFlight,
 * failed, systemFailures, systemFailureRate, codes, p50DeliverSec, p90DeliverSec }] }. Not healthy, it is
 * also said at error level, which is what an Axiom monitor pages on.
 *
 *   degraded — a request crossed STUCK_HOURS still pending/processing during the window (reason 'stuck';
 *              each one is reported once, in the window it crosses, never every hour after), or a
 *              path/channel whose SYSTEM failures are >= FAIL_RATE of >= MIN_FINISHED finished asks, or
 *              >= ABS_FAILURES in the window whatever the volume (reason 'failure_rate:<path>/<channel>').
 *              Only finished asks count: a code on a request still in flight is not yet an outcome.
 *              NO_ASSET (the plan is not there yet) and NOT_ELIGIBLE (held, or not for her) are content
 *              answers: reported, never counted.
 *
 * THE WINDOW. Each tick summarises the asks made between where the previous tick stopped (a watermark in
 * Redis) and LAG_MIN ago — so ticks neither overlap nor leave a gap across redeploys, and an ask made just
 * before a tick is counted once its outcome has landed. No watermark (first run, or it expired): the hour
 * before the lag. A long outage catches up at most MAX_CATCHUP_MIN.
 *
 * HOW IT RUNS. The sqs-worker's main-queue replicas call run() hourly and once after boot. Exactly one
 * replica reads per tick — a read-back claim in Redis, because the shared Redis service's setNX answers
 * TRUE when Redis is down (right for de-dup elsewhere, wrong for a monitor: every replica would report).
 * A cache that cannot answer is a skip, warned every time and said at error level from the third skip in
 * a row: a check that silently never runs is the failure this exists to prevent.
 *
 * SWITCHES. A no-op until LP_LIFECYCLE_PATHS switches a path on; LP_HEALTH_CHECK=off stops the hourly tick
 * alone. The on-demand view (onDemand, GET /api/internal/lp/health) answers whenever a path is on, for the
 * last hour up to now.
 *
 * LOAD. Off (no path switched on): nothing at all. On: one claim, one read of the window's rows that carry
 * a path (newest first, at most MAX_ROWS; idx_lp_requests_source_created), and one head count of newly
 * stuck rows (idx_lp_requests_status) — two reads an hour across the whole fleet.
 *
 * Never throws: every failure resolves to an outcome and is logged.
 */

const supabase = require('../../config/supabase');
const Lifecycle = require('../lesson-plan-lifecycle.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const WINDOW_MIN = 60;
const LAG_MIN = 15;
const MAX_CATCHUP_MIN = 3 * 60;
const MIN_WINDOW_MIN = 5;
const STUCK_HOURS = 6;
const MAX_ROWS = 5000;
const FAIL_RATE = 0.2;
const MIN_FINISHED = 10;
const ABS_FAILURES = 5;
const SKIPS_BEFORE_ERROR = 3;
const TICK_KEY = 'lp_health:tick';
const TICK_TTL_S = WINDOW_MIN * 60 - 60;
const WATERMARK_KEY = 'lp_health:watermark';
const WATERMARK_TTL_S = 7 * 24 * 3600;
const SYSTEM_FAILURES = new Set(['GENERATION_FAILED', 'RENDER_FAILED', 'DELIVERY_FAILED', 'QUEUE_FAILED']);
const IN_FLIGHT = new Set(['pending', 'processing']);

let skipsInARow = 0;

const anyPathOn = () => Object.values(Lifecycle.LIFECYCLE.SOURCES).some((s) => Lifecycle.enabled(s));

/** The check's own kill switch: LP_HEALTH_CHECK=off (or false / 0 / no) stops it with the lifecycle on. */
function healthCheckOff(env = process.env) {
  return ['off', 'false', '0', 'no'].includes(String(env.LP_HEALTH_CHECK || '').trim().toLowerCase());
}

/**
 * 'owner' only for the replica whose token is IN the key; 'other' or 'unavailable' otherwise. A THROWN
 * error (a broken client, not a down cache) is said at error level — it would otherwise look exactly like
 * an outage, every hour, for ever.
 */
async function claimTick(redis) {
  const token = `tick:${process.pid}:${Math.random().toString(36).slice(2)}`;
  try {
    if (!redis || (typeof redis.isAvailable === 'function' && !redis.isAvailable())) return 'unavailable';
    await redis.setNX(TICK_KEY, token, TICK_TTL_S);
    const holder = await redis.get(TICK_KEY);
    if (holder === null || holder === undefined) return 'unavailable';
    return holder === token ? 'owner' : 'other';
  } catch (error) {
    logToFile('❌ Lesson-plan health: the tick claim threw', { error: error && error.message, stack: error && error.stack }, 'error');
    return 'unavailable';
  }
}

/** [start, end) for this tick: from the watermark (or an hour) to LAG_MIN ago. */
async function tickWindow(redis, now) {
  const end = new Date(now.getTime() - LAG_MIN * 60 * 1000);
  let start = new Date(end.getTime() - WINDOW_MIN * 60 * 1000);
  try {
    const mark = await redis.get(WATERMARK_KEY);
    const at = Date.parse(typeof mark === 'string' ? mark : '');
    if (Number.isFinite(at) && at < end.getTime()) {
      start = new Date(Math.max(at, end.getTime() - MAX_CATCHUP_MIN * 60 * 1000));
    }
  } catch (error) {
    // No readable watermark: the hour before the lag (the claim already proved the cache answers). Said,
    // because a watermark that stays unreadable means every tick reads the last hour, not from the last one.
    logToFile('⚠️ Lesson-plan health: watermark unreadable — summarising the last hour', { error: error && error.message }, 'warn');
  }
  return { start, end };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Per path and channel, from the window's rows. Pure. Failures count only on finished asks. */
function summarize(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.source}/${r.channel || 'whatsapp'}`;
    if (!by.has(key)) {
      by.set(key, {
        source: r.source, channel: r.channel || 'whatsapp', asks: 0, delivered: 0, inFlight: 0, failed: 0,
        systemFailures: 0, codes: {}, deliverSec: [],
      });
    }
    const s = by.get(key);
    s.asks += 1;
    const inFlight = IN_FLIGHT.has(r.status);
    if (inFlight) s.inFlight += 1;
    if (r.status === 'failed') s.failed += 1;
    if (r.error_code) {
      s.codes[r.error_code] = (s.codes[r.error_code] || 0) + 1;
      if (!inFlight && SYSTEM_FAILURES.has(r.error_code)) s.systemFailures += 1;
    }
    if (r.delivered_at) {
      s.delivered += 1;
      const sec = (Date.parse(r.delivered_at) - Date.parse(r.created_at)) / 1000;
      if (Number.isFinite(sec) && sec >= 0) s.deliverSec.push(sec);
    }
  }
  return [...by.values()].map(({ deliverSec, ...s }) => {
    const finished = s.asks - s.inFlight;
    const sorted = deliverSec.sort((a, b) => a - b);
    return {
      ...s,
      systemFailureRate: finished > 0 ? Math.round((s.systemFailures / finished) * 1000) / 1000 : 0,
      p50DeliverSec: percentile(sorted, 0.5),
      p90DeliverSec: percentile(sorted, 0.9),
    };
  });
}

function verdictFor(sources, stuck) {
  const reasons = [];
  if (stuck > 0) reasons.push('stuck');
  for (const s of sources) {
    const finished = s.asks - s.inFlight;
    const byRate = finished >= MIN_FINISHED && s.systemFailureRate >= FAIL_RATE;
    if (byRate || s.systemFailures >= ABS_FAILURES) reasons.push(`failure_rate:${s.source}/${s.channel}`);
  }
  return { verdict: reasons.length ? 'degraded' : 'healthy', reasons };
}

/**
 * The window [start, end), read and summarised: { ok: true, verdict, reasons, stuck, rowsRead, truncated,
 * sources } or { ok: false, error } when a read failed. `stuck` counts the requests that crossed
 * STUCK_HOURS still in flight during the window. Two reads; no claim, no event.
 */
async function snapshot({ start, end, db = supabase }) {
  const stuckFrom = new Date(start.getTime() - STUCK_HOURS * 60 * 60 * 1000).toISOString();
  const stuckTo = new Date(end.getTime() - STUCK_HOURS * 60 * 60 * 1000).toISOString();
  const [win, stuckRead] = await Promise.all([
    db.from('lesson_plan_requests')
      .select('source, channel, status, error_code, created_at, delivered_at')
      .not('source', 'is', null)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    db.from('lesson_plan_requests')
      .select('id', { count: 'exact', head: true })
      .in('status', [...IN_FLIGHT])
      .not('source', 'is', null)
      .gte('created_at', stuckFrom)
      .lt('created_at', stuckTo),
  ]);
  const failedRead = (win && win.error) || (stuckRead && stuckRead.error);
  if (failedRead) return { ok: false, error: failedRead.message, code: failedRead.code };

  const rows = (win && win.data) || [];
  const stuck = Number((stuckRead && stuckRead.count) || 0);
  const sources = summarize(rows);
  const { verdict, reasons } = verdictFor(sources, stuck);
  return { ok: true, verdict, reasons, stuck, rowsRead: rows.length, truncated: rows.length >= MAX_ROWS, sources };
}

function skipped(reason) {
  if (reason === 'unavailable') {
    skipsInARow += 1;
    const level = skipsInARow >= SKIPS_BEFORE_ERROR ? 'error' : 'warn';
    logToFile(`${level === 'error' ? '❌' : '⚠️'} Lesson-plan health: cache unavailable — tick skipped`, { skipsInARow }, level);
  }
  return { outcome: 'skipped', reason };
}

/**
 * One tick. Resolves { outcome: 'off' | 'skipped' | 'read_failed' | 'checked' | 'error', ... }.
 *
 * @param {{ now?: Date, redis?: object, db?: object }} deps injectable for the suite
 */
async function run({ now = new Date(), redis, db = supabase } = {}) {
  try {
    if (healthCheckOff() || !anyPathOn()) return { outcome: 'off' };
    const cache = redis || require('../cache/railway-redis.service');
    const claim = await claimTick(cache);
    if (claim !== 'owner') return skipped(claim);
    skipsInARow = 0;

    const { start, end } = await tickWindow(cache, now);
    if (end.getTime() - start.getTime() < MIN_WINDOW_MIN * 60 * 1000) return skipped('too_soon');

    const snap = await snapshot({ start, end, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health: read failed — no summary for this window', { error: snap.error, code: snap.code }, 'error');
      return { outcome: 'read_failed', error: snap.error };
    }
    const { verdict, reasons, stuck, sources } = snap;
    const windowMin = Math.round((end.getTime() - start.getTime()) / 60000);
    logEvent('lesson_plan.health.checked', {
      windowStart: start.toISOString(), windowEnd: end.toISOString(), windowMin, verdict, reasons, stuck,
      rowsRead: snap.rowsRead, truncated: snap.truncated, sources,
    });
    if (verdict !== 'healthy') {
      logToFile(`⚠️ Lesson-plan health: ${reasons.join(', ')}`, { verdict, reasons, stuck, sources }, 'error');
    }
    try {
      await cache.set(WATERMARK_KEY, end.toISOString(), WATERMARK_TTL_S);
    } catch (error) {
      logToFile('⚠️ Lesson-plan health: could not move the watermark — the next tick re-reads this window', { error: error && error.message }, 'warn');
    }
    return { outcome: 'checked', verdict, reasons, stuck, sources };
  } catch (error) {
    logToFile('❌ Lesson-plan health: tick failed', { error: error && error.message, stack: error && error.stack }, 'error');
    return { outcome: 'error', error: error && error.message };
  }
}

/**
 * The on-demand view (GET /api/internal/lp/health): { status: 'off' } until a path is switched on;
 * otherwise the last hour up to now — { status: verdict, windowStart, windowEnd, windowMin, reasons,
 * stuck, rowsRead, truncated, sources, checkedAt } — or { status: 'read_failed', error }. Never throws.
 */
async function onDemand({ now = new Date(), db = supabase } = {}) {
  try {
    if (!anyPathOn()) return { status: 'off' };
    const start = new Date(now.getTime() - WINDOW_MIN * 60 * 1000);
    const snap = await snapshot({ start, end: now, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health (on demand): read failed', { error: snap.error, code: snap.code }, 'error');
      return { status: 'read_failed', error: snap.error };
    }
    const { ok, verdict, ...rest } = snap;
    return {
      status: verdict, windowStart: start.toISOString(), windowEnd: now.toISOString(), windowMin: WINDOW_MIN,
      ...rest, checkedAt: now.toISOString(),
    };
  } catch (error) {
    logToFile('❌ Lesson-plan health (on demand) failed', { error: error && error.message }, 'error');
    return { status: 'read_failed', error: error && error.message };
  }
}

/** Test seam: forget the consecutive-skip count. */
function __resetForTests() {
  skipsInARow = 0;
}

module.exports = { run, onDemand, healthCheckOff, __resetForTests };
