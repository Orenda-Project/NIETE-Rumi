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
 * A failed read under `list` (the last good read had it on, and is at most 10 min old): that last good read, marked
 * `down`, so a settings outage is a failed read (the doors answer err: 1, the page's retry), never an empty list. A
 * cold process, an older read, or `list` off: every switch off, as before. A failed read is kept for the same 30 s
 * (one read and one log line per 30 s in an outage, not one per request); its answer is the same either way.
 * Callers that start together share the one read in flight.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const KEY = 'web_quiz_home_v3';
const STORIES_KEY = 'web_quiz_stories';
const COLUMN_KEY = 'web_quiz_remember_column';
const SHELF_KEY = 'web_quiz_video_shelf';
const LIST_KEY = 'web_quiz_list_states';
const TTL_MS = 30 * 1000;
const KEEP_MS = 10 * 60 * 1000;
let cache = null;
let lastGood = null;
let failed = null; // { at, out }: a failed read's answer, kept TTL_MS
let inflight = null;

/** Only the JSON boolean the flip writes turns a switch on (app_settings.value is jsonb); the string 'true' is off. */
function isTrue(value) {
  return value === true;
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  if (failed && now - failed.at < TTL_MS) return failed.out;
  if (!inflight) { const p = read(now).finally(() => { if (inflight === p) inflight = null; }); inflight = p; }
  return inflight;
}

async function read(now) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY, STORIES_KEY, COLUMN_KEY, SHELF_KEY, LIST_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, home: isTrue(by[KEY]), stories: isTrue(by[STORIES_KEY]), column: isTrue(by[COLUMN_KEY]), shelf: isTrue(by[SHELF_KEY]), list: isTrue(by[LIST_KEY]) };
    lastGood = cache;
    return cache;
  } catch (err) {
    // web_quiz_list_states: the last good read, marked down (the doors say "failed", not "nothing here")
    if (lastGood && lastGood.list && now - lastGood.at < KEEP_MS) {
      logToFile('⚠️ web quiz home: settings lookup failed — last good read kept', { error: err.message });
      failed = { at: now, out: { ...lastGood, down: true } };
      return failed.out;
    }
    logToFile('⚠️ web quiz home: settings lookup failed — off', { error: err.message });
    failed = { at: now, out: { home: false, stories: false, column: false, shelf: false, list: false } };
    return failed.out;
  }
}

module.exports = { flags, KEY, STORIES_KEY, COLUMN_KEY, SHELF_KEY, LIST_KEY, _resetCache: () => { cache = null; lastGood = null; failed = null; inflight = null; } };
