'use strict';

/**
 * Queue #282 — which of a teacher's own recordings the Digital Coach's FICO17 v6 (the 11) may score once
 * fico_dc_rubric says 'v6' for her.
 *
 *   grades 1-5    yes (the operator, 11 Nov ~18:05: "for primary, both HITL and DC is FICO v6").
 *   grades 6-12   not decided for the DC (19 Nov: moving self-recordings to v6 / FICO 6-12 "would be a follow up"), so
 *                 they stay on V3 unless app_settings.fico_dc_grades says 'all' for that teacher (a row, no deploy).
 *
 * The lesson's grade is the recording's own (metadata.grade, from subject-resolution: the linked plan or the app's
 * lesson). When it is not a number from 1 to 12 (none, or ECE written in words), the teacher's band decides:
 * PRIMARY and nothing else counts as grades 1-5. Anything else (MIDDLE or HIGH in it, no band, a failed read) stays V3:
 * in doubt nothing moves, as for coach visits (coaching/fico-visit-grade.js). Never throws.
 */

const supabase = require('../../../../config/supabase');
const { teacherLevelOf } = require('../../../../utils/teacher-level');

const PRIMARY_MAX = 5;

/** A grade 1-12 as a number, else null ("4", 4, "Grade 4" → 4; "ای سی ڈی", "", null → null). */
function gradeNumber(grade) {
  if (grade === null || grade === undefined) return null;
  const m = String(grade).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 12 ? n : null;
}

async function primaryOnlyTeacher(userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase.from('users').select('id, teacher_level').eq('id', userId).maybeSingle();
    if (error || !data) return false;
    const bands = teacherLevelOf(data);
    return bands.length > 0 && bands.every((b) => b === 'PRIMARY');
  } catch (_) {
    return false;
  }
}

/**
 * @param {{grade?: string|number|null, userId?: string, region?: string|null}} who
 * @returns {Promise<boolean>}  may 'v6' score this recording?
 */
async function allowsV6({ grade, userId, region } = {}) {
  try {
    const n = gradeNumber(grade);
    if (n !== null && n <= PRIMARY_MAX) return true;
    const sw = require('../../fico-rubric-switch');
    const wide = typeof sw.dcGrades === 'function' && (await sw.dcGrades({ userId, region })) === 'all';
    if (wide) return true;
    if (n !== null) return false; // grades 6-12, not opened
    return await primaryOnlyTeacher(userId);
  } catch (_) {
    return false;
  }
}

module.exports = { allowsV6, gradeNumber, PRIMARY_MAX };
