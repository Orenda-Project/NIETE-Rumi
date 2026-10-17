'use strict';
/**
 * The returning child's home in the family's language (app_settings `web_quiz_return_lang`). The WhatsApp /quiz reply
 * already speaks the language the bot resolved (the child's newest quiz, else the family's own); on, the hub link
 * carries it as `l` (as the join link does) and the hub falls back to it when the child has no quiz yet, before
 * English. Off: the link and the page are today's. 30 s cache; fails closed (a read error is off).
 * With web_quiz_fast on, the hub's one switch read (web-quiz-hub-switches.js) fills this cache: no read of its own.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const KEY = 'web_quiz_return_lang';
const TTL_MS = 30 * 1000;
let cache = null;

// Only the JSON boolean the flip writes turns the switch on (app_settings.value is jsonb); the string 'true' is off.
const { isTrue } = require('./is-true');

function fromRow(row, now) {
  cache = { at: now, on: isTrue((row || {}).value) };
  return cache.on;
}

async function on(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  // web_quiz_fast on: the hub's one switch read is in flight for this switch and fills this cache; no second read.
  const seam = Swr.covered(SEAM_NAME);
  if (seam) {
    await seam;
    if (cache && Date.now() - cache.at < TTL_MS) return cache.on;
  }
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return fromRow((data || [])[0], now);
  } catch (err) {
    logToFile('⚠️ web quiz return language: settings lookup failed — off', { error: err.message });
    return false;
  }
}

// The hub's one switch read (web_quiz_fast on, web-quiz-hub-switches.js): this module's key, its cache's age, and the
// cache from the raw row, parsed here exactly as this module's own read parses it.
const SEAM_NAME = 'return-lang';
const hubSwitches = { name: SEAM_NAME, keys: [KEY], swr: [SEAM_NAME], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRow(rows.find((r) => r.key === KEY) || null, now), read: () => on(), peek: () => cache };

/** A language a hub link may carry: en or ur, else null. */
function linkLang(lang) {
  return lang === 'en' || lang === 'ur' ? lang : null;
}

module.exports = { on, linkLang, hubSwitches, KEY, _resetCache: () => { cache = null; } };
