'use strict';
/**
 * The registration invite's guard on the first-touch door's side (DOOR.md §8.4, SPEC §8.7).
 *
 * registration-invite.service's unprompted offer (offerRegistrationOnce: after her first reply, after a feature) asks
 * inviteAllowed() first, in one marked line, after its own "does she still need the form" check — so a complete
 * account never reaches this and its path is byte-identical. → false (no offer) when:
 *   - the turn is a door turn: `turn.firstTouch` ∈ {chooser, family, capped}, or this phone's turn was answered by the
 *     door with the chooser, the family reply or the capped reply a moment ago (noteDoorTurn, set by door.reply's
 *     logDoor; a per-process note keyed by the phone, kept TURN_MS — the door never sees the invite's turn object);
 *   - the phone holds quiz_door_child (one readDoorKeys read, only with `firstDoor` on);
 *   - anything fails (a read error, a throw): no invite is the safe side.
 * Switches OFF → true with no read. The explicit /register path (sendRegistrationInvite) is never guarded: it is asked for.
 */
const IdFlags = require('../quiz/web-quiz-identity-flags');
const Keys = require('./door.keys');

const DOOR_TURNS = new Set(['chooser', 'family', 'capped']);
const TURN_MS = 10 * 1000;
const notes = new Map();   // phone digits → at
const digits = (p) => String(p || '').replace(/\D/g, '');

/** The door answered this phone's turn with `kind` (chooser | family | capped). */
function noteDoorTurn(phone, kind) {
  if (!DOOR_TURNS.has(kind) || !digits(phone)) return;
  if (notes.size > 1000) notes.clear();
  notes.set(digits(phone), Date.now());
}
function recentDoorTurn(phone) {
  const at = notes.get(digits(phone));
  return at !== undefined && Date.now() - at <= TURN_MS;
}

/** @returns {Promise<boolean>} true = the invite may be offered */
async function inviteAllowed({ user, from, turn } = {}) {
  try {
    if (turn && DOOR_TURNS.has(turn.firstTouch)) return false;
    if (from && recentDoorTurn(from)) return false;
    if (!(await IdFlags.flags()).firstDoor) return true;
    if (!user || !user.id) return true;
    const keys = await Keys.readDoorKeys(user.id);
    return !keys[Keys.KEYS.CHILD];
  } catch (_) {
    return false;
  }
}

module.exports = { inviteAllowed, noteDoorTurn, DOOR_TURNS, _forget: () => notes.clear() };
