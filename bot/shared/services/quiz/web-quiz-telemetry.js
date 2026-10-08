'use strict';
/**
 * Page-session telemetry for the web quiz pages (dashboard/public/wq/wq-tel.js): the switch and the ids.
 *
 * app_settings web_quiz_rich_telemetry (default off, fail closed, 30 s cache) decides whether the pages send
 * page-session events and whether events() keeps them. on() never waits: it answers from the cache and refreshes
 * it in the background, so the events route stays synchronous; flag() waits, for the page payloads.
 *
 * A batch may carry the quiz session token (st) and the phone's device ref (dr). Neither is ever logged: the
 * token is verified and its session id logged as `sid`; the device ref is logged as `dh`, a sha256 of it (the
 * ref is 128 random bits, so the hash cannot be turned back; the raw ref would open the hub's chips).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');

const KEY = 'web_quiz_rich_telemetry';
const TTL_MS = 30 * 1000;
const SID_RX = /^[0-9a-f-]{36}$/i;
let cache = null; // { at, on }
let reading = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz telemetry: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, waited for (page payloads). */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/** The switch, never waited for (the events route): the cached value, refreshed in the background when stale. */
function on(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) refresh().catch(() => {});
  return Boolean(cache && cache.on);
}

/** The logged form of a device ref: sha256('wqd|' + ref), 16 hex. */
function deviceHash(ref) {
  return crypto.createHash('sha256').update(`wqd|${ref}`).digest('hex').slice(0, 16);
}

/** The ids a batch may log: sid from a valid session token, dh from a well-formed device ref. Pure. */
function batchIds(body = {}) {
  const out = {};
  const tok = typeof body.st === 'string' ? T.verify(body.st, 's') : null;
  if (tok && typeof tok.sid === 'string' && SID_RX.test(tok.sid)) out.sid = tok.sid;
  const ref = T.cleanDeviceRef(body.dr) || (tok && T.cleanDeviceRef(tok.d));
  if (ref) out.dh = deviceHash(ref);
  return out;
}

module.exports = {
  KEY, flag, on, deviceHash, batchIds,
  _set: (v) => { cache = { at: Date.now(), on: Boolean(v) }; },
  _reset: () => { cache = null; reading = null; },
};
