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
const SHARE_KEY = 'web_quiz_class_link_share'; // bd-pdwwk4.6.20: the card up top on Home + the quiz home's section
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }
let shareCache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
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

/**
 * "Share with your class" (app_settings `web_quiz_class_link_share`, OFF by default): the teacher app draws the class
 * link card above the tiles while a link is unsent, and the quiz home carries its share section. Only with the class
 * link itself on; same 30 s cache, fail closed. Never throws.
 */
async function shareOn(now = Date.now()) {
  if (!(await classLinkOn(now))) return false;
  if (shareCache && now - shareCache.at < TTL_MS) return shareCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SHARE_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    shareCache = { at: now, on: isTrue(((data || [])[0] || {}).value) };
    return shareCache.on;
  } catch (err) {
    logToFile('⚠️ web quiz class link: share switch lookup failed — share off', { error: err.message });
    return false;
  }
}

module.exports = {
  classLinkOn, shareOn, isTrue, CLASS_LINK_KEY, V2_KEY, CHALLENGE_KEY, SHARE_KEY,
  _resetCache: () => { cache = null; shareCache = null; },
};
