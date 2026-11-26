'use strict';
/**
 * Jugnu: the words a NIETE user types for the children's reading game.
 *
 * Jugnu is what the main Rumi bot calls the children's reading game ("jugnu", or "reading game"), and on NIETE the same
 * game is the coach app's Learning Assessment: the child plays the battery on the leader's phone (/portal/leader/assess).
 * NIETE had no such word, so "Jugnu" reached the intent classifier, came back `general`, and the chat model wrote a
 * lesson plan about fireflies. Lifted out of the text handler so a test can execute it; the handler carries only the
 * wiring.
 *
 * ─── Words ─────────────────────────────────────────────────────────────────────────────────────────────────────────
 * The main bot's JUGNU_WORDS and its normalisation (whatsapp-ai-bot shared/handlers/child-test-command.js), mirrored:
 * the WHOLE message, any language, the reply in the user's language. A sentence that only mentions Jugnu is not the word.
 * The main bot's older test words are not taken (NIETE's own /egra door owns that vocabulary, and no NIETE copy ever
 * named them).
 *
 * ─── Who it answers: LEADERS only ──────────────────────────────────────────────────────────────────────────────────
 * The leader family (observe-gate LEADER_ROLES). A teacher's Jugnu is exactly today's: NIETE already calls the games and
 * quizzes teachers send home "Jugnu" (the weak-skill game, the round invite, "read along with Jugnu", Jugnu's
 * Challenge), so this door never takes a teacher's word. The text handler asks only after every open conversation
 * (a quiz or video waiting for its topic, a comprehension flow, a coaching reflection, …) has declined the message.
 *
 * ─── Answers ───────────────────────────────────────────────────────────────────────────────────────────────────────
 *   no account, a child's handset (persona student), anyone not in the leader family → false: today's path
 *   a leader the Learning Assessment opens for (child-test app-api learningAssessmentOpensFor: the bot's gate AND the
 *     portal's portal_child_test_sa) → ONE message with a button, signed in on the Learning Assessment
 *   a Gilgit-Baltistan leader it does not open for → ONE line: the Learning Assessment is not switched on for their
 *     account yet. GB is the leader's import source (users.source main_rumi_gb), their users.region, or their own school's
 *     region, named by the region registry (child-test/draw/region.js).
 *   an ICT leader it does not open for → false: exactly today's reply (ICT is unchanged except the link for a leader
 *     the Learning Assessment opens for)
 *   a gate that cannot be read (a database failure) → false: today's reply, never a "not on" line that may be untrue,
 *     and a warn (the log line carries the correlation id)
 *   a leader it opens for whose link cannot be sent here (no portal address or signing key, Meta refused) → ONE line
 *     that says so and where to find the page
 * Never the chat, never a lesson plan, for a leader this answers. Nothing is sent, and typing is left as it is, for
 * anyone it does not answer.
 */

const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { isSchoolLeader } = require('../services/observe/observe-gate');

// A person on a log line is their keyed reference, never the raw id (tests/setup/log-raw-ids.test.js).
const teacherRef = (id) => { try { return id ? require('../services/quiz/web-quiz-kid').tk(id) : null; } catch (_) { return null; } };

/**
 * The main bot's matching: trim, lowercase, collapse inner spaces, strip trailing `.!?؟۔`, Arabic ي→ی ك→ک ة→ہ, remove
 * tatweel (U+0640) and ZWNJ (U+200C). Applied to the typed text AND to every listed word, so both meet in one form.
 * @param {*} text
 * @returns {string}
 */
function normaliseCommandText(text) {
  return String(text ?? '')
    .replace(/[ـ‌]/g, '')
    .replace(/ي/g, 'ی') // ي → ی
    .replace(/ك/g, 'ک') // ك → ک
    .replace(/ة/g, 'ہ') // ة → ہ
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?؟۔]+$/u, '')
    .trim();
}

/** The words, as the main bot lists them: Jugnu, and the second door, "reading game". en + ur. */
const JUGNU_WORDS = Object.freeze([
  // en
  'jugnu', '/jugnu', 'reading game', 'readinggame', '/readinggame',
  // ur (Urdu script)
  'جگنو', 'پڑھنے کا کھیل', 'ریڈنگ گیم',
]);
const JUGNU_COMMANDS = Object.freeze([...new Set(JUGNU_WORDS.map(normaliseCommandText))]);

function isJugnuWord(text) {
  const t = normaliseCommandText(text);
  return t !== '' && JUGNU_COMMANDS.includes(t);
}

/**
 * Is this leader in Gilgit-Baltistan? Their import source, their users.region, else their own school's region, each by the
 * region registry. A read that fails answers ICT (region.js logs it), so a failure never makes the "not on" line appear.
 */
async function isGbLeader(user) {
  // eslint-disable-next-line global-require
  const { GB_SOURCES } = require('../services/coaching/fde-region');
  // eslint-disable-next-line global-require
  const Region = require('../services/child-test/draw/region');
  const source = typeof user.source === 'string' ? user.source.trim().toLowerCase() : '';
  if (GB_SOURCES.has(source)) return true;
  if ((await Region.regionOfValue(user.region)) === Region.GB) return true;
  return Boolean(user.school_id) && (await Region.regionForSchool(user.school_id)) === Region.GB;
}

async function send(from, text, what, ref) {
  try {
    return Boolean(await WhatsAppService.sendMessage(from, text));
  } catch (error) {
    logToFile('[jugnu] reply send failed', { what, tk: ref, error: error.message }, 'error');
    return false;
  }
}

/**
 * @param {object} opts
 * @param {object|null} opts.user
 * @param {string} opts.from
 * @param {string} opts.text the message as typed
 * @param {string} [opts.language] the reply language (the turn's response language)
 * @param {object} [opts.typingController]
 * @param {object} [opts.deps] tests only: { opensFor(userId), sendLink(args) }
 * @returns {Promise<boolean>} true when answered here; false = fall through unchanged
 */
async function handleJugnuCommand({ user, from, text, language, typingController, deps = {} } = {}) {
  if (!isJugnuWord(text)) return false;
  // Someone with no account and a child's handset keep today's path (the tutor answers a child's "jugnu"), and so does
  // everyone outside the leader family: a teacher's Jugnu is NIETE's own children's games.
  if (!user || !user.id || user.persona === 'student' || !isSchoolLeader(user)) return false;

  const lang = language || user.preferred_language;
  const stopTyping = () => { if (typingController && typeof typingController.stop === 'function') typingController.stop(); };

  const opensFor = deps.opensFor
    // eslint-disable-next-line global-require
    || ((id) => require('../services/child-test/app/app-api.service').learningAssessmentOpensFor(id));
  const sendLink = deps.sendLink
    // eslint-disable-next-line global-require
    || ((args) => require('../services/app-redirect.service').sendLearningAssessmentLink(args));

  // true: it opens for them · false: it does not · null: a read failed, so nobody knows (opensFor never throws; a throw
  // from a test's stand-in reads as null too)
  let opens = null;
  try { opens = await opensFor(user.id); } catch (_) { opens = null; }
  if (opens !== true && opens !== false) {
    logToFile('[jugnu] the Learning Assessment gate could not be read; today\'s reply goes', { tk: teacherRef(user.id), role: user.role || null }, 'warn');
    return false;
  }
  if (!opens) {
    let gb = false;
    try { gb = await isGbLeader(user); } catch (_) { gb = false; }
    if (!gb) return false; // an ICT leader off the gate: exactly today's reply
    stopTyping();
    logToFile('[jugnu] Learning Assessment not on for this leader', { tk: teacherRef(user.id), role: user.role || null });
    await send(from, resolveUx('jugnuNotOnLeader', { language: lang }), 'not_on', teacherRef(user.id));
    return true;
  }

  stopTyping();
  let sent = false;
  try { sent = await sendLink({ userId: user.id, from, language: lang, reason: 'jugnu_word' }); } catch (_) { sent = false; }
  if (sent) return true;
  logToFile('[jugnu] Learning Assessment link not sent; told the leader where to find it', { tk: teacherRef(user.id) }, 'error');
  await send(from, resolveUx('jugnuNoLink', { language: lang }), 'no_link', teacherRef(user.id));
  return true;
}

module.exports = { JUGNU_WORDS, normaliseCommandText, isJugnuWord, handleJugnuCommand };
