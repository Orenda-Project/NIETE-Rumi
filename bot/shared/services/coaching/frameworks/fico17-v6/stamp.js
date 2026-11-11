'use strict';

/**
 * bd-ra8xu.38 — is this score a FICO17 v6 one? No dependencies, so any reader (bot or dashboard) can ask.
 *
 * Every v6 writer stamps scores.rubric = 'fico17_v6' (the DC v6 scorer, the /observe v6 review, an /observe2 v6
 * visit). A reader that compares or averages overall scores across sessions treats a stamped score as "no V3 score",
 * so V3 and v6 never meet in one total or average (V3 C5 is not v6 C5; V3 is out of 148, v6 out of 44).
 *
 * Accepts an analysis_data object or its scores alone. A V3 row carries no stamp: false.
 */

const RUBRIC_KEY = 'fico17_v6';

function isV6Scored(x) {
  if (!x || typeof x !== 'object') return false;
  if (x.rubric === RUBRIC_KEY || x.framework === RUBRIC_KEY) return true;
  if (x.scores && typeof x.scores === 'object' && x.scores.rubric === RUBRIC_KEY) return true;
  if (x.observe2 && typeof x.observe2 === 'object' && x.observe2.rubric === RUBRIC_KEY) return true;
  return false;
}

module.exports = { RUBRIC_KEY, isV6Scored };
