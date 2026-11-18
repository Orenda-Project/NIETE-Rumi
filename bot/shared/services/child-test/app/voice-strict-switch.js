'use strict';
/**
 * A stricter "another voice heard" check (app_settings `sa_r26_voice_strict`, default OFF): ON, the check also gives
 * the other person's words, and the flag stands only when speech-to-text heard words in the same clip and those words
 * are among them (sa/score.js voiceOf). The flag never changes a mark; OFF is unchanged.
 *
 *   on()       30 s cache, fails closed (no row, any other value or a read error is off). JSON `true` = ON with the
 *              default bar; a JSON number from 0.2 to 0.9 = ON with that share of the quote as the bar (the trade-off
 *              between real adults kept and false alarms let back, settable without a deploy).
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r26_voice_strict';
const TTL_MS = 30 * 1000;
let cache = null;

/** true (default bar), a number from 0.2 to 0.9 (that bar), else false. */
function valueOf(v) {
  if (v === true) return true;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0.2 && v <= 0.9) return v;
  return false;
}

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r && r.key === KEY);
    cache = { at, on: valueOf(row ? row.value : null) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa voice strict: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it (true | a bar | false): a test's `voiceStrict`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.voiceStrict !== undefined) return valueOf(typeof deps.voiceStrict === 'function' ? await deps.voiceStrict() : deps.voiceStrict);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
