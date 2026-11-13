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
 *
 * Shadow (switch value 'shadow', bd-qix9oh.5, spec §4.2): the visit is stamped v5 and runs as v5 for the coach
 * and the teacher; visit_context.shadow_v6 = true marks it for the background v6 read (shadow-v6.js).
 */

const V5_RUBRIC_VERSION = 'fico-ict-17-2026-09';
const V6_RUBRIC_VERSION = 'fico17_v6';

/** Is this visit (an observation_field_forms row) scored on FICO17 v6? */
function isV6(form) {
  return Boolean(form) && form.rubric_version === V6_RUBRIC_VERSION;
}

/** Is this visit a shadow visit: v5 for the coach, read on v6 as well and stored beside it? */
function isShadow(form) {
  return Boolean(form && form.visit_context && form.visit_context.shadow_v6);
}

/** The rubric key the rules and the prompt builders take: 'fico17_v6' for a v6 visit, else 'fico17'. */
function rubricFor(form) {
  return isV6(form) ? V6_RUBRIC_VERSION : 'fico17';
}

/**
 * The stamp for a visit being made now, and whether it is a shadow visit. Never throws: any failure is v5, no
 * shadow.
 * @param {{observerUserId: string, region?: string|null, teacherUserId?: string|null}} who  region omitted → read
 *   from users; teacherUserId is the observed teacher (grades 1-5 gate)
 * @returns {Promise<{rubricVersion: string, shadow: boolean}>}
 */
// `lessonIsPrimary` (bd-pni007): true when the coach named this lesson's class as grades 1-5 (obs612 switch on); that
// answer decides the grades 1-5 gate instead of the teacher's profile. Absent: the profile, exactly as before.
async function visitRubric({ observerUserId, region, teacherUserId = null, lessonIsPrimary } = {}) {
  const v5 = { rubricVersion: V5_RUBRIC_VERSION, shadow: false };
  try {
    const sw = require('../../coaching/fico-rubric-switch');
    if (!(await sw.isAnySet('coach'))) return v5; // default off: no region lookup
    const reg = region !== undefined ? region : await sw.regionOfUser(observerUserId);
    const v = await sw.coachRubric({ userId: observerUserId, region: reg });
    // bd-ra8xu.42: v6 reaches grades 1-5 only (operator 11 Nov ~18:05); a teacher of grades 6-12, of unknown level,
    // or no teacher bound yet stays on today's rubric until FDE's 6-12 rubric lands (#94).
    if (v === 'v6') {
      const { isPrimaryVisit } = require('../../coaching/fico-visit-grade');
      if (lessonIsPrimary === true || await isPrimaryVisit(teacherUserId)) return { rubricVersion: V6_RUBRIC_VERSION, shadow: false };
      return v5;
    }
    return { rubricVersion: V5_RUBRIC_VERSION, shadow: v === 'shadow' };
  } catch (_) {
    return v5;
  }
}

/** The rubric stamp for a visit being made now. Never throws: any failure is v5. */
async function rubricForNewVisit(who = {}) {
  return (await visitRubric(who)).rubricVersion;
}

/**
 * The four level phrases per code the brief and the record read: the v6 titles for a v6 visit (v6 C5 is in
 * minutes; v5 C5 is not), fico17 PLAIN for every other visit, exactly as before.
 */
function plainOf(form) {
  return isV6(form) ? require('../../coaching/frameworks/fico17-v6').TITLES : require('./fico17').PLAIN;
}

module.exports = { V5_RUBRIC_VERSION, V6_RUBRIC_VERSION, isV6, isShadow, rubricFor, visitRubric, rubricForNewVisit, plainOf };
