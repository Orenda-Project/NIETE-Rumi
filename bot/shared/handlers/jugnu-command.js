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
 * ─── Answers ───────────────────────────────────────────────────────────────────────────────────────────────────────
 *   no account, a child's handset (persona student), a role that is neither teacher nor leader → false: today's path
 *   a leader the Learning Assessment opens for (child-test app-api learningAssessmentOpensFor: the bot's gate AND the
 *     portal's portal_child_test_sa) → ONE message with a button, signed in on the Learning Assessment
 *   a teacher, or a leader it does not open for → ONE line: who it is for, and that it is not on for this account
 *   a leader it opens for whose link cannot be sent here (no portal address or signing key, Meta refused) → ONE line
 *     that says so and where to find the page
 * Never the chat, never a lesson plan, for anyone this answers.
 */

const WhatsAppService = require('../services/whatsapp.service');
const { logToFile } = require('../utils/logger');
const { resolveUx } = require('../config/ux-strings');
const { isSchoolLeader } = require('../services/observe/observe-gate');
const { isTeacherRole } = require('../services/teacher-audience');

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

async function send(from, text, what, userId) {
  try {
    return Boolean(await WhatsAppService.sendMessage(from, text));
  } catch (error) {
    logToFile('[jugnu] reply send failed', { what, userId, error: error.message }, 'error');
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
  // Someone with no account and a child's handset keep today's path (the tutor answers a child's "jugnu").
  if (!user || !user.id || user.persona === 'student') return false;
  const leader = isSchoolLeader(user);
  if (!leader && !isTeacherRole(user.role)) return false;

  if (typingController && typeof typingController.stop === 'function') typingController.stop();
  const lang = language || user.preferred_language;

  const opensFor = deps.opensFor
    // eslint-disable-next-line global-require
    || ((id) => require('../services/child-test/app/app-api.service').learningAssessmentOpensFor(id));
  const sendLink = deps.sendLink
    // eslint-disable-next-line global-require
    || ((args) => require('../services/app-redirect.service').sendLearningAssessmentLink(args));

  let opens = false;
  if (leader) {
    try { opens = (await opensFor(user.id)) === true; } catch (_) { opens = false; }
  }
  if (!opens) {
    logToFile('[jugnu] not on for this account', { userId: user.id, role: user.role || null, leader });
    await send(from, resolveUx('jugnuNotOn', { language: lang }), 'not_on', user.id);
    return true;
  }

  let sent = false;
  try { sent = await sendLink({ userId: user.id, from, language: lang, reason: 'jugnu_word' }); } catch (_) { sent = false; }
  if (sent) return true;
  logToFile('[jugnu] Learning Assessment link not sent; told the leader where to find it', { userId: user.id }, 'error');
  await send(from, resolveUx('jugnuNoLink', { language: lang }), 'no_link', user.id);
  return true;
}

module.exports = { JUGNU_WORDS, normaliseCommandText, isJugnuWord, handleJugnuCommand };
