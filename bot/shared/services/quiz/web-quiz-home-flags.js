'use strict';
/**
 * The child home's switches (app_settings `web_quiz_home_v3`, and `web_quiz_stories` for its storybook shelf), on their
 * own so the modules behind the home (the door screens, the videos' watch-only start) read them without loading the
 * home itself. { home, stories, column, shown }: 30 s cache, fails closed (a read error is every switch off).
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

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, STORIES_KEY, COLUMN_KEY, SHOWN_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, home: isTrue(by[KEY]), stories: isTrue(by[STORIES_KEY]), column: isTrue(by[COLUMN_KEY]), shown: isTrue(by[SHOWN_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz home: settings lookup failed — off', { error: err.message });
    return { home: false, stories: false, column: false, shown: false };
  }
}

module.exports = { flags, KEY, STORIES_KEY, COLUMN_KEY, SHOWN_KEY, _resetCache: () => { cache = null; } };
