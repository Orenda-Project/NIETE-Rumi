'use strict';
/**
 * Restart test (app_settings `sa_end_test_restart`, default OFF; round 7b): ON, a child the coach ended early stays on the
 * list with Restart test, and a present sent with `restart` starts a new attempt on the child's session
 * (sa-api.service dayOutcome → sa-store restartAttempt). The engine and the coach page read the same row. OFF on every
 * host unless its row says true.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_end_test_restart';
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
    logToFile('⚠️ sa end test restart: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `endTestRestart`, else the setting. */
async function enabled(deps = {}) {
  if (deps.endTestRestart !== undefined) return typeof deps.endTestRestart === 'function' ? (await deps.endTestRestart()) === true : deps.endTestRestart === true;
  return on();
}

module.exports = { KEY, on, enabled };
