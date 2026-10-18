'use strict';
/**
 * The child home's switches (app_settings `web_quiz_home_v3`, and `web_quiz_stories` for its storybook shelf), on their
 * own so the modules behind the home (the door screens, the videos' watch-only start) read them without loading the
 * home itself. { home, stories, column }: 30 s cache, fails closed (a read error is every switch off).
 * `column` = `web_quiz_remember_column`: the phone a child joined on is kept on the binding row and read there first
 * (child_phone_bindings_device.sql — apply it before the flip); read in the same query, so no extra read.
 * `shelf` = `web_quiz_video_shelf`: the Videos door as picture shelves (web-quiz-library-flag.js reads it too, for the
 * library's own answers); read in the same query, so the hub asks app_settings nothing more.
 * `list` = `web_quiz_list_states`: every child list shows loading / empty / failed as three states (the boot's
 * `list_states`, the doors' `err`); read in the same query too.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_home_v3';
const STORIES_KEY = 'web_quiz_stories';
const COLUMN_KEY = 'web_quiz_remember_column';
const SHELF_KEY = 'web_quiz_video_shelf';
const LIST_KEY = 'web_quiz_list_states';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only the JSON boolean the flip writes turns a switch on (app_settings.value is jsonb); the string 'true' is off. */
function isTrue(value) {
  return value === true;
}

const KEYS = Object.freeze([KEY, STORIES_KEY, COLUMN_KEY, SHELF_KEY, LIST_KEY]);

function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { at: now, home: isTrue(by[KEY]), stories: isTrue(by[STORIES_KEY]), column: isTrue(by[COLUMN_KEY]), shelf: isTrue(by[SHELF_KEY]), list: isTrue(by[LIST_KEY]) };
}

/**
 * Another module's one app_settings read that asked for KEYS too (the join's, quiz_join_fast) fills an empty or
 * expired cache from its rows, so no second read follows; a live cache is left as it is. `asked` is the key list that
 * read asked for: a list missing one of KEYS throws; a key asked for with no row is the normal off.
 */
function prime(rows, now = Date.now(), asked = KEYS) {
  const missing = KEYS.filter((k) => !asked.includes(k));
  if (missing.length) throw new Error(`home flags primed by a read that did not ask for ${missing.join(', ')}`);
  if (cache && now - cache.at < TTL_MS) return;
  cache = fromRows(rows, now);
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, STORIES_KEY, COLUMN_KEY, SHELF_KEY, LIST_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = fromRows(data, now);
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz home: settings lookup failed — off', { error: err.message });
    return { home: false, stories: false, column: false, shelf: false, list: false };
  }
}

module.exports = { flags, prime, KEYS, KEY, STORIES_KEY, COLUMN_KEY, SHELF_KEY, LIST_KEY, _resetCache: () => { cache = null; } };
