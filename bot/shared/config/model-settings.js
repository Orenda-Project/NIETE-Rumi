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

/** Rows arrive as JSON or as a JSON string depending on who wrote them. Neither may throw. */
function parseValue(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (_) { return undefined; }
}

/** A map of `<something> -> model id`. Entries that are not model ids are dropped, not kept. */
function cleanModelMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (isModel(v)) out[k] = v;
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

function buildConfig(rows) {
  const cfg = {};
  for (const row of rows || []) {
    const field = KEY_MAP[row?.key];
    if (!field) continue;
    const value = parseValue(row.value);
    if (value === undefined) continue;

    if (field === 'killSwitch') {
      const on = value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
      if (on) cfg.killSwitch = true;
    } else if (field === 'rollout') {
      const ro = cleanRollout(value);
      if (ro) cfg.rollout = ro;
    } else {
      const map = cleanModelMap(value);
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

async function readIntoCache() {
  try {
    const supabase = client();
    if (!supabase) return currentConfig();
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'settings lookup failed');
    cache = { at: Date.now(), cfg: buildConfig(data) };
  } catch (err) {
    // Keep the last good answer. Only if we have never had one do we serve the empty config,
    // and the empty config is today's behaviour, so this is quiet on purpose.
    logToFile('model settings: could not read app_settings, serving the last good config', {
      error: err?.message,
      hadPrevious: !!cache,
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
 * What a call site uses. Returns the cached config immediately and refreshes in the
 * background when it has gone stale, so no request ever waits on the settings table.
 */
function configForRequest() {
  if (isStale()) refresh().catch(() => {});
  return currentConfig();
}

/** Tests only. */
function _reset() { cache = null; }

module.exports = { refresh, currentConfig, configForRequest, isStale, KEYS, KEY_MAP, TTL_MS, _reset };
