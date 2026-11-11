'use strict';
/**
 * bd-ra8xu.42 — which coach visits FICO17 v6 may reach: grades 1-5 only (operator, 11 Nov ~18:05: "for primary, both
 * HITL and DC is FICO v6 … for 6-12, the rubric is the FDE one for HITL"). Until FDE's rubric lands (#94), a coach
 * visit to a teacher of grades 6-12 stays on today's rubric even when the coach switch says v6.
 *
 * The grade a visit is known by when it starts is the observed teacher's band, `users.teacher_level`, read through
 * utils/teacher-level.js (the one reader; an empty level means "we do not know"). A visit is a grades 1-5 visit only
 * when that teacher teaches PRIMARY and nothing else. A teacher who also teaches MIDDLE or HIGH, a teacher with no
 * level, or a visit with no teacher bound yet stays on today's rubric: when in doubt, nothing moves.
 *
 * (Prod, 11 Nov: 585 of the 769 teachers coaches observed since 1 Oct are PRIMARY-only.)
 */

const supabase = require('../../config/supabase');
const { teacherLevelOf } = require('../../utils/teacher-level');

/** Pure: a users row is a grades 1-5 teacher only when PRIMARY is their one band. */
function isPrimaryOnly(user) {
  const bands = teacherLevelOf(user || {});
  return bands.length === 1 && bands[0] === 'PRIMARY';
}

/**
 * Is this teacher's visit a grades 1-5 visit? Never throws: no id, no row, or a failed read is false.
 * @param {string|null} teacherUserId  users.id of the observed teacher
 */
async function isPrimaryVisit(teacherUserId) {
  if (!teacherUserId) return false;
  try {
    const { data, error } = await supabase.from('users').select('id, teacher_level').eq('id', teacherUserId).maybeSingle();
    if (error || !data) return false;
    return isPrimaryOnly(data);
  } catch (_) {
    return false;
  }
}

module.exports = { isPrimaryOnly, isPrimaryVisit };
