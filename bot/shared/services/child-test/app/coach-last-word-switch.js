'use strict';
/**
 * The last word read, suggested from the recording (app_settings `sa_coach_last_word`, default OFF): ON for a coach, the
 * bot answers POST /sa/last-word-hint with the passage word where the child stopped (sa-api.service saLastWordHint).
 * The row is JSON `true` (everyone) or a pilot list of users.id.
 *
 *   on(userId)  30 s cache of the row, fails closed (no row, any other value or a read error is off); the scorer's
 *               sweep passes its own client
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_coach_last_word';
const TTL_MS = 30 * 1000;
let cache = null;

async function value(at, client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r && r.key === KEY);
    cache = { at, value: row ? row.value : null };
    return cache.value;
  } catch (err) {
    logToFile('⚠️ sa coach last word: settings lookup failed — off', { error: err.message });
    return null;
  }
}

async function on(userId, at = Date.now(), client = null) {
  const v = await value(at, client);
  return v === true || (Array.isArray(v) && !!userId && v.includes(userId));
}

/** The switch as a handler sees it: a test's `coachLastWord`, else the setting. */
async function enabled(deps = {}, userId = null, client = null) {
  if (deps.coachLastWord !== undefined) return typeof deps.coachLastWord === 'function' ? (await deps.coachLastWord(userId)) === true : deps.coachLastWord === true;
  return on(userId, Date.now(), client);
}

module.exports = { KEY, on, enabled };
