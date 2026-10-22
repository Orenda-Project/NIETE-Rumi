/**
 * A synthetic school roster in the shape of the NIETE sandbox tables (schools, classes,
 * class_enrollments, students, observation_field_forms, leader_schools). Placeholder names only.
 */
function buildRoster({ schoolId = 'school-1', classes = [], visits = 8, coachId = 'coach-1', sessionCode = '2026-2027' } = {}) {
  const seed = {
    schools: [{ id: schoolId, name: 'SIM — Test School', region: 'ict', is_active: true, is_probable_test: true, source_school_id: 9001 }],
    classes: [],
    class_enrollments: [],
    students: [],
    observation_field_forms: [],
    leader_schools: [{ id: 'ls-1', leader_user_id: coachId, source: 'niete_ict', school_ext_id: '9001', school_id: schoolId }],
    child_test_draws: [],
    child_test_sessions: [],
    child_test_blocks: [],
  };
  for (const c of classes) {
    const classId = c.id;
    seed.classes.push({
      id: classId, school_id: c.schoolId || schoolId, grade_code: `grade_${c.grade}`, section: c.section || 'A',
      session_code: c.sessionCode || sessionCode, is_active: c.isActive !== false, merged_into_class_id: null,
    });
    for (let r = 1; r <= c.size; r++) {
      const sid = `${classId}-st${String(r).padStart(2, '0')}`;
      seed.students.push({
        id: sid, school_id: c.schoolId || schoolId, roll_number: r, student_name: `Child ${c.grade}${c.section || 'A'}-${String(r).padStart(2, '0')}`,
        student_name_urdu: null, status: 'active', is_active: true, merged_into: null,
      });
      seed.class_enrollments.push({ id: `${sid}-e`, class_id: classId, student_id: sid, roll_number: r, is_active: true, left_on: null });
    }
  }
  for (let v = 1; v <= visits; v++) {
    seed.observation_field_forms.push({ id: `visit-${v}`, observer_user_id: coachId, visit_context: { school_ext_id: '9001' } });
  }
  return seed;
}

module.exports = { buildRoster };
