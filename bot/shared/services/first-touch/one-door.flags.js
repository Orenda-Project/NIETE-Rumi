'use strict';
/**
 * The one door's switch and its reply ceiling (app_settings), read like the identity switches: ONE `.in()` read of
 * two keys, 30 s cache, fail closed.
 *
 *   on        = quiz_one_door                          every quiz request from any phone → ONE cta_url reply into the
 *                                                      page that decides teacher or child (first-touch/one-door.service)
 *   ownCap    = web_quiz_own_reply_cap_per_phone       the ceiling of the `reply_to_own_message` counter (absent → 20)
 *   eventsV3  = web_quiz_events_v3                     the v3 event names (quiz_cmd, role_asked, role_answered) are written
 *   teacherHome = quiz_teacher_home                    the teacher home serves (else a teacher lands on the maker page)
 *   doorUncapped = web_quiz_door_uncapped              the answer to a quiz request is never capped on `reply_to_own_message`
 *                                                      (still counted on the ledger); JSON true only
 *   doorDedupe = web_quiz_door_dedupe                  the same text from the same phone inside 10 s gets ONE door reply;
 *                                                      JSON true only
 *   doorCeiling = web_quiz_door_ceiling                a VALUE: door replies per phone per PKT day; a positive JSON integer,
 *                                                      anything else (absent, a string, 0, a fraction) → null = no ceiling
 *   adv       = web_quiz_adventure_look                the door's pages (role question, sheet, way back) in the adventure
 *               AND web_quiz_one_button                look; both JSON true only (the same read: no read is added)
 *
 * Absent / unreadable → { on:false, ownCap:20, eventsV3:false, teacherHome:false, doorUncapped:false, doorDedupe:false, doorCeiling:null }: every caller's path is today's. Read only on a quiz-shaped turn (and
 * by the ledger for a reply marked ownReply), so no other message pays for it. A failed read is kept for the same 30 s
 * (settings/switch-cache): the last good flags this process read, else OFF — an outage costs one read per 30 s.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { cachedSwitch } = require('../settings/switch-cache');

const ONE_DOOR_KEY = 'quiz_one_door';
const OWN_CAP_KEY = 'web_quiz_own_reply_cap_per_phone';
const EVENTS_V3_KEY = 'web_quiz_events_v3';
const TEACHER_HOME_KEY = 'quiz_teacher_home';
const DOOR_UNCAPPED_KEY = 'web_quiz_door_uncapped';
const DOOR_DEDUPE_KEY = 'web_quiz_door_dedupe';
const DOOR_CEILING_KEY = 'web_quiz_door_ceiling';
const OWN_CAP_DEFAULT = 20;
const TTL_MS = 30 * 1000;
const Adv = require('./adventure-look');
const OFF = Object.freeze({ on: false, ownCap: OWN_CAP_DEFAULT, eventsV3: false, teacherHome: false, doorUncapped: false, doorDedupe: false, doorCeiling: null, adv: false });

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

// JSON true only: a string 'true' row is off
const isJsonTrue = (value) => value === true;

/** An app_settings value → an integer ceiling ≥ 1; anything that is not an integer → the default. */
function capOf(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return OWN_CAP_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) ? Math.max(1, n) : OWN_CAP_DEFAULT;
}

/** The door ceiling: a positive JSON integer, else null (no ceiling). The string '100' is not a ceiling. */
const ceilingOf = (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: OFF,
  read: async (now) => {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [ONE_DOOR_KEY, OWN_CAP_KEY, EVENTS_V3_KEY, TEACHER_HOME_KEY, DOOR_UNCAPPED_KEY, DOOR_DEDUPE_KEY, DOOR_CEILING_KEY, ...Adv.KEYS]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return { at: now, on: isTrue(by[ONE_DOOR_KEY]), ownCap: capOf(by[OWN_CAP_KEY]), eventsV3: isTrue(by[EVENTS_V3_KEY]), teacherHome: isTrue(by[TEACHER_HOME_KEY]), doorUncapped: isJsonTrue(by[DOOR_UNCAPPED_KEY]), doorDedupe: isJsonTrue(by[DOOR_DEDUPE_KEY]), doorCeiling: ceilingOf(by[DOOR_CEILING_KEY]), adv: Adv.advDrawn(by) };
  },
  log: (err) => logToFile('⚠️ one door: settings lookup failed — switch off', { error: err.message }),
});

/** → { on, ownCap, eventsV3, teacherHome, doorUncapped, doorDedupe, doorCeiling, adv }; a failed read → the last good flags, else OFF, for 30 s. Never throws. */
async function flags(now = Date.now()) {
  return cache.get(now);
}

/** true only when quiz_one_door is ON. Never throws. */
async function on() {
  try { return Boolean((await flags()).on); } catch (_) { return false; }
}

module.exports = { flags, on, capOf, ceilingOf, ONE_DOOR_KEY, OWN_CAP_KEY, EVENTS_V3_KEY, TEACHER_HOME_KEY, DOOR_UNCAPPED_KEY, DOOR_DEDUPE_KEY, DOOR_CEILING_KEY, OWN_CAP_DEFAULT, _resetCache: () => { cache.reset(); } };
