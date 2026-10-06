'use strict';
/**
 * The kid hub's switches (app_settings web_quiz_hub / web_quiz_challenge / web_quiz_library),
 * read like web-quiz-link.js (30 s cache, fail closed), and the hub link WhatsApp /quiz sends.
 * Its own module so student-quiz.service can send the link without loading web-quiz-hub.js
 * (which reads student-quiz.service): no require cycle.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');

const HUB_KEY = 'web_quiz_hub';
const CHALLENGE_KEY = 'web_quiz_challenge';
const LIBRARY_KEY = 'web_quiz_library';
const TTL_MS = 30 * 1000;
let cache = null; // { at, hub, challenge, library }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, hub: isTrue(by[HUB_KEY]), challenge: isTrue(by[CHALLENGE_KEY]), library: isTrue(by[LIBRARY_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    return { hub: false, challenge: false, library: false };
  }
}

/** `<portal>/h/<token>` for these children, or null (hub off, no base URL, no secret, no child). Never throws. */
async function hubLink(studentIds) {
  try {
    const Link = require('./web-quiz-link');
    const base = Link.webBaseUrl();
    if (!base || !(await flags()).hub) return null;
    const token = T.signHub(studentIds);
    return token ? `${base}/h/${token}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz hub: no hub link', { error: err.message });
    return null;
  }
}

module.exports = { flags, hubLink, HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, _resetCache: () => { cache = null; } };
