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

// JSON true only: a string 'true' row is off, like every child-page switch
function isTrue(value) {
  return value === true;
}

function refresh() {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        cache = { at: Date.now(), on: isTrue(data && data.value) };
      } catch (err) {
        logToFile('⚠️ web quiz juice: settings lookup failed — off', { error: err.message });
        cache = { at: Date.now(), on: false };
      } finally {
        reading = null;
      }
      return cache.on;
    })();
  }
  return reading;
}

/** The switch, waited for (page payloads). Never throws. */
async function flag(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  return refresh();
}

/** What a page payload carries: `true` when on, else null (the caller leaves the key out). */
async function field() {
  return (await flag()) ? true : null;
}

module.exports = { flag, field, KEY, _reset: () => { cache = null; reading = null; } };
