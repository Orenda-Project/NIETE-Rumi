'use strict';
/**
 * Child test (bd-s1oo0.5) — the maths block: spoken numbers and quick sums from
 * the transcript + item bank (deterministic), the word problem by a text grader
 * cross-checked with the number grammar, and the strip photo by vision.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { renderTurns } = require('./stt');
const { wordsIn } = require('./windows');
const { scoreNumbers, scoreQuickSums, spokenAnswer } = require('./maths-spoken');

async function scoreSpokenWordProblem({ spec, words, window, coachSpeaker, calls }) {
  const wp = spec.word_problem;
  if (!wp || !window) return null;
  const child = wordsIn(words, window, { excludeSpeaker: coachSpeaker });
  const grammar = spokenAnswer(child.filter((w) => !window.promptEnd || w.start > window.promptEnd));
  const model = modelFor('word_problem');
  const r = await chatJSON({
    model, job: 'child_test.word_problem', maxTokens: 800,
    prompt: prompts.WORD_PROBLEM({ prompt: wp.prompt_ur || wp.prompt_en, answer: wp.answer, transcript: renderTurns(words, window.start, window.end) }),
  });
  calls.push({ job: 'word_problem', model, cost: r.cost, seconds: r.seconds, error: r.error });
  const llmAns = r.json && r.json.answer != null && r.json.answer !== 'null' ? Number(String(r.json.answer).replace(/[^\d-]/g, '')) : null;
  const ans = Number.isFinite(llmAns) ? llmAns : grammar;
  if (ans == null) return { verdict: 'none', read_answer: '', confidence: r.json ? 0.6 : 0 };
  const agree = grammar != null && Number.isFinite(llmAns) && grammar === llmAns;
  return { verdict: ans === Number(wp.answer) ? 'correct' : 'wrong', read_answer: String(ans), confidence: agree ? 0.8 : 0.55 };
}

function scoreSpoken({ spec, words, cut }) {
  const coach = cut.coachSpeaker;
  const out = {};
  if (cut.windows.numbers) out.numbers = scoreNumbers(wordsIn(words, cut.windows.numbers, { excludeSpeaker: coach }), spec.numbers || []);
  if (cut.windows.quick_sums) {
    const q = scoreQuickSums(wordsIn(words, cut.windows.quick_sums, { excludeSpeaker: coach }), spec.quick_sums || [], cut.windows.quick_sums);
    out.quick_sums = { correct: q.correct, attempted: q.attempted, seconds: q.seconds, confidence: q.confidence };
    out.quick_sums_items = q.items;
  }
  return out;
}

module.exports = { scoreSpoken, scoreSpokenWordProblem };
