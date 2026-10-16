'use strict';
/**
 * The sound + motion kit switch for the child web pages (the quiz page and the Challenge page).
 *
 * app_settings web_quiz_juice (default off, fail closed, 30 s cache): when on, the page payloads carry
 * `juice: true` and the edge loads the kit (wq-juice.js + wq-juice.css) before the page's own script; the page
 * then calls the kit on a right answer, a wrong one and the finish. Off, the key is absent from every payload,
 * the edge loads nothing new, and every page is today's.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_juice';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

// keep (the background re-read of a stale value, web_quiz_fast on): a failed read keeps the value it was refreshing.
function refresh({ keep = false } = {}) {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz juice: settings lookup failed — off', { error: err.message });
        if (!(keep && cache)) cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, waited for (page payloads); with web_quiz_fast on, a stale value is answered at once and read again in
 * the background (web-quiz-swr.js). Never throws. */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  if (require('./web-quiz-swr').stale(cache, TTL_MS, now)) { refresh({ keep: true }).catch(() => {}); return cache.on; }
  return refresh();
}

/** What a page payload carries: `true` when on, else null (the caller leaves the key out). */
async function field() {
  return (await flag()) ? true : null;
}

module.exports = { flag, field, KEY, _reset: () => { cache = null; reading = null; } };
