'use strict';
/**
 * Round 28, the child's own answer in spoken maths (app_settings `sa_r28_child_only_answer`, default OFF). The model
 * hears the whole clip, so in coach-led sums an adult who says the right answer after the child's wrong one could be
 * credited to the child. ON, the spoken-maths prompt (sa/score.js oralPrompt) says: mark the child's own final answer
 * (a self-correction counts), ignore any other speaker, and an answer given or changed after another person spoke does
 * not count. OFF, the prompt is unchanged.
 *
 *   on()       30 s cache, JSON `true` only, fails closed (no row, any other value or a read error is off)
 */
const supabase = () => require('../../../config/supabase'); // eslint-disable-line global-require
const Snap = require('../../settings/settings-snapshot');
const { logToFile } = require('../../../utils/logger');

const KEY = 'sa_r28_child_only_answer';
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
    logToFile('⚠️ sa r28 child only answer: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** The switch as a handler sees it: a test's `childOnlyAnswer`, else the setting (read with the caller's client, if any). */
async function enabled(deps = {}) {
  if (deps.childOnlyAnswer !== undefined) return valueOf(typeof deps.childOnlyAnswer === 'function' ? await deps.childOnlyAnswer() : deps.childOnlyAnswer);
  return on(Date.now(), deps.supabase || null);
}

module.exports = { KEY, on, enabled, valueOf };
