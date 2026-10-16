'use strict';
/**
 * Lesson-plan health — one summary an hour of every lesson-plan path that writes the lifecycle, read
 * from lesson_plan_requests itself, and a message to a person when it is not healthy.
 *
 * WHY. Until the lifecycle, NIETE had no lesson-plan health signal at all. With LP_LIFECYCLE_PATHS on,
 * every path writes its asks to one table, so one bounded read an hour can say, per path and channel:
 * how many asks, how many delivered, how many failed and why, how long delivery took — and whether any
 * request has got stuck.
 *
 * WHAT IT EMITS. `lesson_plan.health.checked` (Axiom), every tick: { windowStart, windowEnd, windowMin,
 * verdict, reasons, stuck, rowsRead, truncated, sources: [{ source, channel, asks, delivered, inFlight,
 * failed, systemFailures, systemFailureRate, codes, p50DeliverSec, p90DeliverSec }], down: [{ source,
 * channel, attempts, teachers, latestId, latestAt, code }], writeFailures: { count, codes } | null }.
 * Not healthy, it is also said at error level and sent to Slack (THE ALERT, below).
 *
 *   degraded — a request crossed STUCK_HOURS still pending/processing during the window (reason 'stuck';
 *              each one is reported once, in the window it crosses, never every hour after), or a
 *              path/channel whose SYSTEM failures are >= FAIL_RATE of >= MIN_FINISHED finished asks, or
 *              >= ABS_FAILURES in the window whatever the volume (reason 'failure_rate:<path>/<channel>').
 *              Only finished asks count: a code on a request still in flight is not yet an outcome.
 *              NO_ASSET (the plan is not there yet) and NOT_ELIGIBLE (held, or not for her) are content
 *              answers: reported, never counted.
 *            — a QUIET path that has stopped delivering (reason 'down:<path>/<channel>'): its last
 *              DOWN_ATTEMPTS attempts failed with nothing delivered in between, within DOWN_LOOKBACK_H. The
 *              window rules cannot see a path that rare: on the 2026-10-14 sandbox run a curriculum ask
 *              failed all three attempts and its hour read "asks 2, failed 1, rate 0.5" — healthy. A
 *              curriculum ask that failed every attempt counts as its attempts; content answers and asks
 *              in flight neither count nor break the run. A run needs a second teacher, unless one ask failed
 *              every one of its own attempts: failures cluster on a few phones (in production, September
 *              2026, 771 failed menu sends came from 51 teachers), and one teacher tapping a send that keeps
 *              failing is her problem, not the path's. A path the window flags keeps that one reason.
 *            — >= WRITE_FAILED_MIN lifecycle writes failed in the window (reason 'write_failed'), counted
 *              from the `lesson_plan.lifecycle.write_failed` events in Axiom, in this deployment's dataset
 *              and env: the writers run in the web service and in the workers, so no one process sees
 *              them all. No Axiom token, or a count that fails, leaves writeFailures null — the check
 *              goes on without it.
 *
 * THE ALERT. A tick that is not healthy sends ONE Slack message through the quiz funnel watcher's path
 * (quiz-funnel-watch.service): its target (QUIZ_FUNNEL_WATCH_SLACK_TOKEN/CHANNEL, falling back to
 * PROD_DIGEST_SLACK_TOKEN/CHANNEL), its sender and its clock. It names every reason not already sent: the
 * same path or reason at most once in ALERT_DEDUP_H; a down path once per newest failure, so a quiet path
 * that stays down is not paged again all day; a 6-12 incident once between this check and the quiz
 * watcher (which pages 6-12 delivery failures itself), whichever sees it first. No target, or
 * LP_HEALTH_ALERT=off: nothing is sent. A post that fails, or takes over POST_TIMEOUT_MS, is said at error
 * level and not marked sent, so the next tick sends it. Each outcome is a `lesson_plan.health.alert` event.
 *
 * THE WINDOW. Each tick summarises the asks made between where the previous tick stopped (a watermark in
 * Redis) and LAG_MIN ago — so ticks neither overlap nor leave a gap across redeploys, and an ask made just
 * before a tick is counted once its outcome has landed. No watermark (first run, or it expired): the hour
 * before the lag. A long outage catches up at most MAX_CATCHUP_MIN.
 *
 * HOW IT RUNS. The sqs-worker's main-queue replicas call run() hourly and once after boot. Exactly one
 * replica reads per tick — the quiz funnel watcher's read-back claim in Redis, under this check's own key,
 * because the shared Redis service's setNX answers TRUE when Redis is down (right for de-dup elsewhere,
 * wrong for a monitor: every replica would report).
 * A cache that cannot answer is a skip, warned every time and said at error level from the third skip in
 * a row: a check that silently never runs is the failure this exists to prevent.
 *
 * SWITCHES. A no-op until LP_LIFECYCLE_PATHS switches a path on; LP_HEALTH_CHECK=off stops the hourly tick
 * alone; LP_HEALTH_ALERT=off keeps the tick and stops the message. The on-demand view (onDemand,
 * GET /api/internal/lp/health) answers whenever a path is on, for the last hour up to now; it counts no
 * write failures and sends nothing.
 *
 * LOAD. Off (no path switched on): nothing at all. On: one claim, one read of the window's rows that carry
 * a path and one of the last day's (newest first, at most MAX_ROWS each; idx_lp_requests_source_created),
 * one head count of newly stuck rows (idx_lp_requests_status) — three reads an hour across the whole
 * fleet — and one Axiom count. A day of more than MAX_ROWS asks reads the newest MAX_ROWS for the down
 * rule: a busy path's run is read whole, a rare path's older asks can drop out of it.
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
// PostgREST answers at most db-max-rows (1,000 on NIETE) whatever .limit() asks for: a full page is a
// truncated read, never a complete one.
const MAX_ROWS = 1000;
/** The grounded queue's attempts (the worker's limit): fewer = a retry follows. */
const { MAX_ATTEMPTS: GROUNDED_MAX_RETRIES } = require('../../config/lesson-plan-generation');
const FAIL_RATE = 0.2;
const MIN_FINISHED = 10;
const ABS_FAILURES = 5;
/** A path is down when its last DOWN_ATTEMPTS attempts failed with nothing delivered in between… */
const DOWN_ATTEMPTS = 3;
/** …looking back this far. */
const DOWN_LOOKBACK_H = 24;
const WRITE_FAILED_MIN = 5;
const SKIPS_BEFORE_ERROR = 3;
const TICK_KEY = 'lp_health:tick';
// The quiz watcher's claim lives one tick less a minute: given the hour, 59 minutes.
const TICK = Object.freeze({ tickMin: WINDOW_MIN });
const WATERMARK_KEY = 'lp_health:watermark';
const WATERMARK_TTL_S = 7 * 24 * 3600;
const ALERT_DEDUP_H = 2;
const ALERT_KEY = (key) => `lp_health:alert:${key}`;
const POST_TIMEOUT_MS = 15 * 1000;
const AXIOM_TIMEOUT_MS = 15 * 1000;
const SYSTEM_FAILURES = new Set(['GENERATION_FAILED', 'RENDER_FAILED', 'DELIVERY_FAILED', 'QUEUE_FAILED']);
const IN_FLIGHT = new Set(['pending', 'processing']);

let skipsInARow = 0;
let unwiredSaid = false;
let noAxiomSaid = false;

// Required on first use, by the tick alone: the web service loads this file for the on-demand view.
const watch = () => require('./quiz-funnel-watch.service');

const anyPathOn = () => Object.values(Lifecycle.LIFECYCLE.SOURCES).some((s) => Lifecycle.enabled(s));

/**
 * The kill switches, with the lifecycle on: LP_HEALTH_CHECK=off (or false / 0 / no / none) stops the
 * check; LP_HEALTH_ALERT=off stops only its message.
 */
const HEALTH_OFF_WORDS = ['off', 'false', '0', 'no', 'none'];
const HEALTH_ON_WORDS = ['', 'on', 'true', '1', 'yes'];
const SWITCHES = Object.freeze({
  LP_HEALTH_CHECK: 'the lesson-plan health check',
  LP_HEALTH_ALERT: 'the lesson-plan health alert',
});
const unknownSwitchSaid = new Set();
function switchedOff(name, env) {
  const v = String(env[name] || '').trim().toLowerCase();
  if (HEALTH_OFF_WORDS.includes(v)) return true;
  if (!HEALTH_ON_WORDS.includes(v) && !unknownSwitchSaid.has(name)) {
    // Not a word this switch knows: it stays on (as before), and says so once.
    unknownSwitchSaid.add(name);
    logToFile(`⚠️ ${name} has a value it does not know — ${SWITCHES[name]} keeps running; use off to stop it`,
      { value: v.slice(0, 40) }, 'warn');
  }
  return false;
}
const healthCheckOff = (env = process.env) => switchedOff('LP_HEALTH_CHECK', env);
const healthAlertOff = (env = process.env) => switchedOff('LP_HEALTH_ALERT', env);

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

/** Where one row stands. Pure. */
function standing(r) {
  // A job that never reached the queue is finished (and ours); a grounded render that failed with
  // attempts left is still in flight (the queue retries it).
  const neverQueued = r.status === 'pending' && r.error_code === 'QUEUE_FAILED';
  const retrying = r.status === 'failed' && r.source === Lifecycle.LIFECYCLE.SOURCES.NIETE_GROUNDED
    && Number(r.retry_count || 0) < GROUNDED_MAX_RETRIES;
  return { neverQueued, retrying, inFlight: (IN_FLIGHT.has(r.status) && !neverQueued) || retrying };
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
    const { neverQueued, retrying, inFlight } = standing(r);
    if (inFlight) s.inFlight += 1;
    if ((r.status === 'failed' && !retrying) || neverQueued) s.failed += 1;
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

/**
 * Per path and channel, from the last day's rows newest first: the failed attempts in a row since the
 * path last delivered — only the runs of at least DOWN_ATTEMPTS, from at least two teachers or with one
 * ask that failed all of them. Pure. An ask in flight, or answered with content (NO_ASSET,
 * NOT_ELIGIBLE), neither proves the path works nor that it is broken: skipped.
 */
function downPaths(rows) {
  const runs = new Map();
  for (const r of rows) {
    const channel = r.channel || 'whatsapp';
    const key = `${r.source}/${channel}`;
    if (!runs.has(key)) {
      runs.set(key, {
        source: r.source, channel, attempts: 0, latestId: null, latestAt: null, code: null, over: false, teachers: new Set(), longest: 0,
      });
    }
    const run = runs.get(key);
    if (run.over) continue;
    // Delivered is delivered_at, never the status: the queue keeps a plan WhatsApp refused 'completed'
    // (it reads that status) and says DELIVERY_FAILED — a failed attempt.
    if (r.delivered_at) { run.over = true; continue; }
    if (standing(r).inFlight || !SYSTEM_FAILURES.has(r.error_code)) continue;
    // A curriculum ask that failed every attempt is that many failed attempts; any other ask is one.
    const tries = Math.max(1, Number(r.retry_count) || 0);
    run.attempts += tries;
    run.longest = Math.max(run.longest, tries);
    run.teachers.add(r.user_id || r.id);
    if (!run.latestId) Object.assign(run, { latestId: r.id, latestAt: r.created_at, code: r.error_code });
  }
  return [...runs.values()]
    .filter((r) => r.attempts >= DOWN_ATTEMPTS && (r.teachers.size >= 2 || r.longest >= DOWN_ATTEMPTS))
    .map(({ over, longest, teachers, ...r }) => ({ ...r, teachers: teachers.size }));
}

function verdictFor(sources, stuck, truncated = false, down = []) {
  const reasons = [];
  // A read that hit MAX_ROWS has not seen the whole window: whatever it did not read could be failing.
  if (truncated) reasons.push('truncated');
  if (stuck > 0) reasons.push('stuck');
  const flagged = new Set();
  for (const s of sources) {
    const finished = s.asks - s.inFlight;
    const byRate = finished >= MIN_FINISHED && s.systemFailureRate >= FAIL_RATE;
    if (byRate || s.systemFailures >= ABS_FAILURES) {
      reasons.push(`failure_rate:${s.source}/${s.channel}`);
      flagged.add(`${s.source}/${s.channel}`);
    }
  }
  for (const d of down) if (!flagged.has(`${d.source}/${d.channel}`)) reasons.push(`down:${d.source}/${d.channel}`);
  return { verdict: reasons.length ? 'degraded' : 'healthy', reasons };
}

/**
 * The window [start, end), read and summarised: { ok: true, verdict, reasons, stuck, rowsRead, truncated,
 * sources, down } or { ok: false, error } when a read failed. `stuck` counts the requests that crossed
 * STUCK_HOURS still in flight during the window; `down` the paths whose last attempts failed, from the
 * DOWN_LOOKBACK_H before `end`. Three reads; no claim, no event.
 */
async function snapshot({ start, end, db = supabase }) {
  const stuckFrom = new Date(start.getTime() - STUCK_HOURS * 60 * 60 * 1000).toISOString();
  const stuckTo = new Date(end.getTime() - STUCK_HOURS * 60 * 60 * 1000).toISOString();
  const dayFrom = new Date(end.getTime() - DOWN_LOOKBACK_H * 60 * 60 * 1000).toISOString();
  const [win, stuckRead, day] = await Promise.all([
    db.from('lesson_plan_requests')
      .select('source, channel, status, error_code, retry_count, created_at, delivered_at')
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
    db.from('lesson_plan_requests')
      .select('id, user_id, source, channel, status, error_code, retry_count, created_at, delivered_at')
      .not('source', 'is', null)
      .gte('created_at', dayFrom)
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
  ]);
  const failedRead = (win && win.error) || (stuckRead && stuckRead.error) || (day && day.error);
  if (failedRead) return { ok: false, error: failedRead.message, code: failedRead.code };

  const rows = (win && win.data) || [];
  const stuck = Number((stuckRead && stuckRead.count) || 0);
  const sources = summarize(rows);
  const down = downPaths((day && day.data) || []);
  const truncated = rows.length >= MAX_ROWS;
  const { verdict, reasons } = verdictFor(sources, stuck, truncated, down);
  return { ok: true, verdict, reasons, stuck, rowsRead: rows.length, truncated, sources, down };
}

/** `promise`, or a rejection after `ms`: a call that hangs must not hold the tick. */
function within(ms, promise) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * The lifecycle writes that failed in [start, end): { count, codes }, from the write_failed events in
 * Axiom (this deployment's dataset and env) — or null with no token or when the count failed (said at
 * warn level). Never throws.
 */
async function countWriteFailures({ start, end, env = process.env }) {
  if (!(env.AXIOM_API_TOKEN || env.AXIOM_TOKEN)) {
    if (!noAxiomSaid) {
      noAxiomSaid = true;
      logToFile('⚠️ Lesson-plan health: no Axiom token — lifecycle write failures are not counted', {}, 'warn');
    }
    return null;
  }
  const apl = `['${env.AXIOM_DATASET || 'niete-logs'}'] | where env == '${env.NODE_ENV || 'production'}' `
    + "| where msg == 'lesson_plan.lifecycle.write_failed' | extend d = parse_json(data_json) "
    + '| summarize n = count() by code = tostring(d.code), source = tostring(d.source)';
  try {
    const rows = await within(AXIOM_TIMEOUT_MS, watch().axiomQuery('lp_write_failed', apl, start.toISOString(), end.toISOString(), env));
    const codes = {};
    let count = 0;
    for (const r of rows || []) {
      const n = Number(r.n) || 0;
      const code = r.code || 'UNKNOWN';
      count += n;
      codes[code] = (codes[code] || 0) + n;
    }
    return { count, codes };
  } catch (error) {
    logToFile('⚠️ Lesson-plan health: could not count lifecycle write failures — the check goes on without them',
      { error: error && error.message }, 'warn');
    return null;
  }
}

// ─── the alert ───────────────────────────────────────────────────────────────

const PATH_NAMES = Object.freeze({
  niete_grounded: 'Curriculum plans',
  niete_v8_segment: 'Grade 1-5 plans',
  niete_lp612: 'Grade 6-12 plans',
  niete_oxbridge: 'Oxbridge plans',
  niete_portal_share: 'Portal shares',
  pre_gen_chapter: 'Pre-generated chapter plans',
  homework_bundle: 'Homework bundles',
});
const CHANNEL_NAMES = Object.freeze({ whatsapp: 'WhatsApp', portal: 'Portal' });
const pathName = (source) => PATH_NAMES[source] || source;
const channelName = (channel) => CHANNEL_NAMES[channel] || channel;
const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "CODE n, CODE n", the largest first; `only` keeps a subset of codes. */
function codesLine(codes, only = null) {
  return Object.entries(codes || {})
    .filter(([code]) => !only || only.has(code))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([code, n]) => `${code} ${n}`)
    .join(', ');
}

/**
 * What each reason says to a person, and the keys it is de-duplicated under: `key` for two hours, a
 * down path's newest failure (`seenKey`) for the lookback. Pure. Names no teacher, ask or request.
 */
function incidentsFor({ reasons, sources, down, stuck, writeFailures, start, end }) {
  const { hhmm } = watch();
  const between = `between ${hhmm(start)} and ${hhmm(end)} PKT`;
  const out = [];
  for (const reason of reasons) {
    const colon = reason.indexOf(':');
    const kind = colon < 0 ? reason : reason.slice(0, colon);
    const path = colon < 0 ? null : reason.slice(colon + 1);
    if (kind === 'failure_rate') {
      const s = sources.find((x) => `${x.source}/${x.channel}` === path);
      if (!s) continue;
      out.push({
        reason, key: `path:${path}`, source: s.source,
        text: `*${pathName(s.source)}* · ${channelName(s.channel)} — ${s.systemFailures} of ${s.asks - s.inFlight} finished asks `
          + `failed (${Math.round(s.systemFailureRate * 100)}%) ${between} · ${codesLine(s.codes, SYSTEM_FAILURES)}`,
      });
    } else if (kind === 'down') {
      const d = down.find((x) => `${x.source}/${x.channel}` === path);
      if (!d) continue;
      out.push({
        reason, key: `path:${path}`, seenKey: `down:${path}:${d.latestId}`, source: d.source,
        text: `*${pathName(d.source)}* · ${channelName(d.channel)} — the last ${d.attempts} attempts failed and nothing was `
          + `delivered in between (newest ask ${hhmm(new Date(d.latestAt))} PKT · ${d.code})`,
      });
    } else if (kind === 'stuck') {
      out.push({ reason, key: 'stuck', text: `*Stuck* — ${countOf(stuck, 'ask', 'asks')} still waiting after ${STUCK_HOURS} hours` });
    } else if (kind === 'truncated') {
      const cap = MAX_ROWS.toLocaleString('en-US');
      out.push({ reason, key: 'truncated', text: `*Check incomplete* — over ${cap} asks ${between}; only the newest ${cap} were read` });
    } else if (kind === 'write_failed' && writeFailures) {
      out.push({
        reason, key: 'write_failed',
        text: `*Lifecycle record* — ${countOf(writeFailures.count, 'write', 'writes')} failed ${between} · ${codesLine(writeFailures.codes)}`,
      });
    }
  }
  return out;
}

/** The quiz watcher's key for a 6-12 incident: whichever of the two pages it first, the other does not. */
const watcherKey = (i) => (i.source === Lifecycle.LIFECYCLE.SOURCES.NIETE_LP612 ? watch().ALERT_KEY({ kind: 'lp612_failed' }) : null);

async function readKey(cache, key) {
  try { return await cache.get(key); } catch { return null; }
}

/** { fresh, already }: the incidents not sent yet, and the ones sent here or by the quiz watcher. Reads only. */
async function partition(incidents, cache) {
  const fresh = [];
  const already = [];
  for (const i of incidents) {
    const keys = [ALERT_KEY(i.key), i.seenKey && ALERT_KEY(i.seenKey), watcherKey(i)].filter(Boolean);
    let sent = false;
    for (const k of keys) {
      if (await readKey(cache, k)) { sent = true; break; }
    }
    (sent ? already : fresh).push(i);
  }
  return { fresh, already };
}

async function markSent(incidents, cache, env) {
  const watcherTtlS = watch().config(env).kindDedupMin * 60;
  for (const i of incidents) {
    const writes = [[ALERT_KEY(i.key), ALERT_DEDUP_H * 3600]];
    if (i.seenKey) writes.push([ALERT_KEY(i.seenKey), DOWN_LOOKBACK_H * 3600]);
    if (watcherKey(i)) writes.push([watcherKey(i), watcherTtlS]);
    for (const [key, ttl] of writes) {
      try {
        // The real wrapper answers false (it never throws) when it could not store the key.
        if ((await cache.set(key, '1', ttl)) === false) throw new Error('not stored');
      } catch (error) {
        logToFile('⚠️ Lesson-plan health: could not record an alert as sent — it may be sent again', { reason: i.reason, error: error && error.message }, 'warn');
      }
    }
  }
}

/**
 * Tell a person: ONE Slack message naming every reason not already sent. Resolves { outcome: 'off' |
 * 'unwired' | 'deduped' | 'sent' | 'failed', reasons?, alreadyReported? }. Never throws.
 */
async function alert({ now, snap, reasons, writeFailures, start, end, cache, env = process.env }) {
  try {
    if (healthAlertOff(env)) return { outcome: 'off' };
    const W = watch();
    const slack = W.slackTarget(env);
    if (!slack.token || !slack.channel) {
      if (!unwiredSaid) {
        unwiredSaid = true;
        logToFile('⚠️ Lesson-plan health: not healthy, and no Slack target is set (QUIZ_FUNNEL_WATCH_SLACK_TOKEN/CHANNEL '
          + 'or PROD_DIGEST_SLACK_TOKEN/CHANNEL) — nobody was told', { reasons }, 'warn');
      }
      return { outcome: 'unwired' };
    }
    const incidents = incidentsFor({ reasons, sources: snap.sources, down: snap.down, stuck: snap.stuck, writeFailures, start, end });
    const { fresh, already } = await partition(incidents, cache);
    const alreadyReported = already.map((i) => i.reason);
    if (!fresh.length) return { outcome: 'deduped', alreadyReported };
    const sending = fresh.map((i) => i.reason);
    const text = [`⚠️ *Lesson plans — needs a look* · ${W.hhmm(now)} PKT`, ...fresh.map((i) => `• ${i.text}`)].join('\n');
    try {
      await within(POST_TIMEOUT_MS, W.postToSlack(text, slack));
    } catch (error) {
      // Not recorded as sent: the next tick sends it. (A post that answers after the timeout can arrive
      // twice; a monitor that goes quiet when Slack is slow is the wrong way round.)
      logToFile('❌ Lesson-plan health: the Slack alert failed — the next tick sends it again', { error: error && error.message, reasons: sending }, 'error');
      return { outcome: 'failed', reasons: sending, alreadyReported };
    }
    await markSent(fresh, cache, env);
    return { outcome: 'sent', reasons: sending, alreadyReported };
  } catch (error) {
    logToFile('❌ Lesson-plan health: the alert failed', { error: error && error.message, stack: error && error.stack }, 'error');
    return { outcome: 'failed' };
  }
}

function skipped(reason) {
  // Another replica holds the tick: the cache answered, so a run of cache failures is broken.
  if (reason === 'other') skipsInARow = 0;
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
    const claim = await watch().claimTick(cache, TICK, TICK_KEY);
    if (claim !== 'owner') return skipped(claim);
    skipsInARow = 0;

    const { start, end } = await tickWindow(cache, now);
    if (end.getTime() - start.getTime() < MIN_WINDOW_MIN * 60 * 1000) return skipped('too_soon');

    const snap = await snapshot({ start, end, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health: read failed — no summary for this window', { error: snap.error, code: snap.code }, 'error');
      return { outcome: 'read_failed', error: snap.error };
    }
    const { stuck, sources, down } = snap;
    const writeFailures = await countWriteFailures({ start, end });
    const reasons = [...snap.reasons];
    if (writeFailures && writeFailures.count >= WRITE_FAILED_MIN) reasons.push('write_failed');
    const verdict = reasons.length ? 'degraded' : 'healthy';
    const windowMin = Math.round((end.getTime() - start.getTime()) / 60000);
    logEvent('lesson_plan.health.checked', {
      windowStart: start.toISOString(), windowEnd: end.toISOString(), windowMin, verdict, reasons, stuck,
      rowsRead: snap.rowsRead, truncated: snap.truncated, sources, down, writeFailures,
    });
    let told = null;
    if (verdict !== 'healthy') {
      logToFile(`⚠️ Lesson-plan health: ${reasons.join(', ')}`, { verdict, reasons, stuck, sources, down, writeFailures }, 'error');
      told = await alert({ now, snap, reasons, writeFailures, start, end, cache });
      logEvent('lesson_plan.health.alert', { verdict, ...told });
    }
    try {
      // The real wrapper answers false (it never throws) when it could not store the key.
      if ((await cache.set(WATERMARK_KEY, end.toISOString(), WATERMARK_TTL_S)) === false) {
        logToFile('⚠️ Lesson-plan health: could not move the watermark — the next tick re-reads this window', { end: end.toISOString() }, 'warn');
      }
    } catch (error) {
      logToFile('⚠️ Lesson-plan health: could not move the watermark — the next tick re-reads this window', { error: error && error.message }, 'warn');
    }
    return { outcome: 'checked', verdict, reasons, stuck, sources, down, ...(told ? { alert: told.outcome } : {}) };
  } catch (error) {
    logToFile('❌ Lesson-plan health: tick failed', { error: error && error.message, stack: error && error.stack }, 'error');
    return { outcome: 'error', error: error && error.message };
  }
}

/**
 * The on-demand view (GET /api/internal/lp/health): { status: 'off' } until a path is switched on;
 * otherwise the last hour up to now — { status: verdict, windowStart, windowEnd, windowMin, reasons,
 * stuck, rowsRead, truncated, sources, down, checkedAt } — or { status: 'read_failed', error }. Never throws.
 */
async function onDemand({ now = new Date(), db = supabase } = {}) {
  try {
    if (!anyPathOn()) return { status: 'off' };
    const start = new Date(now.getTime() - WINDOW_MIN * 60 * 1000);
    const snap = await snapshot({ start, end: now, db });
    if (!snap.ok) {
      logToFile('❌ Lesson-plan health (on demand): read failed', { error: snap.error, code: snap.code }, 'error');
      // The detail is in the log; the answer goes to a caller, and a database message is schema detail.
      return { status: 'read_failed' };
    }
    const { ok, verdict, ...rest } = snap;
    return {
      status: verdict, windowStart: start.toISOString(), windowEnd: now.toISOString(), windowMin: WINDOW_MIN,
      ...rest, checkedAt: now.toISOString(),
    };
  } catch (error) {
    logToFile('❌ Lesson-plan health (on demand) failed', { error: error && error.message }, 'error');
    return { status: 'read_failed' };
  }
}

/** Test seam: forget the consecutive-skip count. */
function __resetForTests() {
  skipsInARow = 0;
  unknownSwitchSaid.clear();
  unwiredSaid = false;
  noAxiomSaid = false;
}

module.exports = { run, onDemand, healthCheckOff, healthAlertOff, __resetForTests };
