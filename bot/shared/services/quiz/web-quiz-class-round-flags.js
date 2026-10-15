'use strict';
/**
 * The class round's switches (app_settings), read like web-quiz-hub-flags.js: one query, 30 s cache, FAIL CLOSED.
 *
 *   round   web_quiz_class_round, effective only with its parent web_quiz_challenge_v2 and that one's parent
 *           web_quiz_challenge all on. Off → every round route is the report's 404, no card, no draw, no claim.
 *   events  web_quiz_events_v2 with its parent web_quiz_hub: the class_round_* events are written only then
 *           (EVENTS §0.6: a v2 event needs both the events switch and the feature's own).
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const ROUND_KEY = 'web_quiz_class_round';
const V2_KEY = 'web_quiz_challenge_v2';
const CHALLENGE_KEY = 'web_quiz_challenge';
const EVENTS_KEY = 'web_quiz_events_v2';
const HUB_KEY = 'web_quiz_hub';
const KEYS = [ROUND_KEY, V2_KEY, CHALLENGE_KEY, EVENTS_KEY, HUB_KEY];
const TTL_MS = 30 * 1000;
const OFF = Object.freeze({ round: false, events: false });
let cache = null;

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** { round, events } — both false on any read failure. Never throws. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const on = (k) => isTrue((data || []).find((r) => r.key === k)?.value);
    const value = { round: on(ROUND_KEY) && on(V2_KEY) && on(CHALLENGE_KEY), events: on(EVENTS_KEY) && on(HUB_KEY) };
    cache = { at: now, value };
    return value;
  } catch (err) {
    logToFile('⚠️ class round: settings lookup failed — round off', { error: err.message });
    return OFF;
  }
}

const roundOn = async () => (await flags()).round;

module.exports = { flags, roundOn, isTrue, ROUND_KEY, V2_KEY, CHALLENGE_KEY, EVENTS_KEY, HUB_KEY, _resetCache: () => { cache = null; } };
