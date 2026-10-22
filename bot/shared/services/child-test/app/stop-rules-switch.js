'use strict';
/**
 * EGRA's stop rules for the W3 tasks at scoring time (app_settings `sa_stop_rules`, default OFF): ON, a W3 letters /
 * words task takes the first-row rule, and comprehension after a passage stopped on its first line is not reached
 * (sa/score.js). The results page labels a task stopped by rule.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_stop_rules';
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
    logToFile('⚠️ sa stop rules: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `stopRules`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.stopRules !== undefined) return typeof deps.stopRules === 'function' ? (await deps.stopRules()) === true : deps.stopRules === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
