'use strict';
/**
 * The kid hub's switches (app_settings web_quiz_hub / web_quiz_challenge / web_quiz_library / web_quiz_hub_door /
 * web_quiz_child_quiz_home / web_quiz_events_v2 / web_quiz_challenge_v2 / web_quiz_challenge_rungs / web_quiz_readalong /
 * web_quiz_wait_ux / web_quiz_server_timing / web_quiz_hub_fanout / web_quiz_hub_child_memo),
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
// One button system on the child pages (web-quiz-one-button.js): rides this one read, so it adds no read of its own.
// Only the stored JSON boolean true turns it on (not this module's 'true' string rule).
const ONE_BUTTON_KEY = 'web_quiz_one_button';
// The adventure look on the child pages (web-quiz-adventure-look.js): rides this one read too, by the same JSON true rule.
const ADV_KEY = 'web_quiz_adventure_look';
// The designed wait (web-quiz-wait-ux.js) rides this one read: only the stored JSON boolean true is on.
const WAIT_UX_KEY = 'web_quiz_wait_ux';
// The child home's step timings (web-quiz-server-timing.js): read in this same query, so the switch adds no settings read.
const SERVER_TIMING_KEY = 'web_quiz_server_timing';
// The hub's reads started together and its switches kept warm (web-quiz-hub.js, web-quiz-hub-warm.js): only JSON true.
const FANOUT_KEY = 'web_quiz_hub_fanout';
// The children's own rows read once per hub answer (web-quiz-hub-child-rows.js): only JSON true.
const CHILD_MEMO_KEY = 'web_quiz_hub_child_memo';
// The one share (web-quiz-card-switch.js: the card on AND the share on, each only as JSON true) rides this read too, so
// a home link (the join's, a hub reply's) learns whether to look for a shared card's kept item with no read of its own.
const CARD_KEY = 'web_quiz_card_v3';
const SHARE_KEY = 'web_quiz_share_v4';
// The portal learns the page switches from the bot (web-quiz-edge-learn.js): read in this same query, so the hub answer
// can say it is on (`edge_learn: true`) with no settings read of its own. JSON true only.
const EDGE_LEARN_KEY = 'web_quiz_edge_learn';
// The child home's files preloaded in the head the edge sends before the hub answers: the hub JSON names it (`home_pre`).
const HOME_PRELOAD_KEY = 'web_quiz_home_preload';
// The wordless first paint (web-quiz-plain-paint.js) rides this read on the hub, so a child's home adds no settings read.
const PLAIN_PAINT_KEY = 'web_quiz_plain_paint';
// The closed and not-open pages in the child's language (web-quiz-closed-lang.js) ride this read on the hub, so a
// child's home adds no settings read for it.
const CLOSED_LANG_KEY = 'web_quiz_closed_lang';
// web_quiz_hub_waves2 (JSON true only, and only with fanout on): the hub's longest read chains start earlier (hub.js)
const WAVES2_KEY = 'web_quiz_hub_waves2';
// The live reading meter (web-quiz-live-read-v3.js meter/forHub): its variant and its parent (live reading v3) ride this
// one read, so the hub learns the meter with no settings read of its own. 'sky' | 'vine' (a JSON true is 'sky'), else null.
const LIVE_METER_KEY = 'web_quiz_live_meter';
const LIVE_READ_V3_KEY = 'web_quiz_live_read_v3';
const METERS = ['sky', 'vine'];
function meterOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  if (isTrue(v)) return 'sky';
  const n = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return METERS.indexOf(n) >= 0 ? n : null;
}
const TTL_MS = 30 * 1000;
let cache = null; // { at, hub, challenge, library, door, childHome, homeButton, backNav, eventsV2, challengeV2, rungs, readalong, oneButton, waitUx, serverTiming, fanout, childMemo, shareOpen, adv, homePreload, waves2 }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

const KEYS = Object.freeze([HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, HOME_BUTTON_KEY, BACK_NAV_KEY, EVENTS_V2_KEY, CHALLENGE_V2_KEY, RUNGS_KEY, READALONG_KEY, ONE_BUTTON_KEY, WAIT_UX_KEY, SERVER_TIMING_KEY, FANOUT_KEY, CHILD_MEMO_KEY, CARD_KEY, SHARE_KEY, ADV_KEY, HOME_PRELOAD_KEY, CLOSED_LANG_KEY, PLAIN_PAINT_KEY, EDGE_LEARN_KEY, WAVES2_KEY, LIVE_METER_KEY, LIVE_READ_V3_KEY]);

function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  return { at: now, hub: isTrue(by[HUB_KEY]), challenge: isTrue(by[CHALLENGE_KEY]), library: isTrue(by[LIBRARY_KEY]), door: isTrue(by[DOOR_KEY]), childHome: isTrue(by[CHILD_HOME_KEY]),
    homeButton: isTrue(by[HOME_BUTTON_KEY]), backNav: isTrue(by[BACK_NAV_KEY]), eventsV2: isTrue(by[EVENTS_V2_KEY]),
    challengeV2: isTrue(by[CHALLENGE_V2_KEY]), rungs: isTrue(by[RUNGS_KEY]), readalong: isTrue(by[READALONG_KEY]), oneButton: by[ONE_BUTTON_KEY] === true, waitUx: by[WAIT_UX_KEY] === true,
    // only the JSON boolean true (the string 'true', 1 or an object are off)
    serverTiming: by[SERVER_TIMING_KEY] === true, fanout: by[FANOUT_KEY] === true, childMemo: by[CHILD_MEMO_KEY] === true,
    shareOpen: by[CARD_KEY] === true && by[SHARE_KEY] === true, adv: by[ADV_KEY] === true,
    edgeLearn: by[EDGE_LEARN_KEY] === true,
    homePreload: by[HOME_PRELOAD_KEY] === true, closedLang: by[CLOSED_LANG_KEY] === true, plainPaint: by[PLAIN_PAINT_KEY] === true, waves2: by[WAVES2_KEY] === true, liveMeter: meterOf(by[LIVE_METER_KEY]), liveReadV3: isTrue(by[LIVE_READ_V3_KEY]) };
}

/**
 * Another module's one app_settings read that asked for KEYS too (the join's, quiz_join_fast) fills an empty or
 * expired cache from its rows, so no second read follows; a live cache is left as it is.
 */
function prime(rows, now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return;
  cache = fromRows(rows, now);
}

// One read in flight at a time: a page that looks at two of these switches at once (the hub and its one-button
// field) shares the read instead of sending a second.
let reading = null;
function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache);
  if (!reading) reading = read(now).finally(() => { reading = null; });
  return reading;
}

async function read(now) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = fromRows(data, now);
    return cache;
  } catch (err) {
    logToFile('⚠️ web quiz hub: settings lookup failed — hub off', { error: err.message });
    return { hub: false, challenge: false, library: false, door: false, childHome: false, homeButton: false, backNav: false, eventsV2: false, challengeV2: false, rungs: false, readalong: false, oneButton: false, waitUx: false, serverTiming: false, fanout: false, adv: false, homePreload: false, edgeLearn: false };
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
 * web_quiz_one_button, never waited for and never read on its own from a cold cache: off until the hub's (or the
 * join's) one read fills the cache; a stale value answers at once and is refreshed in the background; off once it is
 * older than twice the cache time (a refresh that never comes back).
 */
function oneButtonNow(now = Date.now()) {
  if (cache && now - cache.at >= TTL_MS) flags(now).catch(() => {});
  return Boolean(cache && cache.oneButton && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_adventure_look, never waited for: as oneButtonNow (the cached answer, off when cold or too old). */
function advNow(now = Date.now()) {
  if (!cache || now - cache.at >= TTL_MS) flags(now).catch(() => {});
  return Boolean(cache && cache.adv && now - cache.at < 2 * TTL_MS);
}

/**
 * web_quiz_wait_ux, never waited for and never read on its own: only the cache the hub's (or the join's) own read keeps
 * warm. Off when that cache is empty or older than 2 TTLs (a hub answer built across the 30 s mark keeps it), so a
 * route the hub never touches makes no settings read.
 */
function waitUxNow(now = Date.now()) {
  return Boolean(cache && cache.waitUx && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_hub_fanout from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function fanoutNow(now = Date.now()) {
  return Boolean(cache && cache.fanout && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_hub_waves2 from the same cache, never read here: on only with fanout on (the shorter chains run inside its branch). */
function waves2Now(now = Date.now()) {
  return Boolean(fanoutNow(now) && cache.waves2);
}

/** web_quiz_hub_child_memo from the hub's own switch cache, never read here: as fanoutNow. */
function childMemoNow(now = Date.now()) {
  return Boolean(cache && cache.childMemo && now - cache.at < 2 * TTL_MS);
}

/**
 * The step-timings switch, never waited for and never reading: the batch's cached answer (refreshed by the hub's own
 * flags() call on every hub answer); off until the first read lands, off on a failed read, off when the cache is older
 * than twice its life.
 */
function serverTimingNow(now = Date.now()) {
  return Boolean(cache && cache.serverTiming === true && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_edge_learn, never waited for: the hub's cached value (the hub's read has just run on a hub answer); off when none. */
function edgeLearnNow(now = Date.now()) {
  return Boolean(cache && cache.edgeLearn === true && now - cache.at < TTL_MS);
}

/**
 * The one share on, never read on its own: only the cache this module's read (or the join's) keeps warm, as waitUxNow.
 * A home link is made right after hubLink() read it, so off (or a failed read) asks nothing more. Never throws.
 */
function shareOpenNow(now = Date.now()) {
  return Boolean(cache && cache.shareOpen && now - cache.at < TTL_MS);
}

/** web_quiz_plain_paint from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function plainPaintNow(now = Date.now()) {
  return Boolean(cache && cache.plainPaint && now - cache.at < 2 * TTL_MS);
}

/** web_quiz_closed_lang from the hub's own switch cache, never read here: off when the cache is empty or older than 2 TTLs. */
function closedLangNow(now = Date.now()) {
  return Boolean(cache && cache.closedLang && now - cache.at < 2 * TTL_MS);
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

module.exports = { flags, prime, KEYS, hubLink, pageNav, eventsV2On, eventsV2Now, oneButtonNow, advNow, waitUxNow, serverTimingNow, closedLangNow, CLOSED_LANG_KEY, plainPaintNow, PLAIN_PAINT_KEY, fanoutNow, childMemoNow, shareOpenNow, rungsOn, ONE_BUTTON_KEY, ADV_KEY, EVENTS_V2_KEY, WAIT_UX_KEY, SERVER_TIMING_KEY, FANOUT_KEY, CHILD_MEMO_KEY, RUNGS_KEY, HOME_BUTTON_KEY, BACK_NAV_KEY, HUB_KEY, CHALLENGE_KEY, LIBRARY_KEY, DOOR_KEY, CHILD_HOME_KEY, HOME_PRELOAD_KEY, _resetCache: () => { cache = null; reading = null; }, edgeLearnNow, EDGE_LEARN_KEY, waves2Now, WAVES2_KEY, LIVE_METER_KEY, LIVE_READ_V3_KEY };
