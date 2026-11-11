'use strict';

/**
 * /observe2 — which FICO17 rubric a visit is scored on (bd-ra8xu.38).
 *
 * Decided ONCE, when the visit's record is made, from the coach switch (coaching/fico-rubric-switch.js,
 * app_settings `fico_coach_rubric`, default OFF), and stamped on observation_field_forms.rubric_version.
 * Everything after reads the stamp, never the live switch: flipping the switch mid-visit changes nothing for a
 * visit already started, and flipping it back needs no deploy.
 *
 *   'fico-ict-17-2026-09'  FICO17 v5, today's flow (the switch is off, unknown, or unreadable)
 *   'fico17_v6'            FICO17 v6: the coach sets C3 C5 C7 D2 D3 D4 from the room with a written reason;
 *                          Rumi's other 11 levels are pre-filled and changing one needs a reason.
 */

const V5_RUBRIC_VERSION = 'fico-ict-17-2026-09';
const V6_RUBRIC_VERSION = 'fico17_v6';

/** Is this visit (an observation_field_forms row) scored on FICO17 v6? */
function isV6(form) {
  return Boolean(form) && form.rubric_version === V6_RUBRIC_VERSION;
}

/**
 * The rubric stamp for a visit being made now. Never throws: any failure is v5.
 * @param {{observerUserId: string, region?: string|null}} who  region omitted → read from users
 */
async function rubricForNewVisit({ observerUserId, region } = {}) {
  try {
    const sw = require('../../coaching/fico-rubric-switch');
    if (!(await sw.isAnySet('coach'))) return V5_RUBRIC_VERSION; // default off: no region lookup
    const reg = region !== undefined ? region : await sw.regionOfUser(observerUserId);
    const v = await sw.coachRubric({ userId: observerUserId, region: reg });
    return v === 'v6' ? V6_RUBRIC_VERSION : V5_RUBRIC_VERSION;
  } catch (_) {
    return V5_RUBRIC_VERSION;
  }
}

/**
 * The four level phrases per code the brief and the record read: the v6 titles for a v6 visit (v6 C5 is in
 * minutes; v5 C5 is not), fico17 PLAIN for every other visit, exactly as before.
 */
function plainOf(form) {
  return isV6(form) ? require('../../coaching/frameworks/fico17-v6').TITLES : require('./fico17').PLAIN;
}

module.exports = { V5_RUBRIC_VERSION, V6_RUBRIC_VERSION, isV6, rubricForNewVisit, plainOf };
