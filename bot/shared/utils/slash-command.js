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
 *
 * bd-xw56ed — and a slip of the finger is the command too. Production, 20 Oct 2026: "/assesments"
 * then "/assesment", both answered by the general AI chat. Rather than list typos, a one-word
 * command is compared to every known command by edit distance (a swapped pair of letters is one
 * edit) and rewritten when exactly one is close enough. A message the distance cannot place goes on
 * to the classifier at the fallthrough, which reads the teacher's live menu.
 */

// Every command a teacher-facing door matches on. `reading test` is the one two-word command.
// NOT quiz: its bare-text door (quiz-menu-request.js) already reads "quiz/" and "/ quiz", behind
// its own kill switch QUIZ_BARE_TEXT_TO_MENU, which a rewrite here would bypass.
const COMMANDS = new Set([
  'menu', 'register', 'language', 'settings', 'portal', 'training', 'trainings', 'roster',
  'reading', 'readingtest', 'reading test', 'exam', 'exams', 'assess', 'assessment', 'assessments',
  'observe', 'observe2', 'video', 'videos', 'status', 'cancel', 'class', 'classes',
  'certificate', 'certificates', 'remark',
  // bd-xw56ed: their doors read the word itself (attendance-router KEYWORDS, coaching-trigger's
  // stem), so "/attendance" and "/coaching" reach them like any other command. They were missing,
  // and "/attendence" and "/couching" were among the commonest slips answered by the chat.
  'attendance', 'coaching',
]);

// Real commands this canonicaliser does NOT rewrite into: their own doors read them (quiz above;
// the rest are their own exact doors). They are listed only so a slip of one of THEM is never
// rewritten into a different command — "/stats" is one edit from "/status", and "/quizz" belongs
// to /quiz.
const OTHER_COMMANDS = new Set([
  'quiz', 'homework', 'stats', 'who', 'role', 'persona', 'health', 'grade', 'coach',
  'checkexam', 'bind',
]);

// How far a slip may be from the command it meant: one edit for a word of up to five letters, two
// for a longer one. Under four letters there is too little word to judge.
const MIN_SIMILAR_LENGTH = 4;
const maxEditsFor = (word) => (word.length <= 5 ? 1 : 2);

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and adjacent
 * transpositions each cost one. Gives up (returns limit + 1) once every path is past `limit`.
 */
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2] + 1);
      }
      row.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > limit) return limit + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * The one command `word` is a slip of, or null: the closest known word must be unique, within
 * reach, and a command this canonicaliser rewrites into.
 */
function similarCommand(word) {
  if (word.length < MIN_SIMILAR_LENGTH) return null;
  const limit = maxEditsFor(word);
  let best = null;
  let bestDistance = limit + 1;
  let tied = false;
  for (const known of [...COMMANDS, ...OTHER_COMMANDS]) {
    if (known.includes(' ')) continue;
    const d = editDistance(word, known, limit);
    if (d < bestDistance) { best = known; bestDistance = d; tied = false; } else if (d === bestDistance) tied = true;
  }
  if (!best || tied || bestDistance > limit || !COMMANDS.has(best)) return null;
  return best;
}

// Bidi controls a copied or isolated command carries: LRM/RLM, the embeddings, the isolates, BOM.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩﻿]/g;

const WORD = '([a-z][a-z0-9]*(?: test)?)';
const REVERSED = new RegExp(`^${WORD}\\s*/$`, 'i');   // "Menu/", "menu /"
const SPACED = new RegExp(`^/\\s+${WORD}$`, 'i');     // "/ menu"
const BACKSLASH = new RegExp(`^\\\\${WORD}$`, 'i');  // "\menu"
const PLAIN = new RegExp(`^/${WORD}$`, 'i');          // "/menu" — only ever read for a slip

/**
 * @param {string} text the message as it arrived
 * @returns {{ text: string, form: null|'reversed'|'spaced'|'backslash'|'bidi'|'similar' }}
 *   `text` is `/command` when the whole message is a known command in a broken form or a slip of
 *   one, otherwise the input unchanged; `form` names which repair applied (null = none).
 */
function canonicalizeSlashCommand(text) {
  if (typeof text !== 'string') return { text, form: null };
  const stripped = text.replace(BIDI_CONTROLS, '').trim();
  let slip = null;
  for (const [rx, form] of [[REVERSED, 'reversed'], [SPACED, 'spaced'], [BACKSLASH, 'backslash'], [PLAIN, null]]) {
    const m = rx.exec(stripped);
    if (!m) continue;
    const word = m[1].toLowerCase();
    if (COMMANDS.has(word)) {
      if (form) return { text: `/${word}`, form };
      break;
    }
    if (!slip && !OTHER_COMMANDS.has(word)) slip = similarCommand(word);
  }
  if (slip) return { text: `/${slip}`, form: 'similar' };
  if (stripped !== text.trim() && stripped.startsWith('/')) return { text: stripped, form: 'bidi' };
  return { text, form: null };
}

module.exports = { canonicalizeSlashCommand, COMMANDS };
