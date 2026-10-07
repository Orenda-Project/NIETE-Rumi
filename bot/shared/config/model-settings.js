/**
 * The settings side of the model registry. bd-5rd2f.
 *
 * `resolveModelForJob` takes `cfg` as an argument and never fetches it, because it runs on
 * every request and must stay synchronous. This module is what produces that `cfg`: an async
 * read of `app_settings`, and a synchronous accessor that hands back the last good answer.
 *
 * FAIL SAFE, NOT FAIL CLOSED — and the difference is the whole point.
 *
 * `feature-flags.js` next door is fail-CLOSED: a flag it cannot read means OFF, because
 * exposing an unfinished feature on a database hiccup is worse than hiding a finished one.
 * A model choice is the other way round. There is no "off" to fall back to; every request
 * needs a model. So an unreadable table, a malformed value, a bad model id and a network
 * failure all resolve to the SAME place: `{}`, which the registry reads as "no overrides",
 * which is today's model. A settings outage must never move a teacher, and must never stop
 * the bot either.
 *
 * The keys are read together in one query rather than six, because six round trips on a
 * refresh is six chances to get a half-applied picture.
 */
const { logToFile } = require('../utils/logger');
const { isModel } = require('./model-registry');

/**
 * The client is fetched LAZILY, and only when the environment can actually produce one.
 *
 * `./supabase` is the bot's cold-boot env gate: with SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY
 * missing it prints a banner and calls `process.exit(78)`. Requiring it at the top of this file
 * gave every module that reads model settings a hard dependency on a database AT IMPORT, and
 * `vision.service.js` had never needed one. Settings are an enhancement; no database must mean
 * no overrides, never no bot.
 *
 * The env check rather than a try/catch is deliberate: `process.exit` is not an exception and
 * cannot be caught, so the only way not to trip the gate is not to reach it.
 */
function client() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  // eslint-disable-next-line global-require
  return require('./supabase');
}

/** key in app_settings -> field on cfg. Every key is prefixed so the table stays greppable. */
const KEY_MAP = {
  llm_kill_switch: 'killSwitch',
  llm_rollout: 'rollout',
  llm_per_language: 'perLanguage',
  llm_per_region: 'perRegion',
  llm_per_job: 'perJob',
};
const KEYS = Object.keys(KEY_MAP);

const TTL_MS = 60 * 1000;

/** The last answer we trust. `null` means we have never had one. */
let cache = null;

/**
 * The read currently in flight, if any. Without this, `configForRequest()` starts a fresh
 * query on EVERY call until the first one lands, because the cache is stale until then. One
 * burst of images would be one query per message, all asking the same question.
 */
let inFlight = null;

/**
 * True once the table has been read at least once, or when there is no database to read. Until
 * then the kill switch is UNKNOWN, not off, and nothing that the kill switch governs may act on
 * an assumption that it is off (bd-gr4fy.6). The last good read stays good through a later failure.
 */
let readOnce = false;

/**
 * What the last read had to drop, and why: a value that was not JSON, not a map, or not a model
 * id. Kept beside the config rather than inside it, so `cfg` keeps exactly the shape every reader
 * already relies on. Reported by llm-client's `llm.job_override_config` event.
 */
let lastRejected = [];

/** Rows arrive as JSON or as a JSON string depending on who wrote them. Neither may throw. */
function parseValue(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (_) { return undefined; }
}

/** A map of `<something> -> model id`. Entries that are not model ids are dropped, not kept. */
function cleanModelMap(value, key, rejected = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    rejected.push({ key, why: 'not a map of name -> model id' });
    return undefined;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isModel(v)) out[k] = v;
    else rejected.push({ key, entry: k, value: String(v).slice(0, 80), why: 'not a model id' });
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A rollout is the only setting that can move a teacher without anyone naming her, so it gets
 * the strictest reading: a real model id, and a percentage clamped into range. A typo of 5000
 * becomes 100 rather than "everyone, and the check silently passed".
 */
function cleanRollout(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (!isModel(value.model)) return undefined;
  const pct = Number(value.pct);
  if (!Number.isFinite(pct)) return undefined;
  return { model: value.model, pct: Math.min(100, Math.max(0, pct)) };
}

function buildConfig(rows, rejected = []) {
  const cfg = {};
  for (const row of rows || []) {
    const field = KEY_MAP[row?.key];
    if (!field) continue;
    const value = parseValue(row.value);
    if (value === undefined) { rejected.push({ key: row.key, why: 'not JSON' }); continue; }

    if (field === 'killSwitch') {
      const on = value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
      if (on) cfg.killSwitch = true;
    } else if (field === 'rollout') {
      const ro = cleanRollout(value);
      if (ro) cfg.rollout = ro;
      else rejected.push({ key: row.key, why: 'not {model, pct}' });
    } else {
      const map = cleanModelMap(value, row.key, rejected);
      if (map) cfg[field] = map;
    }
  }
  return cfg;
}

/**
 * Read the table and replace the cache. Never throws and never rejects: a caller that awaits
 * this on a request path must not be able to fail the request with it.
 */
async function refresh() {
  if (inFlight) return inFlight;
  inFlight = readIntoCache().finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Every outcome stamps the cache, including the bad ones.
 *
 * This is the whole of bd-dsr9l. Stamping only on success left the cache null after a failure,
 * so `isStale()` stayed true and `configForRequest()` started another read on EVERY call: a
 * database that was down got one query per image message. The single-flight guard did not
 * help, because it dedupes concurrent calls and an image queue is sequential.
 *
 * A failure therefore backs off for the same TTL as a success, and carries the last good
 * config forward rather than dropping to empty. The back-off is temporary, so a blip at boot
 * does not freeze the settings for the life of the process.
 */
function stamp(cfg) { cache = { at: Date.now(), cfg }; }

async function readIntoCache() {
  try {
    const supabase = client();
    if (!supabase) { readOnce = true; stamp(currentConfig()); return currentConfig(); }
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'settings lookup failed');
    const rejected = [];
    stamp(buildConfig(data, rejected));
    lastRejected = rejected;
    readOnce = true;
  } catch (err) {
    // Read BEFORE stamping: stamp() always sets the cache, so asking afterwards would report
    // "we had one" every time and the log line would say nothing.
    const hadPrevious = !!cache;
    stamp(currentConfig());
    logToFile('model settings: could not read app_settings, serving the last good config', {
      error: err?.message,
      hadPrevious,
    });
  }
  return currentConfig();
}

/** Synchronous, because the call sites are. `{}` until a refresh has succeeded. */
function currentConfig() {
  return cache ? cache.cfg : {};
}

/** True when the cached answer is old enough to be worth replacing. */
const isStale = () => !cache || Date.now() - cache.at > TTL_MS;

/**
 * How old an answer may be and still move a job: two refresh periods (bd-gr4fy.11).
 *
 * A process that makes a model call at least once a refresh period never holds an older one.
 * A process that has been quiet for longer holds an answer from before its silence, and the
 * table may have changed since. In production (7 Oct 2026) a worker quiet for three
 * minutes ran a job on the model the table had just taken it off, and it would have missed the
 * kill switch the same way. Past this age a call is treated as at boot, before the first read:
 * nothing moves, and the refresh it starts decides the next call.
 */
const MAX_AGE_MS = 2 * TTL_MS;
const isTooOld = () => !!cache && Date.now() - cache.at > MAX_AGE_MS;

/**
 * What a call site uses. Returns the cached config immediately and refreshes in the
 * background when it has gone stale, so no request ever waits on the settings table.
 * An answer too old to trust comes back as `{}`, which moves nothing.
 */
function configForRequest() {
  if (isStale()) refresh().catch(() => {});
  return isTooOld() ? {} : currentConfig();
}

/**
 * Whether the settings are known NOW: read at least once, and not too old to move a job on
 * (MAX_AGE_MS). With no database there is nothing to read and no kill switch can be set, so
 * there is nothing to wait for: always true. Synchronous.
 */
function isCurrent() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return true;
  return readOnce && !isTooOld();
}

/** The in-flight read a call has already waited the full bound for (bd-gr4fy.14). */
let waitedOut = null;

/**
 * Read the table now when the cache is stale AND not current, waiting at most LLM_SETTINGS_FRESH_WAIT_MS
 * (default 1500 ms), for an async caller about to act on the settings (bd-gr4fy.14). Without it the call that
 * finds the answer too old (a quiet process, one busy on a call longer than two minutes, a fresh process)
 * runs on its own model even with an override in force. A read that does not land in time changes nothing
 * for this call. An outage costs one bounded wait per read, never one per call: a read that fails stamps the
 * cache (bd-dsr9l), and a read that hangs is waited out once, after which the calls behind it go straight on
 * until it settles. Never throws (refresh() never rejects).
 */
async function ensureCurrent() {
  if (isCurrent() || !isStale()) return;
  refresh(); // starts the read, or joins the one in flight; never rejects
  // The shared read itself: refresh() is async, so each call hands back a new promise around it.
  const read = inFlight;
  if (!read || read === waitedOut) return;
  const waitMs = Number(process.env.LLM_SETTINGS_FRESH_WAIT_MS) || 1500;
  let timer;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve(true), waitMs);
    if (timer.unref) timer.unref();
  });
  const timedOut = await Promise.race([read.then(() => false), bound]);
  clearTimeout(timer);
  if (timedOut) waitedOut = read;
}

/** What the last successful read dropped, and why. */
function rejectedEntries() { return lastRejected; }

/** Tests only. */
function _reset() { cache = null; readOnce = false; lastRejected = []; waitedOut = null; }

module.exports = {
  refresh, currentConfig, configForRequest, isStale, isCurrent, ensureCurrent, rejectedEntries, KEYS, KEY_MAP,
  TTL_MS, _reset,
};
