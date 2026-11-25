'use strict';
/**
 * THE KEY CHECKER, on word meanings (bd-0q8b4x). Pure prompt and parse; the one
 * call is made by quiz-word-help.service.js.
 *
 * A short Urdu meaning shown under an English word is a second answer key: a
 * wrong one teaches the child the wrong word. So every meaning, the book's and
 * the model's, is held against the same lesson the key check reads
 * (lp-quiz-key-check.service sourceAnswers) and against the word's use in its
 * question. Contract, asserted here, not left to the prompt: a meaning the reply
 * does not name as right (`ok: true`) is NOT kept.
 */
const KeyCheck = require('./lp-quiz-key-check.service');

const LABEL = 'quiz.word_help.check';
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * @param {{rows:object[], words:{index:number, en:string, ur:string}[], slideScript?:object, rowText:Function}} a
 */
function buildWordCheckPrompt({ rows, words, slideScript, rowText }) {
  const source = KeyCheck.renderSourceBlock(KeyCheck.sourceAnswers(slideScript));
  const byRow = new Map();
  arr(words).forEach((w) => { if (!byRow.has(w.index)) byRow.set(w.index, []); byRow.get(w.index).push(w); });
  const items = [...byRow.entries()].map(([i, ws]) => `q${i}: ${String(rowText(rows[i]) || '').replace(/\s*\n\s*/g, ' | ')}\n${
    ws.map((w) => `  - "${w.en}" = «${w.ur}»`).join('\n')}`).join('\n\n');
  return [
    'You are CHECKING SHORT URDU MEANINGS that a children\'s English quiz shows under hard English words. A child who does not know the English word reads the Urdu meaning to understand the question.',
    source ? `THE LESSON THE QUIZ WAS WRITTEN FROM\n\n${source}` : null,
    `THE QUESTIONS (stem | options) AND THE MEANINGS SHOWN\n\n${items}`,
    `For EACH meaning say "ok": true only when the Urdu is a correct, simple meaning of that English word AS IT IS USED in its question and the lesson, and it does not give away which option is right. Say "ok": false when it is wrong, too vague, a different sense of the word, or it gives the answer away.
Return ONLY this JSON: { "words": [ { "index": 0, "en": "word", "ok": true } ] }`,
  ].filter(Boolean).join('\n\n');
}

/** The approved (index, en) pairs as a Set of "i|en". Throws when there is no `words` array. */
function parseWordVerdicts(json) {
  if (!json || !Array.isArray(json.words)) throw new Error(`${LABEL}: the reply carries no "words" array`);
  const ok = new Set();
  json.words.forEach((v) => {
    const i = Number(v && v.index);
    if (Number.isInteger(i) && v.ok === true && v.en) ok.add(`${i}|${String(v.en).trim().toLowerCase()}`);
  });
  return ok;
}

module.exports = { buildWordCheckPrompt, parseWordVerdicts, LABEL };
