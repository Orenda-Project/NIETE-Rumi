'use strict';
/**
 * Practice schools only (app_settings `child_test_practice_only`, default OFF): ON, a coach who is not on the pilot
 * list (CHILD_TEST_COACH_IDS) gets the coach app's Learning assessment in their practice schools only, the schools
 * marked is_probable_test (gate.isPracticeCoach; app-api.service guarded's `practice` option; sa-api.service).
 * Pilot coaches are unchanged.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'child_test_practice_only';
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
    logToFile('⚠️ child test practice only: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `practiceOnly`, else the setting. */
async function enabled(deps = {}) {
  if (deps.practiceSwitch !== undefined) return typeof deps.practiceSwitch === 'function' ? (await deps.practiceSwitch()) === true : deps.practiceSwitch === true;
  return on();
}

module.exports = { KEY, on, enabled };
