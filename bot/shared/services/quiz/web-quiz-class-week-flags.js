'use strict';
/**
 * The class week switch, read like web-quiz-hub-flags (30 s cache, FAIL CLOSED).
 *
 *   app_settings web_quiz_class_week   — the "Forward the week" card on the teacher's Jugnu tab
 *     parent      web_quiz_class_round  — the class draw (class_round_draws holds the week window)
 *     needs       web_quiz_class_link   — the standing class link the card forwards
 *     and         web_quiz_challenge_v2, web_quiz_challenge
 *
 * Effective only when all five are true. A missing row, a read error or any other value is OFF,
 * and with it OFF the Jugnu tab is the page it was before the card, byte for byte.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const WEEK_KEY = 'web_quiz_class_week';
const KEYS = [WEEK_KEY, 'web_quiz_class_round', 'web_quiz_class_link', 'web_quiz_challenge_v2', 'web_quiz_challenge'];
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** True only when the class week's switch AND every parent are on. Never throws. */
async function classWeekOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const on = KEYS.every((k) => isTrue(by[k]));
    cache = { at: now, on };
    return on;
  } catch (err) {
    logToFile('⚠️ class week: settings lookup failed — card off', { error: err.message });
    return false;
  }
}

module.exports = { classWeekOn, isTrue, WEEK_KEY, KEYS, _resetCache: () => { cache = null; } };
