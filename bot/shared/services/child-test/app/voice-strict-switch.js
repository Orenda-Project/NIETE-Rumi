'use strict';
/**
 * A stricter "another voice heard" check (app_settings `sa_r26_voice_strict`, default OFF): ON, the check also gives
 * the other person's words, and the flag stands only when speech-to-text heard words in the same clip and those words
 * are among them (sa/score.js voiceOf). The flag never changes a mark; OFF is unchanged.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r26_voice_strict';
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
    logToFile('⚠️ sa voice strict: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `voiceStrict`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.voiceStrict !== undefined) return typeof deps.voiceStrict === 'function' ? (await deps.voiceStrict()) === true : deps.voiceStrict === true;
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled };
