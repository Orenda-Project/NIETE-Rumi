'use strict';
/**
 * The last word read, suggested from the recording (app_settings `sa_coach_last_word`, default OFF): ON for a coach, the
 * bot answers POST /sa/last-word-hint with the passage word where the child stopped (sa-api.service saLastWordHint).
 * The row is JSON `true` (everyone) or a pilot list of users.id.
 *
 *   on(userId)  30 s cache of the row, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_coach_last_word';
const TTL_MS = 30 * 1000;
let cache = null;

async function value(at) {
  if (cache && at - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await Snap.rows([KEY], () => supabase().from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r && r.key === KEY);
    cache = { at, value: row ? row.value : null };
    return cache.value;
  } catch (err) {
    logToFile('⚠️ sa coach last word: settings lookup failed — off', { error: err.message });
    return null;
  }
}

async function on(userId, at = Date.now()) {
  const v = await value(at);
  return v === true || (Array.isArray(v) && !!userId && v.includes(userId));
}

/** The switch as a handler sees it: a test's `coachLastWord`, else the setting. */
async function enabled(deps = {}, userId = null) {
  if (deps.coachLastWord !== undefined) return typeof deps.coachLastWord === 'function' ? (await deps.coachLastWord(userId)) === true : deps.coachLastWord === true;
  return on(userId);
}

module.exports = { KEY, on, enabled };
