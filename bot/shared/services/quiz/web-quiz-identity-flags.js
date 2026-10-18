'use strict';
/**
 * The child identity store's switches (app_settings), read like web-quiz-hub-flags.js
 * (30 s cache, fail closed). Each is effective only with its parent on:
 *
 *   canon      = web_quiz_identity_canon && web_quiz_hub    fold ids through canonicalStudentIds + merged_into
 *   phoneBind  = web_quiz_phone_bind     && canon && WQ_TOMB_SALT set   family phone bindings read and written
 *   guestHome  = web_quiz_guest_home     && phoneBind       an unknown phone's /quiz gets a guest hub
 *
 * The first-touch door's two switches ride the same map (no new read for a switch on the unknown path):
 *
 *   makerPage  = quiz_maker_page                           the teacher's quiz-maker page and its cta
 *   firstDoor  = quiz_first_door      && makerPage         the chooser on an unknown phone's quiz request
 *                                                          (a teacher tap must land on the maker, never a dead end)
 *
 * All off → every caller's path is today's.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const HubFlags = require('./web-quiz-hub-flags');

const CANON_KEY = 'web_quiz_identity_canon';
const PHONE_BIND_KEY = 'web_quiz_phone_bind';
const GUEST_HOME_KEY = 'web_quiz_guest_home';
// ── first touch (quiz_maker_page, quiz_first_door): read here so the unknown path makes no new read for a switch ──
const MAKER_PAGE_KEY = 'quiz_maker_page';
const FIRST_DOOR_KEY = 'quiz_first_door';
// ── end first touch ──
const TTL_MS = 30 * 1000;
const KEYS = Object.freeze([CANON_KEY, PHONE_BIND_KEY, GUEST_HOME_KEY, MAKER_PAGE_KEY, FIRST_DOOR_KEY]);
const OFF = Object.freeze({ canon: false, phoneBind: false, guestHome: false, makerPage: false, firstDoor: false });
let cache = null; // { at, canon, phoneBind, guestHome, makerPage, firstDoor }

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** → { canon, phoneBind, guestHome, makerPage, firstDoor }; all false on a failed read. Never throws. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', KEYS);
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = await fromRows(data, now);
    return cache;
  } catch (err) {
    logToFile('⚠️ child identity: settings lookup failed — identity switches off', { error: err.message });
    return { ...OFF };
  }
}

async function fromRows(data, now) {
  const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  const hub = Boolean((await HubFlags.flags(now)).hub);
  const canon = hub && isTrue(by[CANON_KEY]);
  // WQ_TOMB_SALT is a hard parent: without it the store writes nothing and a family's JUGNU- message would meet silence.
  const phoneBind = canon && isTrue(by[PHONE_BIND_KEY]) && Boolean(process.env.WQ_TOMB_SALT);
  const guestHome = phoneBind && isTrue(by[GUEST_HOME_KEY]);
  // ── first touch: the door's hard parent is the maker page; neither reads any switch above ──
  const makerPage = isTrue(by[MAKER_PAGE_KEY]);
  const firstDoor = makerPage && isTrue(by[FIRST_DOOR_KEY]);
  // ── end first touch ──
  return { at: now, canon, phoneBind, guestHome, makerPage, firstDoor };
}

/**
 * Another module's one app_settings read that asked for KEYS and the hub's keys too (the join's, quiz_join_fast)
 * fills an empty or expired cache (and the hub flags') from its rows, so no second read follows. `asked` is the key
 * list that read asked for: a list missing one of this group's keys throws (a hand-written list is caught, never
 * read as off); a key asked for with no row is the normal off. The hub is primed first, even when this cache is live,
 * so a warm identity over a cold hub still leaves the first home nothing to read.
 */
async function prime(rows, now = Date.now(), asked = KEYS.concat(HubFlags.KEYS || [])) {
  const missing = KEYS.filter((k) => !asked.includes(k));
  if (missing.length) throw new Error(`identity flags primed by a read that did not ask for ${missing.join(', ')}`);
  if (typeof HubFlags.prime === 'function') HubFlags.prime(rows, now, asked);
  if (cache && now - cache.at < TTL_MS) return;
  cache = await fromRows(rows, now);
}

module.exports = { flags, prime, KEYS, isTrue, CANON_KEY, PHONE_BIND_KEY, GUEST_HOME_KEY, MAKER_PAGE_KEY, FIRST_DOOR_KEY, _resetCache: () => { cache = null; } };
