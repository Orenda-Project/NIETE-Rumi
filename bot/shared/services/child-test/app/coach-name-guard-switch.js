'use strict';
/**
 * Round 8, a coach's name on the results dashboard (app_settings `sa_r8_coach_name_guard`, default OFF): ON, a stored
 * name that is a chat command or a route ("/assessment"), a link, or holds no letter is sent as null, so the page shows
 * its "unknown coach" label and never a command as a person. OFF, the stored name as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r8_coach_name_guard';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa coach name guard: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `coachNameGuard`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.coachNameGuard !== undefined) return typeof deps.coachNameGuard === 'function' ? (await deps.coachNameGuard()) === true : deps.coachNameGuard === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
