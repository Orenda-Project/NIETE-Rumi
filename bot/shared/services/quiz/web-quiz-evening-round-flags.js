'use strict';
/**
 * The evening round's switch (app_settings `web_quiz_evening_round`, OFF by default: a missing row is off).
 *
 * Effective only while the standing class link is effective (web-quiz-class-link-flags.js classLinkOn: the class
 * link and both its parents on): the round is served behind the class link, so it never runs without one.
 * Read like the class link's own switch: 30 s cache, FAIL CLOSED (a failed read is off), never throws.
 *
 * The once-a-term locked round (`web_quiz_class_round`) is a different product and is not read here.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const ClassLinkFlags = require('./web-quiz-class-link-flags');

const EVENING_ROUND_KEY = 'web_quiz_evening_round';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** The row alone (cached), true only for a JSON/string true. */
async function ownOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', EVENING_ROUND_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || [])[0];
    cache = { at: now, on: Boolean(row) && ClassLinkFlags.isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ evening round: settings lookup failed — evening round off', { error: err.message });
    return false;
  }
}

/** True only when `web_quiz_evening_round` AND the class link (with its parents) are on. Never throws. */
async function eveningRoundOn(now = Date.now()) {
  if (!(await ownOn(now))) return false;
  try {
    return (await ClassLinkFlags.classLinkOn(now)) === true;
  } catch (_) {
    return false;
  }
}

module.exports = { eveningRoundOn, EVENING_ROUND_KEY, _resetCache: () => { cache = null; } };
