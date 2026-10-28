'use strict';
/**
 * Round 8, practice schools on the results dashboard (app_settings `sa_r8_hide_practice`, default OFF): ON, saSessions
 * marks each row `practice` (its school is_probable_test) and answers practiceFilter: true, so the page leaves practice
 * schools out by default and offers "Include practice schools". OFF, its answer is exactly as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r8_hide_practice';
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
    logToFile('⚠️ sa hide practice: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `hidePractice`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.hidePractice !== undefined) return typeof deps.hidePractice === 'function' ? (await deps.hidePractice()) === true : deps.hidePractice === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
