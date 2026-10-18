'use strict';
/**
 * The portal learns the page switches before its first page (app_settings web_quiz_edge_learn, default off, fail off,
 * 30 s cache). Only the stored JSON boolean true turns it on: the string 'true', 1, {}, no row or a failed read are off.
 *
 * Each portal process remembers a few switches it learns from a quiz or hub payload (`fast`, `brand`, `rt`, `ui`,
 * `one_face`); after a deploy it knows none of them until its first page. GET /api/internal/wq/edge answers:
 *   off → { learn: false } and nothing else (the portal then does nothing);
 *   on  → { learn: true, fast, brand, rt[, ui][, one_face] }: exactly those payload fields, read through the same cached
 *         switches the payloads use (no child, teacher or class data, no ids).
 * Beyond its own key the answer adds no database read: every page switch answers from its own cache. Its own key is
 * read at most once per 30 s cache window, however many portal processes ask.
 *
 * hubSwitches: this module's row for the hub's one settings read (the seam's shape: name, keys, swr, age, prime, read,
 * peek, as web-quiz-one-face.js), so that read can fill this cache from its own rows instead of a read of its own.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_edge_learn';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

/** Only the JSON boolean the flip writes (app_settings.value is jsonb). */
function fromRow(row, now) {
  cache = { at: now, on: Boolean(row) && row.value === true };
  return cache.on;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        fromRow(data, Date.now());
      } catch (err) {
        logToFile('⚠️ web quiz edge learn: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, waited for. Never throws. */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

async function brandKey() {
  try {
    const WebQuizBrand = require('../../config/web-quiz-brand');
    const { orgName, botName } = require('../../config/branding');
    return await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName });
  } catch (_) {
    return null;
  }
}

/** The answer to GET /api/internal/wq/edge. */
async function answer() {
  if (!(await flag())) return { learn: false };
  // As the payloads read them: fast and one_face never wait (their cached value); rt, ui and the brand from their caches.
  const fast = require('./web-quiz-fast').on();
  const oneFace = require('./web-quiz-one-face').on();
  // web_quiz_edge_warm (web-quiz-edge-warm.js): `edge_warm: true` and the hub's switches touched, while on
  const [brand, rt, ui, warm] = await Promise.all([brandKey(), require('./web-quiz-telemetry').flag(), require('./web-quiz-ur-polish').ui(), require('./web-quiz-edge-warm').field()]);
  return { learn: true, fast, brand, rt: rt === true, ...(ui ? { ui } : {}), ...(oneFace ? { one_face: true } : {}), ...warm };
}

const ageOf = (now) => (!cache ? 'cold' : now - cache.at < TTL_MS ? 'fresh' : 'stale');
const hubSwitches = { name: 'edge-learn', keys: [KEY], swr: [], age: ageOf,
  prime: (rows, now) => fromRow((rows || []).find((r) => r && r.key === KEY) || null, now), read: () => flag(), peek: () => cache };

module.exports = { flag, answer, hubSwitches, KEY, TTL_MS, _reset: () => { cache = null; reading = null; } };
