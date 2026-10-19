'use strict';
/**
 * bd-v0toag.10 — the day-3 retest (quiz-retest-sweep.js) asks the author for NEW questions on
 * the same SLOs. This is the prompt block that lists the original questions. No list → ''
 * so the author prompt stays byte-identical for every normal quiz.
 */
const MAX_AVOID = 15;
const MAX_CHARS = 200;

function avoidBlock(avoidQuestions) {
  const list = (Array.isArray(avoidQuestions) ? avoidQuestions : [])
    .map((q) => String(q || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS))
    .filter(Boolean)
    .slice(0, MAX_AVOID);
  if (!list.length) return '';
  return `\n\nDO NOT REUSE these questions — the class answered them three days ago. Write NEW questions `
    + `on the same SLOs at the same levels: different numbers, words, examples and pictures.\n`
    + list.map((q) => `- ${q}`).join('\n');
}

module.exports = { avoidBlock, MAX_AVOID, MAX_CHARS };
