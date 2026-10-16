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
    if (door === 'family' && flags.guestHome) { noteRead(user.id, null, keys); return null; }   // the hand-off: their guest verdict answers this phone
    noteRead(user.id, door, keys);
    return { persona: null, mode: 'unknown', reason: FIRST_DOOR_REASON, door, language: null, studentClass: null };
  } catch (err) {
    logToFile('⚠️ first-touch door: the key read failed — today\'s path for this message', { error: err && err.message, phone: undefined });
    if (user && user.id) noteRead(user.id, null, null);
    return null;
  }
}

// ── the door's handler: the undo words, the claim, the quiz request, the taps (DOOR.md §5.3) ────────────────────
//
// route() (student-ingress) calls handle() ONCE, after the binder's JUGNU-/STOP words and before the persona return.
// It answers only an UNKNOWN phone (personaReason first_door or no_student_row) with the door on; every other phone
// and every message it does not claim returns false = today's dispatch, untouched.

const DOOR_REASONS = new Set([FIRST_DOOR_REASON, 'no_student_row']);
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;      // Asia/Karachi: UTC+5, no DST

/**
 * The read this turn's classify() made, handed to the handler so a cold turn reads the keys ONCE: classify and route
 * run in the same process for the same message, one after the other. A turn whose verdict came from the cache has
 * no note (warm: re-send, no read, +0). A note older than a few seconds is never used.
 */
const READ_NOTE_MS = 10 * 1000;
const readNotes = new Map();   // user id → { door, keys, at }
function noteRead(userId, door, keys) {
  if (readNotes.size > 1000) readNotes.clear();
  readNotes.set(String(userId), { door, keys, at: Date.now() });
}
function takeRead(userId) {
  const k = String(userId);
  const n = readNotes.get(k);
  readNotes.delete(k);
  return n && Date.now() - n.at <= READ_NOTE_MS ? n : null;
}

/** The inbound normaliser (COPY M10, DOOR §5.2): ours, never inside looksLikeTeacherClaim. */
const STRIP = /[“”"'«»‎‏⁦-⁩]/g;
function normaliseInbound(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(STRIP, '').normalize('NFKC').toLowerCase().trim().replace(/[!.?۔،,\s]+$/u, '').trim();
}

/** COPY M10's words, through the same normaliser, compared WHOLE (a substring never matches). */
const UNDO_WORDS = {
  child: ['child', 'bacha', 'bachay', 'بچہ', 'بچے'],
  teacher: ['teacher', 'ٹیچر', 'استاد', 'استانی', 'i am a teacher', "i'm a teacher", 'میں ٹیچر ہوں', 'میں استاد ہوں'],
};
const UNDO = new Map(Object.entries(UNDO_WORDS).flatMap(([side, words]) => words.map((w) => [normaliseInbound(w), side])));
/** → 'teacher' | 'child' | null, on the whole normalised message. */
function matchUndo(text) {
  const n = normaliseInbound(text);
  return (n && UNDO.get(n)) || null;
}

/** The typed body's script: Arabic script in the first token → arabic; a letter → latin; else none. */
function scriptOf(body) {
  const first = String(body || '').replace(STRIP, '').trim().split(/\s+/)[0] || '';
  if (/\p{Script=Arabic}/u.test(first)) return 'arabic';
  if (/\p{L}/u.test(first)) return 'latin';
  return 'none';
}

/**
 * The reply's language (DOOR §7, COPY §0 "Script rule per reply"): a tap (no typed body) → bi; Arabic → ur; Latin →
 * bi; a slash command → bi unless the person's row says ur. users.preferred_language DEFAULTS to 'en' on every new row
 * (add_preferred_language_to_users.sql), so 'en' is never read as a choice: never door.body.en on the default.
 */
function langFor({ body, user, afterTap = false } = {}) {
  const text = String(body || '').trim();
  if (afterTap || !text) return 'bi';
  if (scriptOf(text) === 'arabic') return 'ur';
  if (text.startsWith('/') && user && user.preferred_language === 'ur') return 'ur';
  return 'bi';
}

/** Is `date` on today's Asia/Karachi calendar date? false for no date. */
function isTodayPKT(date, now = new Date()) {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return false;
  const day = (ms) => new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
  return day(t) === day(new Date(now).getTime());
}

/** The guest's "quiz-shaped" (student-ingress guestAsksForQuiz): /quiz as the first token, or a bare-text quiz request. */
function quizShaped(text) {
  if (text.split(/\s+/)[0].toLowerCase() === '/quiz') return true;
  const QuizMenuFlags = require('../quiz/quiz-menu-flags');
  const { isQuizMenuRequest } = require('../quiz/quiz-menu-request');
  return !text.startsWith('/') && QuizMenuFlags.bareTextToMenu() && isQuizMenuRequest(text);
}

/** /register, or a registration keyword (the claim predicate's own): today's registration reply keeps the message. */
const REGISTER = /^\/register(?:\s|$)|\b(?:register|registration|sign\s*up)\b|رجسٹر/i;

/** A key write that never costs the reply (the store down: the reply still goes — the teacher's escape holds). → true when attempted. */
async function writeKey(fn, ...args) {
  try { await fn(...args); return true; } catch (err) {
    logToFile('⚠️ first-touch door: a key write failed (the reply still goes)', { error: err && err.message });
    return false;
  }
}

/** What each door verdict means on the event. */
const VERDICT_OF = { chooser: ['unknown', 'no_key'], maker: ['teacher', 'teacher_key'], family: ['child', 'child_key'], capped: ['unknown', 'capped'] };

/** A typed undo word (a) or the claim phrase (a′): the key, the reply, the event. */
async function answerWord({ user, from, text, side, door }) {
  const Reply = require('./door.reply');
  const lang = langFor({ body: text, user });
  const script = scriptOf(text);
  const ukey = Reply.ukeyFor(from);
  let reply;
  if (side === 'child') {
    const wrote = await writeKey(Keys.markChild, user.id, from);
    reply = await Reply.sendFamilyReply({ from, user, lang, reason: door, ukey });
    Reply.logDoor({ from, user, door, store: wrote ? 'child' : 'none', reply, lang, script });
  } else {
    const wrote = await writeKey(Keys.markTeacher, user.id, from);
    reply = await Reply.sendMakerReply({ from, user, lang, who: 'unknown', via: 'door', reason: door });
    Reply.logDoor({ from, user, door, store: wrote ? 'teacher' : 'none', reply, lang, script });
  }
  return true;
}

/** A quiz-shaped text (b): the reply the door's verdict names. */
async function answerQuiz({ user, from, text, note }) {
  const Reply = require('./door.reply');
  let door = note ? note.door : null;
  let keys = note ? note.keys : null;
  if (!note && user.personaReason === FIRST_DOOR_REASON) {
    // warm: the verdict this phone cached ≤ 60 s ago — the same reply, no read, +0
    try { door = ((await require('../student-ingress-cache').get(from)) || {}).door || null; } catch (_) { door = null; }
  }
  if (!note && !door) {
    // a warm 10-minute no_student_row (a non-quiz message cached it) must not hide the chooser (§1.5): read here
    const v = await doorVerdict({ user, phone: from, body: text, quizShaped: true });
    const fresh = takeRead(user.id);
    door = v ? v.door : null;
    keys = fresh ? fresh.keys : null;
  }
  if (!door) return false;
  const lang = langFor({ body: text, user });
  const script = scriptOf(text);
  const [verdict, reason] = VERDICT_OF[door] || ['unknown', 'no_key'];
  const base = { from, user, door: 'text', verdict, reason, lang, script };
  if (door === 'capped') {
    // asked on two PKT days with no key (§3.2): family.fallback as plain text, no write — never the chooser, the
    // maker or today's teacher home; the text names the teacher's typed way out
    const reply = await Reply.sendCappedReply({ from, lang, reason: 'text' });
    Reply.logDoor({ ...base, store: 'capped', reply });
    return true;
  }
  if (door === 'maker') {
    const reply = await Reply.sendMakerReply({ from, user, lang, who: 'door', via: 'door', reason: 'text' });
    Reply.logDoor({ ...base, store: 'none', reply });
    return true;
  }
  if (door === 'family') {
    const reply = await Reply.sendFamilyReply({ from, user, lang, reason: 'text', ukey: Reply.ukeyFor(from) });
    Reply.logDoor({ ...base, store: 'none', reply });
    return true;
  }
  // the chooser: the SHOW counts once per PKT day (+1 only when the asked row was not touched today); a warm
  // re-send (no keys read this turn) is +0 and writes nothing
  let wrote = false;
  const asked = keys ? keys[Keys.KEYS.ASKED] : null;
  const beforeSend = keys ? async () => {
    await Keys.markAsked(user.id, from, { increment: !isTodayPKT(asked && asked.usedAt) });
    wrote = true;
  } : null;
  const reply = await Reply.sendChooser({ from, lang, reason: 'text', beforeSend });
  Reply.logDoor({ ...base, store: wrote ? 'asked' : 'none', reply });
  return true;
}

/** A tap on one of the door's buttons (c). */
async function answerTap({ user, from, id }) {
  const Reply = require('./door.reply');
  const base = { from, user, door: 'text', lang: 'bi', script: 'none' };
  if (id === Reply.IDS.DOOR_TEACHER) {
    const wrote = await writeKey(Keys.markTeacher, user.id, from);
    const reply = await Reply.sendMakerReply({ from, user, lang: 'bi', who: 'unknown', via: 'door', reason: 'tap' });
    Reply.logDoor({ ...base, store: wrote ? 'teacher' : 'none', reply, tap: 'teacher' });
    return true;
  }
  if (id === Reply.IDS.DOOR_CHILD) {
    const wrote = await writeKey(Keys.markChild, user.id, from);
    const reply = await Reply.sendFamilyReply({ from, user, lang: 'bi', reason: 'tap', ukey: Reply.ukeyFor(from) });
    Reply.logDoor({ ...base, store: wrote ? 'child' : 'none', reply, tap: 'child' });
    return true;
  }
  // the maker fallback's three buttons open the SAME entries their menu rows open today (FIRST_QUIZ §10.2)
  const ROW = { [Reply.IDS.MK_READY]: 'menu_videos', [Reply.IDS.MK_PLAN]: 'menu_lesson_plan', [Reply.IDS.MK_RECORD]: 'menu_coaching' };
  if (ROW[id]) {
    const MenuService = require('../menu.service');
    const { clampLanguage } = require('../../config/ux-strings');
    await MenuService.handleMenuButtonResponse(user, from, ROW[id], clampLanguage(user.preferred_language));
    return true;
  }
  return false;
}

/**
 * The door's handler. true = the door answered this message; false = today's dispatch. Never throws.
 * @param {{ user: object, from: string, type: string, body?: string, message?: object }} p
 */
async function handle({ user, from, type, body, message } = {}) {
  try {
    if (!user || !user.id || !DOOR_REASONS.has(user.personaReason)) return false;
    const kind = type || (message && message.type) || '';
    if (kind !== 'text' && kind !== 'interactive') return false;
    const note = takeRead(user.id);
    if (!(await IdFlags.flags()).firstDoor) return false;

    if (kind === 'interactive') {
      const reply = message && message.interactive && message.interactive.type === 'button_reply' ? message.interactive.button_reply : null;
      return reply ? await answerTap({ user, from, id: String(reply.id || '') }) : false;
    }

    const text = String(body || '').trim();
    if (!text) return false;
    const side = matchUndo(text);                                                   // (a) a whole-message undo word
    if (side) return await answerWord({ user, from, text, side, door: 'undo' });
    if (REGISTER.test(text) && (text.startsWith('/') || StudentMode().looksLikeTeacherClaim(text))) {
      // /register (and the registration keyword): the teacher key written silently; today's registration reply
      const Reply = require('./door.reply');
      const wrote = await writeKey(Keys.markTeacher, user.id, from);
      Reply.logDoor({ from, user, door: 'claim', store: wrote ? 'teacher' : 'none', reply: 'today', lang: langFor({ body: text, user }), script: scriptOf(text) });
      return false;
    }
    if (!text.startsWith('/') && StudentMode().looksLikeTeacherClaim(text)) {       // (a′) the sister's claim phrase
      return await answerWord({ user, from, text, side: 'teacher', door: 'claim' });
    }
    if (quizShaped(text)) return await answerQuiz({ user, from, text, note });      // (b)
    return false;                                                                    // (d) anything else: today's
  } catch (err) {
    logToFile('⚠️ first-touch door: the handler threw — today\'s path for this message', { error: err && err.message });
    return false;
  }
}

/** The sister's predicate, read-only (student-mode.service looksLikeTeacherClaim, never edited). */
const StudentMode = () => require('../student-mode.service');

module.exports = {
  FIRST_DOOR_REASON, FIRST_DOOR_TTL_SECS, CAP_SHOWS, decideDoor, doorVerdict,
  normaliseInbound, matchUndo, scriptOf, langFor, isTodayPKT, handle,
  _forgetReads: () => readNotes.clear(),
};
