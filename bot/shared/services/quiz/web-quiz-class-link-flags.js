'use strict';
/**
 * The standing class link's switch (app_settings `web_quiz_class_link`) and its parents
 * (`web_quiz_challenge_v2`, whose parent is `web_quiz_challenge`), read like web-quiz-hub-flags.js:
 * 30 s cache, FAIL CLOSED (a failed read is off). Effective only with every parent ON.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const CLASS_LINK_KEY = 'web_quiz_class_link';
const V2_KEY = 'web_quiz_challenge_v2';
const CHALLENGE_KEY = 'web_quiz_challenge';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

// A switch is on only for the JSON boolean true (app_settings.value is jsonb; the flip writes the boolean): a string
// such as "true", 1, "yes", an object or an absent row is off, the same answer every reader of the key gives.
function isTrue(value) {
  return value === true;
}

/** True only when the class link AND both parents are on. Never throws. */
async function classLinkOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [CLASS_LINK_KEY, V2_KEY, CHALLENGE_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, on: isTrue(by[CLASS_LINK_KEY]) && isTrue(by[V2_KEY]) && isTrue(by[CHALLENGE_KEY]) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz class link: settings lookup failed — class link off', { error: err.message });
    return false;
  }
}

module.exports = { classLinkOn, isTrue, CLASS_LINK_KEY, V2_KEY, CHALLENGE_KEY, _resetCache: () => { cache = null; } };
