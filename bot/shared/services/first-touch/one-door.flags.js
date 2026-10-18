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
 *
 * Absent / unreadable → { on:false, ownCap:20, eventsV3:false, teacherHome:false, doorUncapped:false }: every caller's path is today's. Read only on a quiz-shaped turn (and
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
const OWN_CAP_DEFAULT = 20;
const TTL_MS = 30 * 1000;
const OFF = Object.freeze({ on: false, ownCap: OWN_CAP_DEFAULT, eventsV3: false, teacherHome: false, doorUncapped: false });

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

const cache = cachedSwitch({
  ttlMs: TTL_MS,
  off: OFF,
  read: async (now) => {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [ONE_DOOR_KEY, OWN_CAP_KEY, EVENTS_V3_KEY, TEACHER_HOME_KEY, DOOR_UNCAPPED_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return { at: now, on: isTrue(by[ONE_DOOR_KEY]), ownCap: capOf(by[OWN_CAP_KEY]), eventsV3: isTrue(by[EVENTS_V3_KEY]), teacherHome: isTrue(by[TEACHER_HOME_KEY]), doorUncapped: isJsonTrue(by[DOOR_UNCAPPED_KEY]) };
  },
  log: (err) => logToFile('⚠️ one door: settings lookup failed — switch off', { error: err.message }),
});

/** → { on, ownCap, eventsV3, teacherHome, doorUncapped }; a failed read → the last good flags, else OFF, for 30 s. Never throws. */
async function flags(now = Date.now()) {
  return cache.get(now);
}

/** true only when quiz_one_door is ON. Never throws. */
async function on() {
  try { return Boolean((await flags()).on); } catch (_) { return false; }
}

module.exports = { flags, on, capOf, ONE_DOOR_KEY, OWN_CAP_KEY, EVENTS_V3_KEY, TEACHER_HOME_KEY, DOOR_UNCAPPED_KEY, OWN_CAP_DEFAULT, _resetCache: () => { cache.reset(); } };
