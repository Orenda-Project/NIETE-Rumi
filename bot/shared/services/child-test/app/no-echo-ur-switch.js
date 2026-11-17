'use strict';
/**
 * Round 28, no echo check in Urdu (app_settings `sa_r28_no_echo_ur`, default OFF). The echo check (sa/score.js
 * echoed()) zeroes a "correct" answer when speech-to-text heard under half of it; in Urdu speech-to-text hears the
 * phone's loud question and misses the child's quiet one-word answer, so most Urdu echo zeroes were right answers. ON,
 * an Urdu questions task skips the echo check and its prompt tells the model that a repetition of the question is not
 * an answer (the model judges echoes, not speech-to-text). English keeps the check. OFF, every path is as before.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_no_echo_ur';
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
    logToFile('⚠️ sa r28 no echo ur: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `noEchoUr`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.noEchoUr !== undefined) return valueOf(typeof deps.noEchoUr === 'function' ? await deps.noEchoUr() : deps.noEchoUr);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
