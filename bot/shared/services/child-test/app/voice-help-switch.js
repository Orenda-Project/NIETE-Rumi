'use strict';
/**
 * The another-voice check flags help only (app_settings `sa_r28_voice_help`, default OFF): ON, each clip's diarized
 * transcript is read beside the task's items and answers, and only an adult (or another child) giving content flags;
 * instructions and encouragement are logged as support (sa/voice-help.js, sa/score.js voiceHelpOf). It takes the place
 * of the audio check and of sa_r26_voice_strict while ON. The flag never changes a mark; OFF is unchanged.
 *
 *   on()       30 s cache, fails closed (no row, any value but JSON true, or a read error is off).
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_voice_help';
const TTL_MS = 30 * 1000;
let cache = null;

const valueOf = (v) => v === true;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r && r.key === KEY);
    cache = { at, on: valueOf(row ? row.value : null) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa voice help: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `voiceHelp`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.voiceHelp !== undefined) return valueOf(typeof deps.voiceHelp === 'function' ? await deps.voiceHelp() : deps.voiceHelp);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
