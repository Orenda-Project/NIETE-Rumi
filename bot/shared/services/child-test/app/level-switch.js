'use strict';
/**
 * Round 20, the child's level per subject on Results and the results dashboard (app_settings `sa_r20_level`, default
 * OFF): ON, saResults and every saSessions row's results carry `levels` (sa/level.js): per subject where the child
 * reached, the level (the words and cut-offs sent for review) and why the subject stopped. OFF, the
 * answers are exactly as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r20_level';
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
    logToFile('⚠️ sa r20 level: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `r20Level`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.r20Level !== undefined) return typeof deps.r20Level === 'function' ? (await deps.r20Level()) === true : deps.r20Level === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
