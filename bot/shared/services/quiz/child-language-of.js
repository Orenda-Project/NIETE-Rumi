'use strict';
/**
 * The one order of a child's language, as pure functions over what the caller already holds (no read, no switch):
 * ladder() is the order web-quiz-child-lang.js describes; classLanguage() / childLanguage() read a child's quiz history
 * (student-quiz.service.js quizzesForStudents()). Both services require this file, never each other.
 */
const { clampLanguage } = require('../../config/ux-strings');

/**
 * The child's language: their newest quiz's, skipping library lesson codes (an Urdu lesson tapped from an
 * English class is an Urdu page, not an Urdu child). Only lesson codes played: the newest one. None: null.
 */
function childLanguage(history) {
  const e = (history || []).find((x) => !x.lessonCode) || (history || [])[0];
  return e ? clampLanguage(e.language) : null;
}

/**
 * The language of the child's newest class quiz (library lesson codes skipped), else null. `classLanguage(h) ||
 * childLanguage(h)` is `childLanguage(h)`; with web_quiz_return_lang the link's language sits between the two.
 */
function classLanguage(history) {
  const e = (history || []).find((x) => !x.lessonCode);
  return e ? clampLanguage(e.language) : null;
}

/**
 * The order itself. `own`: the child's child_language row ({ language, source }, null with the switch off); `asked`:
 * the page's ?lang= (en|ur, already checked); `history`: the child's quizzesForStudents() list; `linked`: the link's
 * `l`; `lessons: false` stops before the library lesson's language. → 'en' | 'ur' | null.
 */
function ladder({ own = null, asked = null, history = null, linked = null, lessons = true } = {}) {
  const kept = (s) => (own && own.source === s ? own.language : null);
  return kept('chosen') || asked || classLanguage(history) || linked || kept('join') || (lessons ? childLanguage(history) : null) || null;
}

module.exports = { ladder, classLanguage, childLanguage };
