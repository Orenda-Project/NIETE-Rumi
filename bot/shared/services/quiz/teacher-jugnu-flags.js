'use strict';
/**
 * The teacher's Jugnu tab switch, read like web-quiz-hub-flags (30 s cache, FAIL CLOSED).
 *
 *   app_settings web_quiz_teacher_jugnu  — the tab, its forward line and the confirm queue
 *     parent      web_quiz_challenge_v2  — the content engine
 *     grandparent web_quiz_challenge     — the kid's Challenge
 *
 * Effective only when all three are true. A missing row, a read error or any other
 * value is OFF, and with it OFF the teacher report is today's page byte for byte.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const JUGNU_KEY = 'web_quiz_teacher_jugnu';
const V2_KEY = 'web_quiz_challenge_v2';
const CHALLENGE_KEY = 'web_quiz_challenge';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** True only when the tab's switch AND both its parents are on. Never throws. */
async function jugnuOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [JUGNU_KEY, V2_KEY, CHALLENGE_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const on = isTrue(by[JUGNU_KEY]) && isTrue(by[V2_KEY]) && isTrue(by[CHALLENGE_KEY]);
    cache = { at: now, on };
    return on;
  } catch (err) {
    logToFile('⚠️ teacher jugnu tab: settings lookup failed — tab off', { error: err.message });
    return false;
  }
}

module.exports = { jugnuOn, isTrue, JUGNU_KEY, V2_KEY, CHALLENGE_KEY, _resetCache: () => { cache = null; } };
