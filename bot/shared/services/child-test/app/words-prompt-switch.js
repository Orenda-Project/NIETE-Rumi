'use strict';
/**
 * Round 28, the familiar-word tasks' own prompt (app_settings `sa_r28_words_prompt`, default OFF). The words tasks
 * (subtask familiar_word_reading) were scored with the 60-second PASSAGE prompt, although the phone shows the words ONE
 * AT A TIME. ON, sa/score.js gives them a prompt of their own: the letters card shape (one numbered word per line, the
 * model answering per position) with EGRA's accent rule, and an item's accepted forms beside its word. The speech gate,
 * the rows, the rate and the first-row stop are unchanged. OFF, every path is as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_words_prompt';
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
    logToFile('⚠️ sa r28 words prompt: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `wordsPrompt`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.wordsPrompt !== undefined) return valueOf(typeof deps.wordsPrompt === 'function' ? await deps.wordsPrompt() : deps.wordsPrompt);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
