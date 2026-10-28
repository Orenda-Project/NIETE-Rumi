'use strict';
/**
 * A rotated passage is scored against the passage the phone showed (app_settings `sa_r8_variant_wait`, default OFF):
 * ON, a passage row with rotation variants waits for its questions row (whose asked ids name the variant) or takes the
 * variant the phone wrote on its result; the hash guess only once the session ended or the wait ran out (sa/score.js).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r8_variant_wait';
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
    logToFile('⚠️ sa variant wait: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `variantWait`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.variantWait !== undefined) return typeof deps.variantWait === 'function' ? (await deps.variantWait()) === true : deps.variantWait === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
