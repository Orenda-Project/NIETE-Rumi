'use strict';

/**
 * bd-pni007 — is this score on a rubric of its own, never a FICO V3 number?
 *
 * Two rubrics are scored apart from FICO V3 and stamped with their id on every record they write:
 *   'fico17_v6'          FICO17 v6 (bd-ra8xu.38; frameworks/fico17-v6/stamp.js)
 *   'obs612-<tool>-v<n>' FDE's grade 6-12 observation tools (frameworks/obs612)
 *   'fico_s_v<M>_<m>'    FICO-S, ICT's grade 6-12 rubric from 18 Nov (frameworks/fico-s, bd-31ziu8): v1.1, v1.2 (queue #218)
 * A reader that compares or averages overall scores across sessions asks this ONE question and treats a yes as
 * "no V3 score", so a V3 total or average never counts a v6 or an FDE visit (V3 is /148, v6 /44, FDE's English
 * tool also /148 but a different instrument). A V3 row carries no stamp: false.
 *
 * Accepts an analysis_data object or its scores alone. No dependencies, so any reader can ask.
 * The dashboard keeps the same test in dashboard/services/coaching-frameworks.service.js (no bot module there).
 */

const { RUBRIC_KEY: V6_RUBRIC, isV6Scored } = require('./fico17-v6/stamp');

const OBS612_RX = /^obs612-(gen|msci|enur)-v\d+$/;
// The first FICO-S id (kept for readers that name it); every version matches FICO_S_RX.
const FICO_S_ID = 'fico_s_v1_1';
const FICO_S_RX = /^fico_s_v\d+_\d+$/;
const isFicoSId = (v) => typeof v === 'string' && FICO_S_RX.test(v);
const isOwnId = (v) => v === V6_RUBRIC || isFicoSId(v) || (typeof v === 'string' && OBS612_RX.test(v));

/** The rubric id a score is stamped with when it is on a rubric of its own ('fico17_v6' | 'obs612-…'), else null. */
function ownRubricOf(x) {
  if (!x || typeof x !== 'object') return null;
  const tries = [
    x.rubric,
    x.framework,
    x.scores && typeof x.scores === 'object' ? x.scores.rubric : undefined,
    x.observe2 && typeof x.observe2 === 'object' ? x.observe2.rubric : undefined,
  ];
  return tries.find(isOwnId) || null;
}

/** Is this score on a rubric of its own (FICO17 v6 or an obs612 tool)? Never a V3 number when true. */
function isOwnRubric(x) {
  return ownRubricOf(x) !== null;
}

/** Is this a grade 6-12 form score (an FDE obs612 tool, or FICO-S, any version)? */
function isObs612Scored(x) {
  const id = ownRubricOf(x);
  return Boolean(id && (OBS612_RX.test(id) || isFicoSId(id)));
}

/** Is this a FICO-S score (v1.1 or v1.2)? */
function isFicoSScored(x) {
  return isFicoSId(ownRubricOf(x));
}

module.exports = { ownRubricOf, isOwnRubric, isObs612Scored, isFicoSScored, isV6Scored, OBS612_RX, FICO_S_ID, FICO_S_RX };
