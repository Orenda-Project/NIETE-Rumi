'use strict';
/**
 * Round 7b, the results dashboard's filters and its skips-and-stops view (app_settings `sa_dash_filters`, default OFF):
 * ON, saSessions adds each session's mode, block, coach (id and name), start and stops, and returns the sessions that
 * have a stop but no task yet under stopSessions. OFF, its answer is exactly as before. The portal reads the same row
 * for its own half (GET /sa/switches dashFilters: true or a list of user ids); the bot honours `true` only.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_dash_filters';
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
    logToFile('⚠️ sa dash filters: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `dashFilters`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.dashFilters !== undefined) return typeof deps.dashFilters === 'function' ? (await deps.dashFilters()) === true : deps.dashFilters === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
