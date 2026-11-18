'use strict';
/**
 * Round 28, the letters speech gate (app_settings `sa_r28_letter_gate`, default OFF). The speech gate
 * (CHILD_TEST_SA_SPEECH_GATE) mutes a whole clip when speech-to-text hears no WORD in it, and a child saying bare
 * letter sounds (/b/ /m/ /s/) says no word. ON, the letter name and letter sound tasks (by subtask name) skip
 * speech-to-text: only the duration floor and the model's own found:false mute a letter clip, and the letters prompt
 * says the clip may hold bare phonemes (sa/score.js scoreGrid). OFF, every path is exactly as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_letter_gate';
const TTL_MS = 30 * 1000;
let cache = null;

/** Only JSON true is on. */
const valueOf = (v) => v === true;

async function on(at = Date.now(), client = null) {
  if (cache && at - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await Snap.rows([KEY], () => (client || supabase()).from('app_settings').select('key, value').eq('key', KEY));
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at, on: (data || []).some((r) => r && r.key === KEY && r.value === true) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ sa r28 letter gate: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `letterGate`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.letterGate !== undefined) return valueOf(typeof deps.letterGate === 'function' ? await deps.letterGate() : deps.letterGate);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
