'use strict';
/**
 * The language a bank quiz's QUESTIONS are written in, for the maker page's mark, its ready line and the class
 * message's language line. Pure; reads nothing, writes nothing.
 *
 *   decideLanguage(texts)     'ur' when at least half of the non-empty question texts carry an Arabic-script letter,
 *                             else 'en'; null when there is no text (the one-off backfill's rule)
 *   voiceLanguage(questions)  today's read-aloud voice language for a quiz with no `language`
 *                             (web-quiz-publish.service.js quizLanguage: ANY Arabic letter in a question or its
 *                             first option → 'ur')
 *   qlangFor(language, qs)    quizzes.language when it is 'en' | 'ur'; else decideLanguage when it EQUALS
 *                             voiceLanguage; else null (no mark, no clause, no class line — never a guess)
 *
 * quizzes.language is read by five live paths (the child page's chrome language, the hub's ranking, the report's
 * language, the read-aloud voice twice), so the page never writes it: the mark is computed at read time.
 */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const QLANGS = Object.freeze(['en', 'ur']);

function decideLanguage(questionTexts) {
  const texts = (questionTexts || []).filter((t) => typeof t === 'string' && t.trim() !== '');
  if (!texts.length) return null;
  const urdu = texts.filter((t) => ARABIC_SCRIPT.test(t)).length;
  return urdu * 2 >= texts.length ? 'ur' : 'en';
}

function voiceLanguage(questions) {
  const text = (questions || []).map((q) => `${(q && q.question_text) || ''} ${(q && q.option_a) || ''}`).join(' ');
  return /[؀-ۿ]/.test(text) ? 'ur' : 'en';
}

/** @param {string|null} language quizzes.language  @param {Array<{question_text, option_a}>} questions */
function qlangFor(language, questions) {
  if (QLANGS.includes(language)) return language;
  const decided = decideLanguage((questions || []).map((q) => q && q.question_text));
  return decided && decided === voiceLanguage(questions) ? decided : null;
}

module.exports = { decideLanguage, voiceLanguage, qlangFor, ARABIC_SCRIPT, QLANGS };
