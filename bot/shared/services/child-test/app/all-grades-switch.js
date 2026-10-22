'use strict';
/**
 * Every grade on the coach's list (app_settings `sa_all_grades`, default OFF): ON, the coach names Grade 1–5 for
 * the school and the list is that grade's, one per coach per school per grade per day (sa-api.service dayList).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_all_grades';
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now()) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase().from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa all grades: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `allGrades`, else the setting. */
async function enabled(deps = {}) {
  if (deps.allGrades !== undefined) return typeof deps.allGrades === 'function' ? (await deps.allGrades()) === true : deps.allGrades === true;
  return on();
}

module.exports = { KEY, on, enabled };
