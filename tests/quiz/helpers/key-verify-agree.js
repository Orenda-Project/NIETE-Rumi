'use strict';
/**
 * A blind solver that agrees with every key.
 *
 * Every lesson quiz is now blind-solved once before its rows are stored (the
 * generate step's `verifyKeys` seam, transcript-quiz-key-verify.service). Suites
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

/** Install on the generate module's seam; returns the spy. */
function installAgreeingSolver(Gen) {
  return jest.spyOn(Gen, 'verifyKeys').mockImplementation(agreeWithEveryKey);
}

module.exports = { agreeWithEveryKey, installAgreeingSolver };
