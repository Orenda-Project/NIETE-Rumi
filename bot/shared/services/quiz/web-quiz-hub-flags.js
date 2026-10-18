'use strict';
/**
 * The kid hub's switches (app_settings web_quiz_hub / web_quiz_challenge / web_quiz_library / web_quiz_hub_door /
 * web_quiz_child_quiz_home / web_quiz_events_v2 / web_quiz_challenge_v2 / web_quiz_challenge_rungs / web_quiz_readalong /
 * web_quiz_wait_ux / web_quiz_home_preload / web_quiz_pack),
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
// Events v2 (keyed child key, measurement events, the send ledger): read-side only; effective only with the hub on.
const EVENTS_V2_KEY = 'web_quiz_events_v2';
// The rung job (web-quiz-rungs.js): read-side; effective only with web_quiz_challenge_v2 and its parent web_quiz_challenge on.
const CHALLENGE_V2_KEY = 'web_quiz_challenge_v2';
const RUNGS_KEY = 'web_quiz_challenge_rungs';
// The read-along preview on the hub (#listen/<pid>): the hub JSON names it so the edge adds its script (web-quiz-hub.js).
const READALONG_KEY = 'web_quiz_readalong';
// The designed wait (web-quiz-wait-ux.js) rides this one read: only the stored JSON boolean true is on.
const WAIT_UX_KEY = 'web_quiz_wait_ux';
// The child home's files preloaded in the head the edge sends before the hub answers: the hub JSON names it (`home_pre`).
const HOME_PRELOAD_KEY = 'web_quiz_home_preload';
// The child home's scripts and styles as one file each (the edge's pack): the hub JSON names it (`pack`).
const PACK_KEY = 'web_quiz_pack';
const TTL_MS = 30 * 1000;
let cache = null; // { at, hub, challenge, library, door, childHome, homeButton, backNav, eventsV2, challengeV2, rungs, readalong, waitUx, homePreload, pack }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

const KEYS = Object.freeze([HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, HOME_BUTTON_KEY, BACK_NAV_KEY, EVENTS_V2_KEY, CHALLENGE_V2_KEY, RUNGS_KEY, READALONG_KEY, WAIT_UX_KEY, HOME_PRELOAD_KEY, PACK_KEY]);

function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { at: now, hub: isTrue(by[HUB_KEY]), challenge: isTrue(by[CHALLENGE_KEY]), library: isTrue(by[LIBRARY_KEY]), door: isTrue(by[DOOR_KEY]), childHome: isTrue(by[CHILD_HOME_KEY]),
    homeButton: isTrue(by[HOME_BUTTON_KEY]), backNav: isTrue(by[BACK_NAV_KEY]), eventsV2: isTrue(by[EVENTS_V2_KEY]),
    challengeV2: isTrue(by[CHALLENGE_V2_KEY]), rungs: isTrue(by[RUNGS_KEY]), readalong: isTrue(by[READALONG_KEY]), waitUx: by[WAIT_UX_KEY] === true,
    // only the JSON boolean true (the string 'true', 1 or an object are off)
    homePreload: by[HOME_PRELOAD_KEY] === true, pack: by[PACK_KEY] === true };
}

/**
 * Another module's one app_settings read that asked for KEYS too (the join's, quiz_join_fast) fills an empty or
 * expired cache from its rows, so no second read follows; a live cache is left as it is.
 */
function prime(rows, now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return;
  cache = fromRows(rows, now);
}

async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = fromRows(data, now);
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    return { hub: false, challenge: false, library: false, door: false, childHome: false, homeButton: false, backNav: false, eventsV2: false, challengeV2: false, rungs: false, readalong: false, waitUx: false, homePreload: false, pack: false };
  }
}

/** Events v2 on: web_quiz_events_v2 AND its parent web_quiz_hub (cached 30 s, fails closed). Never throws. */
async function eventsV2On() {
  try {
    const f = await flags();
    return Boolean(f.hub && f.eventsV2);
  } catch (_) {
    return false;
  }
}

/** The rung job on: web_quiz_challenge_rungs AND web_quiz_challenge_v2 AND web_quiz_challenge (cached 30 s, fails closed). */
async function rungsOn() {
  try {
    const f = await flags();
    return Boolean(f.challenge && f.challengeV2 && f.rungs);
  } catch (_) {
    return false;
  }
}

/**
 * The same switch, never waited for (the synchronous page-event relay): the cached answer, refreshed in the
 * background when stale; off until the first read lands.
 */
function eventsV2Now(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) flags().catch(() => {});
  return Boolean(cache && cache.hub && cache.eventsV2);
}

/**
 * web_quiz_wait_ux, never waited for and never read on its own: only the cache the hub's (or the join's) own read keeps
 * warm. Off when that cache is empty or older than the TTL, so a route the hub never touches makes no settings read.
 */
function waitUxNow(now = Date.now()) {
  return Boolean(cache && cache.waitUx && now - cache.at < TTL_MS);
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

/**
 * `<portal>/h/<token>` for these children, or null (hub off, no base URL, no secret, no child). Never throws.
 * `caller` names the builder on a dropped-id log line (signHub's default when omitted); or `{ caller, lang }` in its
 * place: `lang` (en|ur) is the language the reply or landing speaks, carried in the token only with web_quiz_return_lang on.
 */
async function hubLink(studentIds, caller) {
  try {
    const Link = require('./web-quiz-link');
    const base = Link.webBaseUrl();
    if (!base || !(await flags()).hub) return null;
    const opts = caller && typeof caller === 'object' ? caller : { caller };
    const R = require('./web-quiz-return-lang');
    const lang = R.linkLang(opts.lang) && (await R.on()) ? opts.lang : null;
    const token = lang ? T.signHub(studentIds, opts.caller, { lang }) : T.signHub(studentIds, opts.caller);
    return token ? `${base}/h/${token}` : null;
  } catch (err) {
    logToFile('⚠️ web quiz hub: no hub link', { error: err.message });
    return null;
  }
}

module.exports = { flags, prime, KEYS, hubLink, pageNav, eventsV2On, eventsV2Now, waitUxNow, rungsOn, EVENTS_V2_KEY, WAIT_UX_KEY, RUNGS_KEY, HOME_BUTTON_KEY, BACK_NAV_KEY, HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, HOME_PRELOAD_KEY, PACK_KEY, _resetCache: () => { cache = null; } };
