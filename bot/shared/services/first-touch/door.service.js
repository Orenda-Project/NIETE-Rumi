'use strict';
/**
 * The first-touch door — who is holding an UNKNOWN handset that just asked for a quiz.
 *
 * Today that phone gets the teacher's quiz home. With `quiz_first_door` on (read as `firstDoor` through the identity
 * flags, hard parent `quiz_maker_page`), classify() in student-ingress calls doorVerdict() ONCE, after boundVerdict()
 * and before guestVerdict(), only for a quiz-shaped text — so identity, activity, the chat child and the binding have
 * already answered, and no key of ours is ever read for a known phone.
 *
 * The verdict is the guest pattern's shape with one more field:
 *   { persona: null, mode: 'unknown', reason: 'first_door', door, language: null, studentClass: null }
 *   door ∈ chooser (no key: ask once) · maker (teacher key) · family (child key) · capped (asked twice, no key)
 * `persona` stays null, so route() falls through to today's dispatch for every message the door's handler does not
 * claim. It is cached for FIRST_DOOR_TTL_SECS (60 s, as the guest's), never the unknown verdict's 10 minutes.
 *
 * null = today's path: the switch off, a text that is not quiz-shaped, no users row, ANY error in the one read, and
 * the hand-off (child key with the sister's guest home on: their guestVerdict() answers, their reply byte-identical).
 *
 * The decision is pure (decideDoor): identity → activity → chat child → binding first, always (they ran before);
 * between the two door keys the newest feature_used_at wins (last tap wins); a key older than KEY_TTL_DAYS is read as
 * absent; quiz_door_asked never expires. Nothing here writes anything: the writers are door.keys.js's closed list.
 */
const { logToFile } = require('../../utils/logger');
const IdFlags = require('../quiz/web-quiz-identity-flags');
const Keys = require('./door.keys');

const FIRST_DOOR_REASON = 'first_door';
const FIRST_DOOR_TTL_SECS = 60;
/** The chooser is shown at most this many times per phone, ever (one show per PKT day). */
const CAP_SHOWS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A key as readDoorKeys returns it, or null when absent or older than the TTL. */
function liveKey(key, now) {
  if (!key || !key.usedAt) return null;
  const age = now.getTime() - key.usedAt.getTime();
  return age <= Keys.KEY_TTL_DAYS * DAY_MS ? key : null;
}

/** Which door this phone's keys open. Pure. */
function decideDoor(keys = {}, now = new Date()) {
  const teacher = liveKey(keys[Keys.KEYS.TEACHER], now);
  const child = liveKey(keys[Keys.KEYS.CHILD], now);
  if (teacher && child) return teacher.usedAt.getTime() >= child.usedAt.getTime() ? 'maker' : 'family';
  if (teacher) return 'maker';
  if (child) return 'family';
  const asked = keys[Keys.KEYS.ASKED];
  if (asked && asked.count >= CAP_SHOWS) return 'capped';
  return 'chooser';
}

/**
 * The one read. `quizShaped` is the caller's answer to guestAsksForQuiz(type, body) (the sister's predicate, theirs);
 * without it nothing is read.
 * @returns {Promise<object|null>} the verdict, or null = today's path
 */
async function doorVerdict({ user, phone, body, quizShaped = false } = {}) {
  try {
    if (!quizShaped || !user || !user.id) return null;
    const flags = await IdFlags.flags();
    if (!flags.firstDoor) return null;
    const keys = await Keys.readDoorKeys(user.id);
    const door = decideDoor(keys);
    if (door === 'family' && flags.guestHome) return null;      // the hand-off: their guest verdict answers this phone
    return { persona: null, mode: 'unknown', reason: FIRST_DOOR_REASON, door, language: null, studentClass: null };
  } catch (err) {
    logToFile('⚠️ first-touch door: the key read failed — today\'s path for this message', { error: err && err.message, phone: undefined });
    return null;
  }
}

module.exports = { FIRST_DOOR_REASON, FIRST_DOOR_TTL_SECS, CAP_SHOWS, decideDoor, doorVerdict };
