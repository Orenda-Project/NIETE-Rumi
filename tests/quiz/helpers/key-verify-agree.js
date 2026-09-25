'use strict';
/**
 * A blind solver that agrees with every key.
 *
 * Every lesson quiz is now blind-solved before its rows are stored — once with
 * the lesson and once without it (the generate step's `verifyKeys` seam,
 * transcript-quiz-key-verify.service); this agrees on both. Suites
 * whose subject is something else — the authoring budget, the rewrite, the
 * language of the teacher's page — install this on that seam, so they neither
 * reach a model for the extra call nor count it among the calls they assert on.
 * The solve itself is driven through the real LLM boundary in
 * transcript-quiz-key-verify.test.js.
 */

const KV = require('../../../bot/shared/services/quiz/transcript-quiz-key-verify.service');

async function agreeWithEveryKey({ questions, indices = null }) {
  const qs = Array.isArray(questions) ? questions : [];
  const idx = Array.isArray(indices) ? indices : qs.map((_, i) => i);
  return {
    verdicts: idx.map((index) => {
      const keyed = KV.keyedIndices(qs[index]);
      return {
        index, verdict: 'agree', keyed, blind: keyed, note: '',
      };
    }),
    model: 'stub-solver',
    costUsd: 0,
    latencyMs: 0,
  };
}

/**
 * The summary truth check (a recording's quiz, transcript-quiz-summary-truth)
 * finding nothing false: every text ships as authored. Installed beside the
 * solver for the same reason — suites about something else neither reach a
 * model for it nor count it. The check itself is driven through the real LLM
 * boundary in transcript-quiz-summary-truth.test.js.
 */
async function nothingFalse({ lessonSummary = '', extras = {}, slos = [] }) {
  return {
    lessonSummary, extras: { ...extras }, slos, checked: 0, flagged: 0, rewritten: 0, dropped: 0, missing: 0, lines: [],
    model: 'stub-truth', costUsd: 0, latencyMs: 0,
  };
}

/** Install on the generate module's seams; returns the solver spy. */
function installAgreeingSolver(Gen) {
  if (typeof Gen.checkSummaryTruth === 'function') jest.spyOn(Gen, 'checkSummaryTruth').mockImplementation(nothingFalse);
  return jest.spyOn(Gen, 'verifyKeys').mockImplementation(agreeWithEveryKey);
}

module.exports = { agreeWithEveryKey, nothingFalse, installAgreeingSolver };
