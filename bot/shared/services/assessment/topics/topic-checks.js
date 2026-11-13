/**
 * bd-pw1ccr.38 — checks on a written G1-5 topic paper (Ramisha's off-topic sheet): which ticked skills no
 * question tests (G1 Maths pp 2-8 skipped counting pictures and matching numerals), and which questions copy
 * a worked example from the ticked pages (G5 Maths pp 218-222). The copy test is board-6-12's isBook, run
 * against the pages' worked examples only, so a language paper quoting its own reading text is not flagged.
 * Pure.
 */
const { isBook } = require('../board-6-12/book-level');

const EXAMPLE = /\bexample\b|مثال/gi;
const SPAN = 600;
const MISSED = ' (the last paper had no question on this skill: write at least one question on it)';

/** Every question and sub-question in a generated exam tree (seen/unseen → category → type → list). */
function questionsOf(examJson) {
  const out = [];
  const take = (list) => list.forEach((q) => {
    if (!q || typeof q !== 'object') return;
    out.push(q);
    if (Array.isArray(q.questions)) take(q.questions);
  });
  for (const section of ['seen', 'unseen']) {
    for (const category of Object.values(examJson?.[section] || {})) {
      for (const entry of Object.values(category || {})) {
        if (Array.isArray(entry)) take(entry);
        else if (entry && typeof entry === 'object') Object.values(entry).forEach((l) => Array.isArray(l) && take(l));
      }
    }
  }
  return out;
}

function uncoveredSkills(examJson, slos) {
  if (!Array.isArray(slos) || !slos.length) return [];
  const tested = new Set(questionsOf(examJson).map((q) => q.slo).filter(Boolean));
  return slos.map((s) => s.code).filter((code) => !tested.has(code));
}

/** The pages' worked example blocks, each headed "Example" so isBook finds them; '' when there are none. */
function exampleText(pageContent) {
  const text = String(pageContent || '');
  const blocks = [];
  for (const m of text.matchAll(EXAMPLE)) blocks.push(text.slice(m.index, m.index + SPAN).replace(EXAMPLE, 'Example'));
  return blocks.join('\n');
}

function copiedExamples(examJson, pageContent) {
  const examples = exampleText(pageContent);
  if (!examples) return [];
  return questionsOf(examJson)
    .filter((q) => typeof q.question === 'string' && isBook(q, examples))
    .map((q) => q.question);
}

function reviewTopicPaper(examJson, { slos, pageContent }) {
  const uncovered = uncoveredSkills(examJson, slos);
  const copied = copiedExamples(examJson, pageContent);
  const score = uncovered.length + copied.length;
  return { clean: score === 0, uncovered, copied, score };
}

/** The same request, with the missed skills flagged in their own lines and the copied questions to avoid. */
function retryArgs(args, review) {
  const missed = new Set(review.uncovered);
  return {
    ...args,
    slos: args.slos.map((s) => (missed.has(s.code) ? { ...s, description: s.description + MISSED } : s)),
    avoidQuestions: [...(args.avoidQuestions || []), ...review.copied],
  };
}

module.exports = { questionsOf, uncoveredSkills, exampleText, copiedExamples, reviewTopicPaper, retryArgs };
