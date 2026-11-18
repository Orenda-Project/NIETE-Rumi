'use strict';
/**
 * The ceiling extension (app_settings `sa_r28_ceiling`, default OFF), as the scorer reads it (sa/score.js): ON, an
 * extended timed task (one carrying base_n) has its first-line stop applied (C-12) and a result without the phone's
 * clock gets no rate until the clock is known (C-5); OFF, such a task is scored as today's N items. The phone reads the
 * same switch from the served battery (battery.ui.r28_ceiling).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const SETTING = 'sa_r28_ceiling'; // the app_settings row (a setting name, not a secret)
const TTL_MS = 30 * 1000;
let cache = null;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([SETTING], () => (client || supabase()).from('app_settings').select('key, value').eq('key', SETTING));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === SETTING && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa ceiling: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `ceiling`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.ceiling !== undefined) return typeof deps.ceiling === 'function' ? (await deps.ceiling()) === true : deps.ceiling === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY: SETTING, on, enabled };
