'use strict';
/**
 * bd-5ls6qy.7 — read a slash command the way a teacher actually types it back.
 *
 * Our Urdu messages tell the teacher to type `/menu`. Until the bidi sweep, WhatsApp painted the
 * bare command inside that right-to-left line as `menu/`, and teachers typed what they saw. Every
 * command door compares the exact string (`messageBody.toLowerCase() === '/menu'`), so none of
 * these reached it: in niete-logs 10–13 Oct 2026, 43 "Menu/"-style and 76 "/ menu" messages from
 * 88 teachers, 0 of them opened the menu and 110 were answered by the general AI chat.
 *
 * The isolate sweep stops the reversed rendering for new messages; this keeps working for the
 * old ones still on teachers' screens, for an LLM reply that mentions a command bare, and for a
 * teacher who copies an isolated command (the LRI/PDI come along with the copy).
 *
 * Only a WHOLE message that is one known command word is rewritten. "Attendance/menu" and a bare
 * "menu" are not commands and pass through unchanged.
 */

// Every command a teacher-facing door matches on. `reading test` is the one two-word command.
// NOT quiz: its bare-text door (quiz-menu-request.js) already reads "quiz/" and "/ quiz", behind
// its own kill switch QUIZ_BARE_TEXT_TO_MENU, which a rewrite here would bypass.
const COMMANDS = new Set([
  'menu', 'register', 'language', 'settings', 'portal', 'training', 'trainings', 'roster',
  'reading', 'readingtest', 'reading test', 'exam', 'exams', 'assess', 'assessment', 'assessments',
  'observe', 'observe2', 'video', 'videos', 'status', 'cancel', 'class', 'classes',
  'certificate', 'certificates', 'remark',
]);

// Bidi controls a copied or isolated command carries: LRM/RLM, the embeddings, the isolates, BOM.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩﻿]/g;

const WORD = '([a-z][a-z0-9]*(?: test)?)';
const REVERSED = new RegExp(`^${WORD}\\s*/$`, 'i');   // "Menu/", "menu /"
const SPACED = new RegExp(`^/\\s+${WORD}$`, 'i');     // "/ menu"
const BACKSLASH = new RegExp(`^\\\\${WORD}$`, 'i');  // "\menu"

/**
 * @param {string} text the message as it arrived
 * @returns {{ text: string, form: null|'reversed'|'spaced'|'backslash'|'bidi' }}
 *   `text` is `/command` when the whole message is a known command in a broken form, otherwise
 *   the input unchanged; `form` names which repair applied (null = none).
 */
function canonicalizeSlashCommand(text) {
  if (typeof text !== 'string') return { text, form: null };
  const stripped = text.replace(BIDI_CONTROLS, '').trim();
  for (const [rx, form] of [[REVERSED, 'reversed'], [SPACED, 'spaced'], [BACKSLASH, 'backslash']]) {
    const m = rx.exec(stripped);
    if (m && COMMANDS.has(m[1].toLowerCase())) return { text: `/${m[1].toLowerCase()}`, form };
  }
  if (stripped !== text.trim() && stripped.startsWith('/')) return { text: stripped, form: 'bidi' };
  return { text, form: null };
}

module.exports = { canonicalizeSlashCommand, COMMANDS };
