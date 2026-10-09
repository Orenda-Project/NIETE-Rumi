'use strict';
/**
 * The Urdu polish switch for the child web pages (quiz, hub, library, challenge, the share pictures).
 *
 * app_settings web_quiz_ur_polish (default off, fail closed, 30 s cache): when on, the page payloads carry
 * `ui: { ur2: true }` and the edge puts one class on the page root, under which the stylesheet's Urdu type
 * (face, size, line-height, box room) and the shortened Urdu copy apply. Off, every payload is byte-identical
 * to today's and no page changes. English pages never change either way.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_ur_polish';
const TTL_MS = 30 * 1000;
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
        logToFile('⚠️ web quiz ur polish: settings lookup failed — off', { error: err.message });
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

/** What a page payload carries: `{ ur2: true }` when on, else null (the caller leaves the key out). */
async function ui() {
  return (await flag()) ? { ur2: true } : null;
}

module.exports = { flag, ui, KEY, _reset: () => { cache = null; reading = null; } };
