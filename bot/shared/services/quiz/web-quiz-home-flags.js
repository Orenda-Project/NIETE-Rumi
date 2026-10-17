'use strict';
/**
 * The child home's switches (app_settings `web_quiz_home_v3`, and `web_quiz_stories` for its storybook shelf), on their
 * own so the modules behind the home (the door screens, the videos' watch-only start) read them without loading the
 * home itself. { home, stories, column, shown }: 30 s cache, fails closed (a read error is every switch off; if only the
 * read that names `shown` fails, the home's own three are read again alone and `shown` is off).
 * `column` = `web_quiz_remember_column`: the phone a child joined on is kept on the binding row and read there first
 * (child_phone_bindings_device.sql — apply it before the flip); read in the same query, so no extra read.
 * `shown` = `web_quiz_remember_shown_row`: with `column` on, the first home's line is claimed on the binding row too, so
 * a cache flush never draws it twice (child_phone_bindings_remember_shown.sql — apply it before the flip).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_home_v3';
const STORIES_KEY = 'web_quiz_stories';
const COLUMN_KEY = 'web_quiz_remember_column';
const SHOWN_KEY = 'web_quiz_remember_shown_row';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only the JSON boolean the flip writes turns a switch on (app_settings.value is jsonb); the string 'true' is off. */
function isTrue(value) {
  return value === true;
}

/** The rows of `keys` → { key: value }; throws on a read error. */
async function read(keys) {
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
  if (error) throw new Error(error.message || 'app_settings read failed');
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    let by;
    try {
      by = await read([KEY, STORIES_KEY, COLUMN_KEY, SHOWN_KEY]);
    } catch (err) {
      // a fault on the shown row never turns the home off: the home's own switches are read again alone, shown stays off
      logToFile('⚠️ web quiz home: settings lookup failed — reading the home switches alone, shown off', { error: err.message });
      by = { ...(await read([KEY, STORIES_KEY, COLUMN_KEY])), [SHOWN_KEY]: false };
    }
    cache = { at: now, home: isTrue(by[KEY]), stories: isTrue(by[STORIES_KEY]), column: isTrue(by[COLUMN_KEY]), shown: isTrue(by[SHOWN_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz home: settings lookup failed — off', { error: err.message });
    return { home: false, stories: false, column: false, shown: false };
  }
}

module.exports = { flags, KEY, STORIES_KEY, COLUMN_KEY, SHOWN_KEY, _resetCache: () => { cache = null; } };
