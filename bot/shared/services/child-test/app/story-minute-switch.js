'use strict';
/**
 * The story's minute (app_settings `sa_r28_story_minute`, default OFF), as the scorer reads it (sa/score.js). The story's
 * reading rate is words correct per minute. ON, the seconds a story run is rated on are fewer than 60 only when the child
 * reached the passage's last printed line (the scorer's attempted count, or the phone's last-word index); otherwise the
 * full minute is used, as an assessor's timer would. A time-up run, a first-line stop and a run without the phone's clock
 * are scored as before, and the other timed tasks are untouched. OFF, every path is as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_story_minute';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only JSON true is on. */
const valueOf = (v) => v === true;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa r28 story minute: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `storyMinute`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.storyMinute !== undefined) return valueOf(typeof deps.storyMinute === 'function' ? await deps.storyMinute() : deps.storyMinute);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
