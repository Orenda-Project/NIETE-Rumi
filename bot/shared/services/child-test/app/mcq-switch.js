'use strict';
/**
 * The spoken comprehension questions' reading floor (app_settings `sa_r28_mcq`, default OFF), as the server reads it:
 * ON, a story MCQ row is not marked from the phone's count at sync (sa-store.js parks it) and the scorer (sa/score.js)
 * writes its marks once its passage's marks exist, through the oral questions' own gate (first line stopped, under 10
 * words): a gated MCQ reads not reached, 0 of its questions, with the phone's answers kept in the marks' detail. The
 * phone reads the same switch from the served battery (battery.ui.r28_mcq).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const SETTING = 'sa_r28_mcq'; // the app_settings row (a setting name, not a secret)
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
    logToFile('⚠️ sa mcq: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `mcq`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.mcq !== undefined) return typeof deps.mcq === 'function' ? (await deps.mcq()) === true : deps.mcq === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY: SETTING, on, enabled };
