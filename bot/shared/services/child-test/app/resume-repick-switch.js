'use strict';
/**
 * The coach re-picks the part of a resumed child (app_settings `sa_resume_repick`, default OFF): ON, a present
 * re-sent with a block and `repick` moves the child's unfinished session to that block (sa-api.service dayOutcome).
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_resume_repick';
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
    logToFile('⚠️ sa resume repick: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `resumeRepick`, else the setting. */
async function enabled(deps = {}) {
  if (deps.resumeRepick !== undefined) return typeof deps.resumeRepick === 'function' ? (await deps.resumeRepick()) === true : deps.resumeRepick === true;
  return on();
}

module.exports = { KEY, on, enabled };
