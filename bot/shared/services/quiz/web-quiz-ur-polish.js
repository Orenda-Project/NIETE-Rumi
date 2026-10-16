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
const Swr = require('./web-quiz-swr');

const KEY = 'web_quiz_ur_polish';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let reading = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

// keep: a background read (web_quiz_fast on) that fails leaves the cached value as it was.
function refresh(keep = false) {
  if (!reading) {
    reading = (async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
        if (error) throw new Error(error.message || 'app_settings read failed');
        fromRow(data, Date.now());
      } catch (err) {
        logToFile('⚠️ web quiz ur polish: settings lookup failed — off', { error: err.message });
        if (!(keep && cache)) cache = { at: Date.now(), on: false };
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
  // web_quiz_fast on: a stale cache is answered at once and read again in the background (web-quiz-swr.js).
  // (none while the hub's one switch read is in flight for it: that read refreshes it)
  if (Swr.stale(cache, TTL_MS, now)) { if (!Swr.covered(SEAM_NAME)) refresh(true).catch(() => {}); return cache.on; }
  // ...and with no value yet, that read's answer, not a read of its own
  const seam = Swr.covered(SEAM_NAME);
  if (seam) { await seam; if (cache && now - cache.at < TTL_MS) return cache.on; }
  return refresh();
}

function fromRow(data, now) { cache = { at: now, on: isTrue(data && data.value) }; return cache.on; }

// The hub's one switch read (web_quiz_fast on, web-quiz-hub-switches.js): this module's keys, its cache's age, and the
// cache from the raw rows, parsed here exactly as this module's own read parses them.
const SEAM_NAME = 'ur-polish';
const hubSwitches = { name: SEAM_NAME, keys: [KEY], swr: [SEAM_NAME], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRow(rows.find((r) => r.key === KEY) || null, now), read: () => flag(), peek: () => cache };

/** What a page payload carries: `{ ur2: true }` when on, else null (the caller leaves the key out). */
async function ui() {
  return (await flag()) ? { ur2: true } : null;
}

module.exports = { flag, ui, hubSwitches, KEY, _reset: () => { cache = null; reading = null; } };
