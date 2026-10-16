'use strict';
/**
 * The first-touch door's menu row (DOOR.md §4): `menu_quiz` tapped by an UNKNOWN phone with the door on.
 *
 * menu.service.js's `menu_quiz` case calls handleMenuQuiz() ONCE, after its own quizEnabled gate and before today's
 * TranscriptQuizList.showList. true = the door answered; false = today's list, untouched. It answers only a phone
 * whose verdict is unknown (personaReason first_door / no_student_row) — a known teacher's verdict is never unknown,
 * so their row is byte-identical. The keys are read ONCE:
 *   no key        → the teacher key written, the maker reply (who 'unknown', via 'menu')     door:'menu', reply maker
 *   teacher key   → the maker reply, no write
 *   child key     → the family reply (its body names the typed way out «”ٹیچر“»), no write
 *   capped        → family.fallback as plain text, no write                                  reply capped_family
 * Never the chooser from the row (the row is a teacher's answer). A read error → false (today's list).
 * Language (DOOR §7.1): the row has no typed body → bi, unless the person's own preferred_language is 'ur'.
 */
const { logToFile } = require('../../utils/logger');
const IdFlags = require('../quiz/web-quiz-identity-flags');
const Keys = require('./door.keys');
const Door = require('./door.service');

const UNKNOWN_REASONS = new Set([Door.FIRST_DOOR_REASON, 'no_student_row']);
const VERDICT_OF = { chooser: ['unknown', 'no_key'], maker: ['teacher', 'teacher_key'], family: ['child', 'child_key'], capped: ['unknown', 'capped'] };

/** @returns {Promise<boolean>} true = answered; false = today's showList */
async function handleMenuQuiz({ user, from } = {}) {
  if (!user || !user.id || !UNKNOWN_REASONS.has(user.personaReason)) return false;
  let door;
  try {
    if (!(await IdFlags.flags()).firstDoor) return false;
    door = Door.decideDoor(await Keys.readDoorKeys(user.id));
  } catch (err) {
    logToFile('⚠️ first-touch door: the menu row could not read the keys — today\'s list', { error: err && err.message });
    return false;
  }
  const Reply = require('./door.reply');
  const lang = user.preferred_language === 'ur' ? 'ur' : 'bi';
  const [verdict, reason] = VERDICT_OF[door] || VERDICT_OF.chooser;
  const base = { from, user, door: 'menu', verdict, reason, lang, script: 'none' };
  if (door === 'capped') {
    const reply = await Reply.sendCappedReply({ from, lang, reason: 'menu' });
    Reply.logDoor({ ...base, store: 'capped', reply });
    return true;
  }
  if (door === 'family') {
    const reply = await Reply.sendFamilyReply({ from, user, lang, reason: 'menu', ukey: Reply.ukeyFor(from) });
    Reply.logDoor({ ...base, store: 'none', reply });
    return true;
  }
  let wrote = false;
  if (door === 'chooser') {
    try { await Keys.markTeacher(user.id, from); wrote = true; } catch (err) {
      logToFile('⚠️ first-touch door: a key write failed (the reply still goes)', { error: err && err.message });
    }
  }
  const reply = await Reply.sendMakerReply({ from, user, lang, who: 'unknown', via: 'menu', reason: 'menu' });
  Reply.logDoor({ ...base, store: wrote ? 'teacher' : 'none', reply });
  return true;
}

module.exports = { handleMenuQuiz };
