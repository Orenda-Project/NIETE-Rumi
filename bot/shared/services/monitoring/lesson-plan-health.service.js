'use strict';
/**
 * Lesson-plan health — one summary an hour of every lesson-plan path that writes the lifecycle, read
 * from lesson_plan_requests itself.
 *
 * WHY. Until the lifecycle, NIETE had no lesson-plan health signal at all. With LP_LIFECYCLE_PATHS on,
 * every path writes its asks to one table, so one bounded read an hour can say, per path and channel:
 * how many asks, how many delivered, how many failed and why, how long delivery took — and whether any
 * request is stuck.
 *
 * WHAT IT EMITS. `lesson_plan.health.checked` (Axiom), every tick: { windowMin, verdict, reasons,
 * stuck, rowsRead, truncated, sources: [{ source, channel, asks, delivered, inFlight, failed,
 * systemFailures, systemFailureRate, codes, p50DeliverSec, p90DeliverSec }] }. Not healthy, it is
 * also said at error level, which is what an Axiom monitor pages on.
 *
 *   degraded — any request stuck pending/processing longer than STUCK_HOURS (reason 'stuck'), or a
 *              path/channel whose SYSTEM failures are >= FAIL_RATE of >= MIN_FINISHED finished asks
 *              (reason 'failure_rate:<path>/<channel>'). NO_ASSET (the plan is not there yet) and
 *              NOT_ELIGIBLE (held, or not for her) are content answers: reported, never counted.
 *
 * HOW IT RUNS. The sqs-worker's main-queue replicas call run() hourly and once after boot. Exactly one
 * replica reads per tick — a read-back claim in Redis, because the shared Redis service's setNX
 * answers TRUE when Redis is down (right for de-dup elsewhere, wrong for a monitor: every replica
 * would report). A cache that cannot answer is a skip, logged.
 *
 * SWITCHES. A no-op until LP_LIFECYCLE_PATHS switches a path on; LP_HEALTH_CHECK=off stops the hourly tick
 * alone. The on-demand view (onDemand, GET /api/internal/lp/health) answers whenever a path is on.
 *
 * LOAD. Off (no path switched on): nothing at all. On: one claim, one read of the last hour's rows
 * that carry a path (newest first, at most MAX_ROWS; idx_lp_requests_source_created), and one head
 * count of stuck rows (idx_lp_requests_status) — two reads an hour across the whole fleet.
 *
 * Never throws: every failure resolves to an outcome and is logged.
 */

const supabase = require('../../config/supabase');
const Lifecycle = require('../lesson-plan-lifecycle.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const WINDOW_MIN = 60;
const STUCK_HOURS = 6;
const MAX_ROWS = 5000;
const FAIL_RATE = 0.2;
const MIN_FINISHED = 10;
const TICK_KEY = 'lp_health:tick';
const TICK_TTL_S = WINDOW_MIN * 60 - 60;
const SYSTEM_FAILURES = new Set(['GENERATION_FAILED', 'RENDER_FAILED', 'DELIVERY_FAILED', 'QUEUE_FAILED']);
const IN_FLIGHT = new Set(['pending', 'processing']);

const anyPathOn = () => Object.values(Lifecycle.LIFECYCLE.SOURCES).some((s) => Lifecycle.enabled(s));

/** The check's own kill switch: LP_HEALTH_CHECK=off (or false / 0 / no) stops it with the lifecycle on. */
function healthCheckOff(env = process.env) {
  return ['off', 'false', '0', 'no'].includes(String(env.LP_HEALTH_CHECK || '').trim().toLowerCase());
}

/** 'owner' only for the replica whose token is IN the key; 'other' / 'unavailable' otherwise. */
async function claimTick(redis) {
  const token = `tick:${process.pid}:${Math.random().toString(36).slice(2)}`;
  try {
    if (!redis || (typeof redis.isAvailable === 'function' && !redis.isAvailable())) return 'unavailable';
    await redis.setNX(TICK_KEY, token, TICK_TTL_S);
    const holder = await redis.get(TICK_KEY);
    if (holder === null || holder === undefined) return 'unavailable';
    return holder === token ? 'owner' : 'other';
  } catch (_) {
    return 'unavailable';
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/** Per path and channel, from the hour's rows. Pure. */
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
    if (IN_FLIGHT.has(r.status)) s.inFlight += 1;
    if (r.status === 'failed') s.failed += 1;
    if (r.error_code) {
      s.codes[r.error_code] = (s.codes[r.error_code] || 0) + 1;
      if (SYSTEM_FAILURES.has(r.error_code)) s.systemFailures += 1;
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
    if (finished >= MIN_FINISHED && s.systemFailureRate >= FAIL_RATE) reasons.push(`failure_rate:${s.source}/${s.channel}`);
  }
  return { verdict: reasons.length ? 'degraded' : 'healthy', reasons };
}

/**
 * The last hour, read and summarised: { ok: true, verdict, reasons, stuck, rowsRead, truncated, sources }
 * or { ok: false, error } when a read failed. Two reads; no claim, no event — the tick and the on-demand
 * route both use it.
 */
async function snapshot({ now = new Date(), db = supabase } = {}) {
  const since = new Date(now.getTime() - WINDOW_MIN * 60 * 1000).toISOString();
  const stuckBefore = new Date(now.getTime() - STUCK_HOURS * 60 * 60 * 1000).toISOString();
  const [hour, stuckRead] = await Promise.all([
    db.from('lesson_plan_requests')
      .select('source, channel, status, error_code, created_at, delivered_at')
      .not('source', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    db.from('lesson_plan_requests')
      .select('id', { count: 'exact', head: true })
      .in('status', [...IN_FLIGHT])
      .not('source', 'is', null)
      .lt('created_at', stuckBefore),
  ]);
  const failedRead = (hour && hour.error) || (stuckRead && stuckRead.error);
  if (failedRead) return { ok: false, error: failedRead.message, code: failedRead.code };

  const rows = (hour && hour.data) || [];
  const stuck = Number((stuckRead && stuckRead.count) || 0);
  const sources = summarize(rows);
  const { verdict, reasons } = verdictFor(sources, stuck);
  return { ok: true, verdict, reasons, stuck, rowsRead: rows.length, truncated: rows.length >= MAX_ROWS, sources };
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
    if (claim !== 'owner') {
      if (claim === 'unavailable') logToFile('Lesson-plan health: cache unavailable — tick skipped', {});
      return { outcome: 'skipped', reason: claim };
    }

    const snap = await snapshot({ now, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health: read failed — no summary this hour', { error: snap.error, code: snap.code }, 'error');
      return { outcome: 'read_failed', error: snap.error };
    }
    const { verdict, reasons, stuck, sources } = snap;
    logEvent('lesson_plan.health.checked', {
      windowMin: WINDOW_MIN, verdict, reasons, stuck, rowsRead: snap.rowsRead, truncated: snap.truncated, sources,
    });
    if (verdict !== 'healthy') {
      logToFile(`⚠️ Lesson-plan health: ${reasons.join(', ')}`, { verdict, reasons, stuck, sources }, 'error');
    }
    return { outcome: 'checked', verdict, reasons, stuck, sources };
  } catch (error) {
    logToFile('❌ Lesson-plan health: tick failed', { error: error && error.message }, 'error');
    return { outcome: 'error', error: error && error.message };
  }
}

/**
 * The on-demand view (GET /api/internal/lp/health): { status: 'off' } until a path is switched on;
 * otherwise { status: verdict, windowMin, reasons, stuck, rowsRead, truncated, sources, checkedAt }, or
 * { status: 'read_failed', error }. Never throws.
 */
async function onDemand({ now = new Date(), db = supabase } = {}) {
  try {
    if (!anyPathOn()) return { status: 'off' };
    const snap = await snapshot({ now, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health (on demand): read failed', { error: snap.error, code: snap.code }, 'error');
      return { status: 'read_failed', error: snap.error };
    }
    const { ok, verdict, ...rest } = snap;
    return { status: verdict, windowMin: WINDOW_MIN, ...rest, checkedAt: now.toISOString() };
  } catch (error) {
    logToFile('❌ Lesson-plan health (on demand) failed', { error: error && error.message }, 'error');
    return { status: 'read_failed', error: error && error.message };
  }
}

module.exports = { run, onDemand, healthCheckOff };
