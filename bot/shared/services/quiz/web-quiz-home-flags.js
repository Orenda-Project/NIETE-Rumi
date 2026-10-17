'use strict';
/**
 * The child home's switches (app_settings `web_quiz_home_v3`, and `web_quiz_stories` for its storybook shelf), on their
 * own so the modules behind the home (the door screens, the videos' watch-only start) read them without loading the
 * home itself. { home, stories, column }: 30 s cache, fails closed (a read error is every switch off).
 * `column` = `web_quiz_remember_column`: the phone a child joined on is kept on the binding row and read there first
 * (child_phone_bindings_device.sql — apply it before the flip); read in the same query, so no extra read.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const Swr = require('./web-quiz-swr');

const KEY = 'web_quiz_home_v3';
const STORIES_KEY = 'web_quiz_stories';
const COLUMN_KEY = 'web_quiz_remember_column';
const TTL_MS = 30 * 1000;
let cache = null;

// Only the JSON boolean the flip writes turns a switch on (app_settings.value is jsonb); the string 'true' is off.
const { isTrue } = require('./is-true');

// web_quiz_fast on: a stale cache is answered at once and read again in the background (web-quiz-swr.js).
async function flags(now = Date.now()) {
  if (Swr.stale(cache, TTL_MS, now)) { Swr.revalidate('home-v3-flags', () => readFlags(now)); return cache; }
  return readFlags(now);
}

async function readFlags(now) {
  if (cache && now - cache.at < TTL_MS) return cache;
  // web_quiz_fast on: the hub's one switch read is in flight for this switch; its answer, not a read of its own.
  const seam = Swr.covered('home-v3-flags');
  if (seam) { await seam; if (cache && now - cache.at < TTL_MS) return cache; }
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, STORIES_KEY, COLUMN_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return fromRows(data, now);
  } catch (err) {
    logToFile('⚠️ web quiz home: settings lookup failed — off', { error: err.message });
    return { home: false, stories: false, column: false };
  }
}

// The rows of the read (or of the hub's one switch read, web-quiz-hub-switches.js) -> the cache.
function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  cache = { at: now, home: isTrue(by[KEY]), stories: isTrue(by[STORIES_KEY]), column: isTrue(by[COLUMN_KEY]) };
  return cache;
}

// The hub's one switch read (web_quiz_fast on): this module's keys, its cache's age, and the cache from the raw rows,
// parsed here exactly as this module's own read parses them.
const OWN_KEYS = [KEY, STORIES_KEY, COLUMN_KEY];
const hubSwitches = { name: 'home-v3-flags', keys: OWN_KEYS, swr: ['home-v3-flags'], age: (now) => Swr.ageOf(cache, TTL_MS, now),
  prime: (rows, now) => fromRows(rows.filter((r) => OWN_KEYS.includes(r.key)), now), read: () => flags(), peek: () => cache };

module.exports = { flags, hubSwitches, KEY, STORIES_KEY, COLUMN_KEY, _resetCache: () => { cache = null; } };
