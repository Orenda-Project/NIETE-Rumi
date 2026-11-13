'use strict';
/**
 * bd-ra8xu.42, widened by bd-ra8xu.40 (12 Nov: grades 9-12 too, see FICO_BANDS) — which coach visits FICO17 v6 may
 * reach. Originally grades 1-5 only (operator, 11 Nov ~18:05: "for primary, both
 * HITL and DC is FICO v6 … for 6-12, the rubric is the FDE one for HITL"); on 12 Nov the operator narrowed FDE to grades
 * 6-8, so grades 9-12 follow the FICO switch too.
 *
 * The grade a visit is known by when it starts is the observed teacher's band, `users.teacher_level`, read through
 * utils/teacher-level.js (the one reader; an empty level means "we do not know"). A visit is a FICO-grade visit only
 * when that teacher teaches PRIMARY and/or HIGH and nothing else. A teacher who also teaches MIDDLE (grades 6-8, FDE's),
 * a teacher with no level, or a visit with no teacher bound yet stays on today's rubric: when in doubt, nothing moves.
 * A coach who names the lesson's class (obs612 switch on) decides it instead of the profile.
 *
 * (Prod, 11 Nov: 585 of the 769 teachers coaches observed since 1 Oct are PRIMARY-only.)
 */

const supabase = require('../../config/supabase');
const { teacherLevelOf } = require('../../utils/teacher-level');

// bd-ra8xu.40 (operator, 12 Nov ~11:00): "For 9-12, we continue with FICO v3 right now and v6 when we turn v6 on for
// 1-5. This FDE ones only apply to 6 7 8." So a FICO-grade teacher teaches PRIMARY and/or HIGH and no MIDDLE: a teacher
// who also teaches grades 6-8 may be observed on FDE's tool, so in doubt nothing moves.
const FICO_BANDS = ['PRIMARY', 'HIGH'];

/** Pure: a users row is a FICO-grade teacher (grades 1-5 and/or 9-12, never 6-8). */
function isFicoGradeOnly(user) {
  const bands = teacherLevelOf(user || {});
  return bands.length > 0 && bands.every((b) => FICO_BANDS.includes(b));
}

/**
 * Is this teacher's visit a grades 1-5 visit? Never throws: no id, no row, or a failed read is false.
 * @param {string|null} teacherUserId  users.id of the observed teacher
 */
async function isFicoGradeVisit(teacherUserId) {
  if (!teacherUserId) return false;
  try {
    const { data, error } = await supabase.from('users').select('id, teacher_level').eq('id', teacherUserId).maybeSingle();
    if (error || !data) return false;
    return isFicoGradeOnly(data);
  } catch (_) {
    return false;
  }
}

// The old names are kept (callers: observe-fico17-v6 decideVisitFramework, observe2/rubric visitRubric): since 12 Nov
// they mean a FICO-grade visit (grades 1-5 or 9-12).
const isPrimaryOnly = isFicoGradeOnly;
const isPrimaryVisit = isFicoGradeVisit;

module.exports = { isFicoGradeOnly, isFicoGradeVisit, isPrimaryOnly, isPrimaryVisit, FICO_BANDS };
