'use strict';
/**
 * The kid hub's switches (app_settings web_quiz_hub / web_quiz_challenge / web_quiz_library / web_quiz_hub_door /
 * web_quiz_child_quiz_home),
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
// The results card's door to the hub (web-quiz-hub-door.js); only with the hub on.
const DOOR_KEY = 'web_quiz_hub_door';
// A child's /quiz opens the hub as their home page: the Home button, and the last quiz on top. Only with the hub on.
const CHILD_HOME_KEY = 'web_quiz_child_quiz_home';
// The quiz page's always-visible Home button (the door from any screen of the child's own run; only with the hub
// on) and its step-back navigation (Back to the previous question as a review; the phone's Back walks it).
const HOME_BUTTON_KEY = 'web_quiz_home_button';
const BACK_NAV_KEY = 'web_quiz_back_nav';
const TTL_MS = 30 * 1000;
let cache = null; // { at, hub, challenge, library, door, childHome, homeButton, backNav }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, HOME_BUTTON_KEY, BACK_NAV_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    cache = { at: now, hub: isTrue(by[HUB_KEY]), challenge: isTrue(by[CHALLENGE_KEY]), library: isTrue(by[LIBRARY_KEY]), door: isTrue(by[DOOR_KEY]), childHome: isTrue(by[CHILD_HOME_KEY]),
      homeButton: isTrue(by[HOME_BUTTON_KEY]), backNav: isTrue(by[BACK_NAV_KEY]) };
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    return { hub: false, challenge: false, library: false, door: false, childHome: false, homeButton: false, backNav: false };
  }
}

/** The quiz page's `nav` ({home, back}) when either switch is on, else null (the payload stays today's). Never throws. */
async function pageNav() {
  try {
    const f = await flags();
    const home = Boolean(f.hub && f.homeButton);
    const back = Boolean(f.backNav);
    return home || back ? { home, back } : null;
  } catch (_) {
    return null;
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

module.exports = { flags, hubLink, pageNav, HOME_BUTTON_KEY, BACK_NAV_KEY, HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, _resetCache: () => { cache = null; } };
