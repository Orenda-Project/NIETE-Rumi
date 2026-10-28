'use strict';
/**
 * The nightly's protection for the database and R2 (bd-sex15q.41; COS 28 Oct 12:17Z: the NIETE prod primary, Supabase Small,
 * 2 GB RAM and 1 GB swap, was OOM-rebooted three times that morning; db-restart-rca REPORT §1).
 *   createLimiter / guardedFetch  a bounded number of PostgREST requests in flight per database, each with a timeout; GETs
 *                                 retried with backoff (idempotent), writes never retried here
 *   withRetry                     exponential backoff with jitter (R2 uploads, metrics reads)
 *   nightDeadlines                the end of night (default 00:50Z = 05:50 PKT) and each spending stage's cut-off before it,
 *                                 so the night ends inside 02:00-06:00 PKT and what is left waits for the next night
 *   createHealthGuard             the abort rule: the Supabase metrics endpoint read at most once a minute; the run stops when
 *                                 the primary's swap or available memory or the replica's lag crosses a threshold
 *   inSchoolHours                 03:00-12:00Z: no production run starts then (COS 12:17Z)
 * Logs carry reasons and numbers only: never a URL, a key or a row.
 */

const SCHOOL_HOURS_UTC = Object.freeze([3, 12]);
const DEFAULT_NIGHT_END_UTC = '00:50';
// Minutes before the end of night at which a stage starts nothing new: phonics first (it is the backfill), then glosses,
// then clips run to the end (a card without its clip loses more than a card without its line).
const STAGE_CUTOFF_MIN = Object.freeze({ phonics: 120, gloss: 75, clips: 0 });
// Thresholds (db-restart-rca §1: the third reboot followed MemAvailable 198-281 MB and swap 735-1046 MB of 1073).
const THRESHOLDS = Object.freeze({ swapUsedMb: 700, memAvailableMb: 300, replicaLagS: 300 });
const HEALTH_INTERVAL_MS = 60000;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

function createLimiter(max) {
  const cap = Math.max(1, Math.floor(Number(max) || 1));
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= cap || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return {
    run(fn) { return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); }); },
    get active() { return active; },
    get max() { return cap; },
  };
}

/** Runs fn up to `attempts` times; waits baseMs·2^i (×jitter, capped at maxMs) between tries; rethrows the last error. */
async function withRetry(fn, { attempts = 4, baseMs = 500, maxMs = 8000, sleep = sleepMs, jitter = () => 0.5 + Math.random() / 2,
  retryable = () => true } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (i === attempts - 1 || !retryable(err)) break;
      await sleep(Math.min(maxMs, Math.round(baseMs * 2 ** i * jitter())));
    }
  }
  throw last;
}

const RETRY_STATUS = (s) => s === 429 || s >= 500;

/**
 * A fetch for supabase-js (`global.fetch`): at most `maxInFlight` requests on the wire, each aborted after `timeoutMs`
 * (the request's own budget: no statement of ours outlives it on the client side), GET/HEAD retried on a network error, a
 * timeout, 429 or 5xx with backoff. Anything else is sent once: a write is never repeated by this layer.
 */
function guardedFetch({ fetch = globalThis.fetch, maxInFlight = 2, timeoutMs = 60000, retries = 3, sleep = sleepMs, baseMs = 500 } = {}) {
  const limiter = createLimiter(maxInFlight);
  const once = (url, init) => limiter.run(async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init && init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(url, { ...(init || {}), signal });
  });
  return async function fetchWithLimits(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return once(url, init);
    let res;
    await withRetry(async () => {
      res = await once(url, init);
      if (RETRY_STATUS(res.status)) throw Object.assign(new Error(`http ${res.status}`), { retryableStatus: true });
    }, { attempts: retries + 1, baseMs, sleep, retryable: (e) => !(init.signal && init.signal.aborted) && !!e })
      .catch((e) => { if (!e || !e.retryableStatus) throw e; }); // out of tries on a 5xx: hand the last response back
    return res;
  };
}

/** The end of night after `start` (`HH:MM` UTC, the next one within 24 h) and each stage's cut-off, as epoch ms. */
function nightDeadlines(start, endUtc = DEFAULT_NIGHT_END_UTC) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(endUtc || DEFAULT_NIGHT_END_UTC));
  if (!m) throw new Error('night end must be HH:MM (UTC)');
  const t0 = new Date(start).getTime();
  const d = new Date(t0);
  d.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  let end = d.getTime();
  if (end <= t0) end += 86400000;
  const out = { end };
  for (const [stage, min] of Object.entries(STAGE_CUTOFF_MIN)) out[stage] = end - min * 60000;
  return out;
}

const isoMinute = (ms) => `${new Date(ms).toISOString().slice(0, 16)}Z`;

function inSchoolHours(now) {
  const h = new Date(now).getUTCHours();
  return h >= SCHOOL_HOURS_UTC[0] && h < SCHOOL_HOURS_UTC[1];
}

/** The four series the guard reads from Supabase's Prometheus text (privileged metrics endpoint). */
function parseMetrics(text) {
  const val = (name) => {
    const m = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+(\\S+)`, 'm').exec(String(text || ''));
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  const MB = 1024 * 1024;
  const swapTotal = val('node_memory_SwapTotal_bytes');
  const swapFree = val('node_memory_SwapFree_bytes');
  const mem = val('node_memory_MemAvailable_bytes');
  return {
    swap_used_mb: swapTotal != null && swapFree != null ? Math.round((swapTotal - swapFree) / MB) : null,
    mem_available_mb: mem == null ? null : Math.round(mem / MB),
    lag_s: val('physical_replication_lag_physical_replication_lag_seconds'),
    connected: val('physical_replication_lag_is_connected_to_primary'),
  };
}

/**
 * The abort rule. check() → { ok, reason, primary, replica } with reason one of primary_swap, primary_memory, replica_lag,
 * replica_disconnected, metrics_unreadable (fails closed). One read of each endpoint per `intervalMs`, cached between.
 */
function createHealthGuard({ fetch = globalThis.fetch, primaryUrl, replicaUrl = null, key, thresholds = {}, now = () => Date.now(),
  intervalMs = HEALTH_INTERVAL_MS, sleep = sleepMs, timeoutMs = 15000 } = {}) {
  const th = { ...THRESHOLDS, ...Object.fromEntries(Object.entries(thresholds).filter(([, v]) => Number.isFinite(v))) };
  const auth = `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}`;
  let cached = null;
  let at = -Infinity;
  let measuring = null; // callers that arrive while a read is out share it (N phonics calls at once, bd-sex15q.43)
  const read = (base) => withRetry(async () => {
    const res = await fetch(`${String(base).replace(/\/+$/, '')}/customer/v1/privileged/metrics`,
      { method: 'GET', headers: { Authorization: auth }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`metrics ${res.status}`);
    return parseMetrics(await res.text());
  }, { attempts: 3, baseMs: 1000, sleep });
  async function measure() {
    let primary; let replica = null;
    try {
      primary = await read(primaryUrl);
      if (replicaUrl) replica = await read(replicaUrl);
    } catch (_) {
      return { ok: false, reason: 'metrics_unreadable', primary: null, replica: null };
    }
    const r = { primary, replica };
    if (primary.swap_used_mb == null || primary.mem_available_mb == null) return { ok: false, reason: 'metrics_unreadable', ...r };
    if (primary.swap_used_mb > th.swapUsedMb) return { ok: false, reason: 'primary_swap', ...r };
    if (primary.mem_available_mb < th.memAvailableMb) return { ok: false, reason: 'primary_memory', ...r };
    if (replica) {
      if (replica.connected === 0) return { ok: false, reason: 'replica_disconnected', ...r };
      if (replica.lag_s != null && replica.lag_s > th.replicaLagS) return { ok: false, reason: 'replica_lag', ...r };
    }
    return { ok: true, reason: null, ...r };
  }
  return {
    thresholds: th,
    async check() {
      if (cached && now() - at < intervalMs) return cached;
      if (!measuring) {
        measuring = measure().then((r) => { cached = r; at = now(); return r; }).finally(() => { measuring = null; });
      }
      return measuring;
    },
  };
}

class HealthAbort extends Error {
  constructor(stage, reason) {
    super(`health_abort stage=${stage} reason=${reason}`);
    this.name = 'HealthAbort';
    this.stage = stage;
    this.reason = reason;
  }
}

module.exports = {
  SCHOOL_HOURS_UTC, DEFAULT_NIGHT_END_UTC, STAGE_CUTOFF_MIN, THRESHOLDS, HEALTH_INTERVAL_MS,
  createLimiter, withRetry, guardedFetch, nightDeadlines, isoMinute, inSchoolHours, parseMetrics, createHealthGuard, HealthAbort,
};
