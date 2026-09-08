/**
 * Taking a child off a roster must be recorded TRUTHFULLY.
 *
 * WHY. `class_enrollments.outcome` opened with five values — 'promoted',
 * 'retained', 'transferred', 'left', 'completed' — and every one of them asserts
 * something that really happened to the CHILD. None of them says what a removal
 * on `/class` or `/roster` actually is: a person looked at the roster and said
 * this enrolment should not be there. The scanner picks up a stray register line
 * (Mubashar Zia's "1", 4 Sep), or a coach strikes a child off a class she was
 * never in. `removeStudent()` defaulted to 'left', so 865 rows on NIETE prod now
 * claim a child left school when nobody ever said so — and that is precisely the
 * number attrition analysis would read.
 *
 * We are NOT asked why. Neither surface offers a reason. So the only value the
 * writer can stamp honestly is the one that describes the record event —
 * 'roster_correction' — not a life event we did not observe. A caller that DOES
 * know (a future promotion or leaver flow) still passes its own outcome, so the
 * vocabulary loses nothing.
 *
 * The twin below cannot fail the way the CHECK constraint fails; the constraint
 * half is proven against a real staging Postgres by
 * `06_Logs & Misc/Reports/Active/Simulation Week - July 2026/ICT/Roster and
 * Attendance - Sep 2026/evidence/verify_enrollment_outcome_sql.py`.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-uuid-1';
const TEACHER = 'teacher-uuid-1';

let svc;
beforeEach(() => {
  jest.resetModules();
  mockDb = createFakeSupabase({
    grade_levels: [{ code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4'], is_active: true }],
    subjects: [{ code: 'maths', parent_code: null, aliases: ['maths'], is_active: true }],
    academic_sessions: [{ code: '2026-2027', kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true }],
    sections: [{ code: 'A', sort_order: 1, is_active: true }],
    shifts: [{ code: 'morning', sort_order: 1, is_active: true }],
    student_lists: [],
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    students: [],
  });
  svc = require('../../bot/shared/services/classes/class.service');
});

async function aClassWithAChild() {
  const { class: cls } = await svc.createClass({
    schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
    sessionCode: '2026-2027', teacherUserId: TEACHER,
  });
  await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
  const { student } = await svc.addStudent({
    classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi',
  });
  return { cls, student };
}

describe('removeStudent stamps a roster correction, not a departure', () => {
  it("records 'roster_correction' — the removal is a record event, not a life event", async () => {
    const { cls, student } = await aClassWithAChild();

    const res = await svc.removeStudent({
      classId: cls.id, teacherUserId: TEACHER, studentId: student.id,
    });
    expect(res.error).toBeUndefined();
    expect(res.removed).toBe(true);

    const row = mockDb._tables.class_enrollments[0];
    expect(row.outcome).toBe('roster_correction');
    expect(row.is_active).toBe(false);
    expect(row.left_on).toBeTruthy();
  });

  it("never claims she LEFT — that is the value that corrupted attrition", async () => {
    const { cls, student } = await aClassWithAChild();
    await svc.removeStudent({ classId: cls.id, teacherUserId: TEACHER, studentId: student.id });

    expect(mockDb._tables.class_enrollments[0].outcome).not.toBe('left');
  });

  it('still lets a caller who actually knows say so', async () => {
    // The parameter survives: a promotion or a real leaver flow passes its own
    // value. Only the default — what a surface that never asked stamps — moves.
    const { cls, student } = await aClassWithAChild();
    await svc.removeStudent({
      classId: cls.id, teacherUserId: TEACHER, studentId: student.id, outcome: 'transferred',
    });

    expect(mockDb._tables.class_enrollments[0].outcome).toBe('transferred');
  });
});
