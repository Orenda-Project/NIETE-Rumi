'use strict';

/**
 * Queue #282 — what a model prompt may see of an analysis. A self-recording reported on FICO17 v6 keeps the whole V3
 * analysis under v3_fico and the raw v6 read under dc / shadow, for the A/B record and the audit; a prompt that
 * serialises the analysis would read V3's strengths, focus and summary out of them and put V3 in a v6 report. So for a
 * v6 analysis those keys (and the evidence-only combined_evidence) are left out of the copy the model sees. They stay on
 * the stored analysis. Any other analysis comes back as it is (the same object). No dependencies, so any caller (and any
 * test that mocks the services around it) gets the same answer.
 */

const HIDDEN = ['v3_fico', 'dc', 'shadow', 'combined_evidence'];

function isV6(analysis) {
  return analysis.framework === 'fico17_v6' || !!(analysis.scores && analysis.scores.rubric === 'fico17_v6');
}

function modelView(analysis) {
  if (!analysis || typeof analysis !== 'object' || !isV6(analysis)) return analysis;
  const view = { ...analysis };
  for (const k of HIDDEN) delete view[k];
  return view;
}

module.exports = { modelView, HIDDEN };
