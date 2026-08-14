/**
 * ClassService — creating a class, assigning teachers, and the legacy mirror.
 *
 * Written BEFORE the service exists.
 *
 * The mirror is the load-bearing part. The new class CRUD is the single
 * teacher-facing surface, but attendance and 943 existing quizzes still read
 * `student_lists` — so creating a class must also write a mirror roster row and
 * link it via student_lists.class_id. If that write is wrong, a teacher creates
 * a class and then finds attendance cannot see it.
 */

const { createFakeSupabase } = require('../fixtures/fake-supabase');

let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...args) => mockDb.from(...args),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const SCHOOL = 'school-uuid-1';
const TEACHER = 'teacher-uuid-1';
const OTHER_TEACHER = 'teacher-uuid-2';

const GRADE_ROWS = [
  { code: 'early_years', ordinal: 0, band: 'early_years', aliases: ['early_years', 'KG'], is_active: true },
  { code: 'grade_4', ordinal: 4, band: 'primary', aliases: ['grade_4', 'Grade 4', '4'], is_active: true },
  { code: 'grade_5', ordinal: 5, band: 'primary', aliases: ['grade_5', 'Grade 5', '5'], is_active: true },
];
const SUBJECT_ROWS = [
  { code: 'maths', parent_code: null, aliases: ['maths', 'Math'], is_active: true },
  { code: 'science', parent_code: null, aliases: ['science', 'General Science'], is_active: true },
  { code: 'urdu', parent_code: null, aliases: ['urdu'], is_active: true },
];
const SECTION_ROWS = [
  { code: 'A', sort_order: 1, is_active: true },
  { code: 'B', sort_order: 2, is_active: true },
  { code: 'C', sort_order: 3, is_active: true },
  { code: 'D', sort_order: 4, is_active: true },
  { code: 'E', sort_order: 5, is_active: true },
];
const SHIFT_ROWS = [
  { code: 'morning', sort_order: 1, is_active: true },
  { code: 'evening', sort_order: 2, is_active: true },
];
const SESSION_ROWS = [
  { code: '2026-2027', kind: 'annual', starts_on: '2026-04-01', ends_on: '2027-03-31', is_active: true },
  { code: '2027-2028', kind: 'annual', starts_on: '2027-04-01', ends_on: '2028-03-31', is_active: true },
];

let svc;
function boot(seed = {}) {
  jest.resetModules();
  mockDb = createFakeSupabase({
    grade_levels: GRADE_ROWS,
    subjects: SUBJECT_ROWS,
    academic_sessions: SESSION_ROWS,
    sections: SECTION_ROWS,
    shifts: SHIFT_ROWS,
    student_lists: [],
    classes: [],
    class_teachers: [],
    class_teacher_subjects: [],
    class_enrollments: [],
    students: [],
    ...seed,
  });
  svc = require('../../bot/shared/services/classes/class.service');
}

beforeEach(() => boot());

describe('createClass', () => {
  it('creates the class and reports it as created', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(res.created).toBe(true);
    expect(res.class).toMatchObject({
      school_id: SCHOOL, grade_code: 'grade_4', section: 'A', session_code: '2026-2027',
    });
  });

  it('normalizes the section, so "a" and "A " cannot become two classes', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: ' a ',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.section).toBe('A');
  });

  it('treats an empty section as no section rather than an empty string', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: '   ',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.section).toBeNull();
  });

  it('is idempotent — re-adding the same class returns the existing row, not an error', async () => {
    const first = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    const second = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'a',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(second.created).toBe(false);
    expect(second.class.id).toBe(first.class.id);
    expect(mockDb._tables.classes).toHaveLength(1);
  });

  it('separates the same class in a different session', async () => {
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', sessionCode: '2026-2027', teacherUserId: TEACHER });
    const next = await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', sessionCode: '2027-2028', teacherUserId: TEACHER });

    expect(next.created).toBe(true);
    expect(mockDb._tables.classes).toHaveLength(2);
  });

  it('rejects an unknown grade code rather than storing it', async () => {
    await expect(svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_99', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    })).resolves.toMatchObject({ error: 'unknown_grade' });
    expect(mockDb._tables.classes).toHaveLength(0);
  });

  it('rejects an unknown session code', async () => {
    await expect(svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '1999-2000', teacherUserId: TEACHER,
    })).resolves.toMatchObject({ error: 'unknown_session' });
  });

  it('rejects a missing school', async () => {
    await expect(svc.createClass({
      schoolId: null, gradeCode: 'grade_4', sessionCode: '2026-2027', teacherUserId: TEACHER,
    })).resolves.toMatchObject({ error: 'missing_school' });
  });
});

describe('createClass — the legacy student_lists mirror', () => {
  it('writes a mirror roster row and links it via class_id', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    const mirrors = mockDb._tables.student_lists;
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({
      user_id: TEACHER,
      // Carries the section now: the name used to be the grade alone, which made
      // one teacher's 4-A and 4-B collide on student_lists' unique index.
      class_name: 'Grade 4 - A',
      section: 'A',
      academic_year: '2026-2027',
      class_id: res.class.id,
      is_active: true,
    });
  });

  it('names a pre-primary mirror without a grade number', async () => {
    await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'early_years', sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(mockDb._tables.student_lists[0].class_name).toBe('Early Years');
  });

  it('adopts the row it previously mirrored, students and all', async () => {
    // student_lists is unique on (user_id, LOWER(class_name), academic_year) where
    // active, so re-running createClass for the same class must ADOPT that row
    // rather than hit a duplicate-key error — and must not orphan its students.
    boot({
      student_lists: [{
        id: 'legacy-list-1', user_id: TEACHER, class_name: 'Grade 4 - A', section: 'A',
        academic_year: '2026-2027', is_active: true, class_id: null, student_count: 8,
      }],
    });

    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(mockDb._tables.student_lists).toHaveLength(1);
    expect(mockDb._tables.student_lists[0].id).toBe('legacy-list-1');
    expect(mockDb._tables.student_lists[0].class_id).toBe(res.class.id);
    expect(mockDb._tables.student_lists[0].student_count).toBe(8);
  });

  it('leaves an unrelated hand-made roster alone rather than claiming it', async () => {
    // A roster the teacher named herself ("4th grade morning") is NOT this class.
    // Adopting it on a fuzzy match would silently move someone else's students; the
    // honest outcome is a separate mirror and an untouched legacy row.
    boot({
      student_lists: [{
        id: 'hand-made', user_id: TEACHER, class_name: '4th grade morning', section: null,
        academic_year: '2026-2027', is_active: true, class_id: null, student_count: 31,
      }],
    });

    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(res.error).toBeUndefined();
    expect(res.mirrored).toBe(true);
    const untouched = mockDb._tables.student_lists.find((r) => r.id === 'hand-made');
    expect(untouched.class_id).toBeNull();
    expect(untouched.student_count).toBe(31);
    expect(mockDb._tables.student_lists).toHaveLength(2);
  });

  it('does not mirror onto another teacher\'s identically-named roster', async () => {
    boot({
      student_lists: [{
        id: 'other-list', user_id: OTHER_TEACHER, class_name: 'Grade 4',
        academic_year: '2026-2027', is_active: true, class_id: null,
      }],
    });

    await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(mockDb._tables.student_lists).toHaveLength(2);
    expect(mockDb._tables.student_lists.find((r) => r.id === 'other-list').class_id).toBeNull();
  });

  it('still returns the class when the mirror write fails, and says so', async () => {
    // A failed mirror must not lose the class the teacher just created. It
    // degrades attendance visibility, which is recoverable; losing the class is not.
    mockDb._failOn('student_lists', 'mirror boom');
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(res.class).toBeTruthy();
    expect(res.mirrored).toBe(false);
  });
});

describe('assignTeacher', () => {
  async function aClass() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    return cls;
  }

  it('records ONE row for a teacher taking several subjects', async () => {
    const cls = await aClass();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER,
      isClassTeacher: false, subjectCodes: ['maths', 'science'],
    });

    expect(res.error).toBeUndefined();
    expect(mockDb._tables.class_teachers).toHaveLength(1);
    expect(mockDb._tables.class_teacher_subjects).toHaveLength(2);
  });

  it('supports several teachers on one class', async () => {
    const cls = await aClass();
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['urdu'] });

    expect(mockDb._tables.class_teachers).toHaveLength(2);
  });

  it('lets the prime-responsible teacher also carry subjects on the SAME row', async () => {
    const cls = await aClass();
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER,
      isClassTeacher: true, subjectCodes: ['maths', 'science'],
    });

    expect(mockDb._tables.class_teachers).toHaveLength(1);
    expect(mockDb._tables.class_teachers[0].is_class_teacher).toBe(true);
    expect(mockDb._tables.class_teacher_subjects).toHaveLength(2);
  });

  it('allows a prime-responsible teacher with NO teaching load', async () => {
    const cls = await aClass();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: [],
    });

    expect(res.error).toBeUndefined();
    expect(mockDb._tables.class_teacher_subjects).toHaveLength(0);
  });

  it('declines the ROLE to a second claimant without refusing the assignment', async () => {
    // The invariant is still "one class teacher per class". What changed is the
    // consequence: the second claimant keeps her place on the class as a subject
    // teacher instead of losing the whole assignment.
    const cls = await aClass();
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true });
    const res = await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, isClassTeacher: true });

    expect(res.error).toBeUndefined();
    expect(res.classTeacherTaken).toBe(true);
    expect(mockDb._tables.class_teachers.filter((r) => r.is_class_teacher)).toHaveLength(1);
  });

  it('is idempotent for the same teacher, adding subjects rather than duplicating the row', async () => {
    const cls = await aClass();
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['science'] });

    expect(mockDb._tables.class_teachers).toHaveLength(1);
    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code).sort()).toEqual(['maths', 'science']);
  });

  it('rejects a subject the LP corpus cannot serve', async () => {
    const cls = await aClass();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths', 'islamiat'],
    });

    expect(res).toMatchObject({ error: 'unknown_subject' });
    // All-or-nothing: a bad code in the list writes none of them.
    expect(mockDb._tables.class_teacher_subjects).toHaveLength(0);
  });
});

describe('listClassesForTeacher', () => {
  it('returns the teacher\'s active classes with grade, section and session', async () => {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: ['maths'] });

    const list = await svc.listClassesForTeacher(TEACHER);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      classId: cls.id, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', isClassTeacher: true, subjectCodes: ['maths'],
    });
  });

  it('does not return another teacher\'s classes', async () => {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER });

    await expect(svc.listClassesForTeacher(OTHER_TEACHER)).resolves.toEqual([]);
  });

  it('returns an empty list, not an error, for a teacher with no classes', async () => {
    await expect(svc.listClassesForTeacher(TEACHER)).resolves.toEqual([]);
  });

  it('returns an empty list for a null user rather than throwing', async () => {
    await expect(svc.listClassesForTeacher(null)).resolves.toEqual([]);
  });
});

describe('a teacher joining a class someone else already created', () => {
  // Found on staging by creating the same class as two different teachers. The
  // second teacher ticked "I am the class teacher", and the role conflict aborted
  // her WHOLE assignment: no class_teachers row, her subject discarded, the class
  // absent from her list — while a legacy mirror row was still written for her.
  // A refused ROLE must not cost her the CLASS.
  async function classOwnedByFirstTeacher() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: ['maths'],
    });
    return cls;
  }

  it('still assigns the second teacher, as a subject teacher', async () => {
    const cls = await classOwnedByFirstTeacher();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER,
      isClassTeacher: true, subjectCodes: ['urdu'],
    });

    expect(res.error).toBeUndefined();
    expect(res.classTeacherTaken).toBe(true);
    expect(res.assignment.is_class_teacher).toBe(false);
    expect(mockDb._tables.class_teachers).toHaveLength(2);
  });

  it('keeps the subjects she chose', async () => {
    const cls = await classOwnedByFirstTeacher();
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER,
      isClassTeacher: true, subjectCodes: ['urdu', 'science'],
    });
    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code).sort())
      .toEqual(['maths', 'science', 'urdu']);
  });

  it('leaves the original class teacher in place', async () => {
    const cls = await classOwnedByFirstTeacher();
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, isClassTeacher: true,
    });
    const holders = mockDb._tables.class_teachers.filter((r) => r.is_class_teacher);
    expect(holders).toHaveLength(1);
    expect(holders[0].teacher_user_id).toBe(TEACHER);
  });

  it('shows the class in the second teacher\'s list', async () => {
    const cls = await classOwnedByFirstTeacher();
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, isClassTeacher: true, subjectCodes: ['urdu'],
    });

    const list = await svc.listClassesForTeacher(OTHER_TEACHER);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      classId: cls.id, isClassTeacher: false, subjectCodes: ['urdu'],
    });
  });

  it('does not create a duplicate class', async () => {
    await classOwnedByFirstTeacher();
    const second = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'a',
      sessionCode: '2026-2027', teacherUserId: OTHER_TEACHER,
    });
    expect(second.created).toBe(false);
    expect(mockDb._tables.classes).toHaveLength(1);
  });
});

describe('sections are a closed vocabulary', () => {
  it('accepts a seeded section, normalizing case', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'c',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.section).toBe('C');
  });

  it('refuses a section outside the vocabulary rather than storing it', async () => {
    // A teacher wanting F asks support, who adds a row. Storing it would recreate
    // exactly the free-text problem this model exists to remove.
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'F',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res).toMatchObject({ error: 'unknown_section' });
    expect(mockDb._tables.classes).toHaveLength(0);
  });

  it('refuses free text that used to pass the old normalization check', async () => {
    for (const bad of ['ALPHA', 'A-SECTION', 'RED', '1']) {
      const res = await svc.createClass({
        schoolId: SCHOOL, gradeCode: 'grade_5', section: bad,
        sessionCode: '2026-2027', teacherUserId: TEACHER,
      });
      expect(res.error).toBe('unknown_section');
    }
  });

  it('still allows a class with no section', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: '  ',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.section).toBeNull();
  });
});

describe('shift is part of the class identity', () => {
  it('defaults to morning', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.shift_code).toBe('morning');
  });

  it('records an evening class', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res.class.shift_code).toBe('evening');
  });

  it('treats morning and evening as DIFFERENT classes', async () => {
    // Different students, different teachers, everything.
    const am = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'morning',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    const pm = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });

    expect(pm.created).toBe(true);
    expect(pm.class.id).not.toBe(am.class.id);
    expect(mockDb._tables.classes).toHaveLength(2);
  });

  it('is still idempotent within one shift', async () => {
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening', sessionCode: '2026-2027', teacherUserId: TEACHER });
    const again = await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening', sessionCode: '2026-2027', teacherUserId: TEACHER });
    expect(again.created).toBe(false);
    expect(mockDb._tables.classes).toHaveLength(1);
  });

  it('refuses an unknown shift', async () => {
    const res = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', shiftCode: 'night',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(res).toMatchObject({ error: 'unknown_shift' });
  });

  it('reports the shift in the class list', async () => {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER });
    const list = await svc.listClassesForTeacher(TEACHER);
    expect(list[0].shiftCode).toBe('evening');
  });
});

describe('the legacy mirror must not merge distinct classes', () => {
  // student_lists is unique on (user_id, LOWER(class_name), academic_year). The
  // mirror name was derived from the GRADE alone, so one teacher's 4-A and 4-B
  // collided and the second silently ADOPTED the first's roster. Shift would have
  // made it worse.
  it('gives two sections of the same grade DIFFERENT mirror rows', async () => {
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', sessionCode: '2026-2027', teacherUserId: TEACHER });
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'B', sessionCode: '2026-2027', teacherUserId: TEACHER });

    const names = mockDb._tables.student_lists.map((r) => r.class_name);
    expect(mockDb._tables.student_lists).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('gives the morning and evening class DIFFERENT mirror rows', async () => {
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'morning', sessionCode: '2026-2027', teacherUserId: TEACHER });
    await svc.createClass({ schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A', shiftCode: 'evening', sessionCode: '2026-2027', teacherUserId: TEACHER });

    expect(mockDb._tables.student_lists).toHaveLength(2);
    expect(new Set(mockDb._tables.student_lists.map((r) => r.class_name)).size).toBe(2);
  });
});

describe('one teacher per subject per class', () => {
  async function classWithMathsTakenByFirstTeacher() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    return cls;
  }

  it('refuses a subject another teacher already teaches to that class', async () => {
    const cls = await classWithMathsTakenByFirstTeacher();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths'],
    });

    expect(res.subjectsTaken).toEqual([{ code: 'maths', heldBy: TEACHER }]);
    expect(mockDb._tables.class_teacher_subjects.filter((r) => r.subject_code === 'maths')).toHaveLength(1);
  });

  it('still assigns the subjects that are free', async () => {
    // Same principle as the declined class-teacher role: a conflict on one thing
    // must not discard the rest of her request.
    const cls = await classWithMathsTakenByFirstTeacher();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths', 'urdu'],
    });

    expect(res.error).toBeUndefined();
    expect(res.subjectsTaken.map((s) => s.code)).toEqual(['maths']);
    const mine = mockDb._tables.class_teachers.find((r) => r.teacher_user_id === OTHER_TEACHER);
    const hers = mockDb._tables.class_teacher_subjects.filter((r) => r.class_teacher_id === mine.id);
    expect(hers.map((r) => r.subject_code)).toEqual(['urdu']);
  });

  it('lets the same teacher re-submit her own subject without complaint', async () => {
    const cls = await classWithMathsTakenByFirstTeacher();
    const res = await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths', 'science'],
    });
    expect(res.subjectsTaken).toEqual([]);
    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code).sort())
      .toEqual(['maths', 'science']);
  });

  it('allows the same subject in a DIFFERENT class', async () => {
    await classWithMathsTakenByFirstTeacher();
    const { class: other } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_5', section: 'A',
      sessionCode: '2026-2027', teacherUserId: OTHER_TEACHER,
    });
    const res = await svc.assignTeacher({
      classId: other.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths'],
    });
    expect(res.subjectsTaken).toEqual([]);
  });

  it('stamps class_id on the subject row, which is what the unique index spans', async () => {
    const cls = await classWithMathsTakenByFirstTeacher();
    expect(mockDb._tables.class_teacher_subjects[0].class_id).toBe(cls.id);
  });
});

describe('editing your relationship to a class', () => {
  async function myClass(subjects = ['maths'], role = true) {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({
      classId: cls.id, teacherUserId: TEACHER, isClassTeacher: role, subjectCodes: subjects,
    });
    return cls;
  }

  it('adds a subject', async () => {
    const cls = await myClass(['maths']);
    const res = await svc.updateAssignment({
      classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths', 'urdu'],
    });
    expect(res.error).toBeUndefined();
    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code).sort())
      .toEqual(['maths', 'urdu']);
  });

  it('REMOVES a subject she no longer teaches, and frees it for a colleague', async () => {
    // The documented consequence of (class, subject) uniqueness: if removal did not
    // delete the row, the subject would stay locked to a teacher who dropped it.
    const cls = await myClass(['maths', 'urdu']);
    await svc.updateAssignment({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['urdu'] });

    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code)).toEqual(['urdu']);

    const colleague = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths'],
    });
    expect(colleague.subjectsTaken).toEqual([]);
  });

  it('releases the class-teacher role, so a colleague can claim it', async () => {
    const cls = await myClass(['maths'], true);
    await svc.updateAssignment({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: false });

    const colleague = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, isClassTeacher: true,
    });
    expect(colleague.classTeacherTaken).toBeFalsy();
    expect(colleague.assignment.is_class_teacher).toBe(true);
  });

  it('will not let her take a subject a colleague already teaches', async () => {
    const cls = await myClass(['urdu']);
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths'] });

    const res = await svc.updateAssignment({
      classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['urdu', 'maths'],
    });
    expect(res.subjectsTaken.map((s) => s.code)).toEqual(['maths']);
    // Her own subject survives the rejected one.
    const mine = mockDb._tables.class_teachers.find((r) => r.teacher_user_id === TEACHER);
    expect(mockDb._tables.class_teacher_subjects
      .filter((r) => r.class_teacher_id === mine.id).map((r) => r.subject_code)).toEqual(['urdu']);
  });

  it('refuses to edit a class she is not on', async () => {
    const cls = await myClass();
    const res = await svc.updateAssignment({
      classId: cls.id, teacherUserId: 'stranger', subjectCodes: ['urdu'],
    });
    expect(res).toMatchObject({ error: 'not_assigned' });
  });

  it('never lets identity be edited through this path', async () => {
    // Grade, section, shift and session are identity. Changing them is a different
    // class, not an edit — and would either collide with the identity index or
    // rename a class other teachers and rosters point at.
    const cls = await myClass();
    await svc.updateAssignment({
      classId: cls.id, teacherUserId: TEACHER,
      gradeCode: 'grade_5', section: 'B', shiftCode: 'evening', sessionCode: '2027-2028',
    });
    const after = mockDb._tables.classes.find((c) => c.id === cls.id);
    expect(after).toMatchObject({
      grade_code: 'grade_4', section: 'A', shift_code: 'morning', session_code: '2026-2027',
    });
  });
});

describe('leaving a class', () => {
  async function sharedClass() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: ['maths'] });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['urdu'] });
    return cls;
  }

  it('drops her assignment but leaves the class standing for everyone else', async () => {
    const cls = await sharedClass();
    const res = await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });

    expect(res.error).toBeUndefined();
    expect(res.left).toBe(true);
    const active = mockDb._tables.class_teachers.filter((r) => r.is_active);
    expect(active.map((r) => r.teacher_user_id)).toEqual([OTHER_TEACHER]);
    expect(mockDb._tables.classes.find((c) => c.id === cls.id).is_active).toBe(true);
  });

  it('frees the subjects she was teaching', async () => {
    const cls = await sharedClass();
    await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });

    expect(mockDb._tables.class_teacher_subjects.map((r) => r.subject_code)).toEqual(['urdu']);
    const back = await svc.assignTeacher({
      classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['maths'],
    });
    expect(back.subjectsTaken).toEqual([]);
  });

  it('hides it from her attendance by deactivating her mirror row', async () => {
    const cls = await sharedClass();
    await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });
    const mine = mockDb._tables.student_lists.filter((r) => r.user_id === TEACHER);
    expect(mine.every((r) => r.is_active === false)).toBe(true);
  });

  it('drops it from her class list', async () => {
    const cls = await sharedClass();
    await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });
    await expect(svc.listClassesForTeacher(TEACHER)).resolves.toEqual([]);
  });

  it('is idempotent', async () => {
    const cls = await sharedClass();
    await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });
    const again = await svc.leaveClass({ classId: cls.id, teacherUserId: TEACHER });
    expect(again.error).toBeUndefined();
    expect(again.left).toBe(false);
  });
});

describe('deleting a class', () => {
  async function soloEmptyClass() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, isClassTeacher: true, subjectCodes: ['maths'] });
    return cls;
  }

  it('soft-deletes a class that is hers alone and has no students', async () => {
    const cls = await soloEmptyClass();
    const res = await svc.deactivateClass({ classId: cls.id, teacherUserId: TEACHER });

    expect(res.error).toBeUndefined();
    expect(mockDb._tables.classes.find((c) => c.id === cls.id).is_active).toBe(false);
    // Soft, never hard: a hard delete cascades enrollments away and strands the
    // mirror with a null link, leaving a ghost roster visible in attendance.
    expect(mockDb._tables.classes).toHaveLength(1);
  });

  it('frees the identity, so the same class can be created again', async () => {
    // The identity index is partial on is_active, which is what makes this work.
    const cls = await soloEmptyClass();
    await svc.deactivateClass({ classId: cls.id, teacherUserId: TEACHER });

    const again = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    expect(again.created).toBe(true);
    expect(again.class.id).not.toBe(cls.id);
  });

  it('REFUSES when another teacher is still on the class', async () => {
    const cls = await soloEmptyClass();
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['urdu'] });

    const res = await svc.deactivateClass({ classId: cls.id, teacherUserId: TEACHER });
    expect(res).toMatchObject({ error: 'other_teachers' });
    expect(mockDb._tables.classes.find((c) => c.id === cls.id).is_active).toBe(true);
  });

  it('REFUSES when students are enrolled', async () => {
    const cls = await soloEmptyClass();
    mockDb._tables.students.push({ id: 'kid-1', student_name: 'Ayesha', is_active: true });
    await svc.enrollStudent({ classId: cls.id, studentId: 'kid-1' });

    const res = await svc.deactivateClass({ classId: cls.id, teacherUserId: TEACHER });
    expect(res).toMatchObject({ error: 'has_students' });
    expect(mockDb._tables.classes.find((c) => c.id === cls.id).is_active).toBe(true);
  });

  it('refuses for someone who is not on the class', async () => {
    const cls = await soloEmptyClass();
    const res = await svc.deactivateClass({ classId: cls.id, teacherUserId: 'stranger' });
    expect(res).toMatchObject({ error: 'not_assigned' });
  });

  it('deactivates her mirror row too, so attendance stops offering it', async () => {
    const cls = await soloEmptyClass();
    await svc.deactivateClass({ classId: cls.id, teacherUserId: TEACHER });
    expect(mockDb._tables.student_lists.every((r) => r.is_active === false)).toBe(true);
  });
});

describe('the class roster', () => {
  async function aClassOf(teacher = TEACHER) {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: teacher,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: teacher, subjectCodes: ['maths'] });
    return cls;
  }

  it('adds a student to the CLASS, not to a teacher', async () => {
    const cls = await aClassOf();
    const res = await svc.addStudent({
      classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi', rollNumber: 1,
    });

    expect(res.error).toBeUndefined();
    expect(mockDb._tables.students).toHaveLength(1);
    expect(mockDb._tables.class_enrollments).toHaveLength(1);
    expect(mockDb._tables.class_enrollments[0]).toMatchObject({
      class_id: cls.id, student_id: res.student.id, roll_number: 1, is_active: true,
    });
  });

  it('shows the SAME roster to every teacher on the class', async () => {
    // The point of the model: the roster belongs to the class. A colleague who
    // joins sees the children already there.
    const cls = await aClassOf();
    await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER, subjectCodes: ['urdu'] });

    const seen = await svc.listStudents({ classId: cls.id, teacherUserId: OTHER_TEACHER });
    expect(seen.map((s) => s.studentName)).toEqual(['Ayesha Bibi']);
  });

  it('refuses to read or write a roster she is not assigned to', async () => {
    const cls = await aClassOf();
    await expect(svc.listStudents({ classId: cls.id, teacherUserId: 'stranger' }))
      .resolves.toEqual([]);
    const res = await svc.addStudent({
      classId: cls.id, teacherUserId: 'stranger', studentName: 'Nobody',
    });
    expect(res).toMatchObject({ error: 'not_assigned' });
  });

  it('requires a name', async () => {
    const cls = await aClassOf();
    const res = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: '  ' });
    expect(res).toMatchObject({ error: 'missing_name' });
    expect(mockDb._tables.students).toHaveLength(0);
  });

  it('does not enroll the same child twice', async () => {
    const cls = await aClassOf();
    const first = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });
    const again = await svc.enrollStudent({ classId: cls.id, studentId: first.student.id });
    expect(again.created).toBe(false);
    expect(mockDb._tables.class_enrollments).toHaveLength(1);
  });

  it('removes a student SOFTLY, closing her enrollment', async () => {
    // Shared roster: a hard delete would remove her for every teacher AND orphan
    // the attendance records that reference her. left_on/outcome exist for this.
    const cls = await aClassOf();
    const { student } = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });

    const res = await svc.removeStudent({ classId: cls.id, teacherUserId: TEACHER, studentId: student.id });
    expect(res.error).toBeUndefined();

    const row = mockDb._tables.class_enrollments[0];
    expect(row.is_active).toBe(false);
    expect(row.left_on).toBeTruthy();
    expect(row.outcome).toBe('left');
    // The child herself survives — she may be enrolled elsewhere, and history
    // points at her.
    expect(mockDb._tables.students).toHaveLength(1);
  });

  it('drops her from the roster every teacher sees', async () => {
    const cls = await aClassOf();
    const { student } = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: OTHER_TEACHER });
    await svc.removeStudent({ classId: cls.id, teacherUserId: OTHER_TEACHER, studentId: student.id });

    await expect(svc.listStudents({ classId: cls.id, teacherUserId: TEACHER })).resolves.toEqual([]);
  });

  it('lets a removed child be re-enrolled, as a new enrollment', async () => {
    const cls = await aClassOf();
    const { student } = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });
    await svc.removeStudent({ classId: cls.id, teacherUserId: TEACHER, studentId: student.id });
    const back = await svc.enrollStudent({ classId: cls.id, studentId: student.id });

    expect(back.created).toBe(true);
    // Two enrollments, one closed and one open — which IS the history.
    expect(mockDb._tables.class_enrollments).toHaveLength(2);
  });

  it('attaches the child to the adding teacher\'s legacy roster so her attendance still works', async () => {
    // The mirror is PER TEACHER and students.list_id is a single FK, so a shared
    // roster cannot be mirrored to every teacher. Attaching to the adder preserves
    // exactly today's behaviour for her; full sharing arrives with the attendance
    // migration. Stated in a test so the limit is deliberate, not discovered.
    const cls = await aClassOf();
    const { student } = await svc.addStudent({ classId: cls.id, teacherUserId: TEACHER, studentName: 'Ayesha Bibi' });

    const mirror = mockDb._tables.student_lists.find((r) => r.class_id === cls.id && r.user_id === TEACHER);
    expect(mockDb._tables.students.find((s) => s.id === student.id).list_id).toBe(mirror.id);
  });
});

describe('adding a whole class at once', () => {
  // The attendance flow carries this lesson in its own source: the version it
  // replaced added one student per screen round-trip, "which is why no class was
  // ever finished on this deployment". A roster is pasted, not typed one at a time.
  async function aClass() {
    const { class: cls } = await svc.createClass({
      schoolId: SCHOOL, gradeCode: 'grade_4', section: 'A',
      sessionCode: '2026-2027', teacherUserId: TEACHER,
    });
    await svc.assignTeacher({ classId: cls.id, teacherUserId: TEACHER, subjectCodes: ['maths'] });
    return cls;
  }

  it('adds every line of a pasted register', async () => {
    const cls = await aClass();
    const res = await svc.addStudents({
      classId: cls.id, teacherUserId: TEACHER,
      rawText: 'Ayesha Bibi\nBilal Ahmed\nFatima Noor',
    });

    expect(res.error).toBeUndefined();
    expect(res.added).toBe(3);
    expect(mockDb._tables.class_enrollments.filter((e) => e.is_active)).toHaveLength(3);
  });

  it('captures father names in both forms teachers write', async () => {
    const cls = await aClass();
    await svc.addStudents({
      classId: cls.id, teacherUserId: TEACHER,
      rawText: 'Ayesha Bibi, Muhammad Aslam\nBilal Ahmed s/o Tariq Mahmood',
    });

    const kids = mockDb._tables.students;
    expect(kids.find((k) => k.student_name === 'Ayesha Bibi').father_name).toBe('Muhammad Aslam');
    expect(kids.find((k) => k.student_name === 'Bilal Ahmed').father_name).toBe('Tariq Mahmood');
  });

  it('strips the list markers teachers paste from a register', async () => {
    const cls = await aClass();
    await svc.addStudents({
      classId: cls.id, teacherUserId: TEACHER,
      rawText: '1. Ayesha Bibi\n2) Bilal Ahmed\n- Fatima Noor\n\n',
    });
    expect(mockDb._tables.students.map((k) => k.student_name).sort())
      .toEqual(['Ayesha Bibi', 'Bilal Ahmed', 'Fatima Noor']);
  });

  it('numbers them sequentially, continuing from the roster that is already there', async () => {
    const cls = await aClass();
    await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: 'Ayesha Bibi\nBilal Ahmed' });
    await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: 'Fatima Noor' });

    const roll = (await svc.listStudents({ classId: cls.id, teacherUserId: TEACHER }))
      .map((s) => [s.studentName, s.rollNumber]);
    expect(roll).toEqual([['Ayesha Bibi', 1], ['Bilal Ahmed', 2], ['Fatima Noor', 3]]);
  });

  it('does not add the same child twice from one paste', async () => {
    const cls = await aClass();
    const res = await svc.addStudents({
      classId: cls.id, teacherUserId: TEACHER,
      rawText: 'Ayesha Bibi\nayesha bibi\nBilal Ahmed',
    });
    expect(res.added).toBe(2);
    expect(res.duplicates).toBe(1);
  });

  it('does not re-add a child already on the roster', async () => {
    const cls = await aClass();
    await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: 'Ayesha Bibi' });
    const res = await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: 'Ayesha Bibi\nBilal Ahmed' });

    expect(res.added).toBe(1);
    expect(res.duplicates).toBe(1);
    expect(mockDb._tables.class_enrollments.filter((e) => e.is_active)).toHaveLength(2);
  });

  it('caps a runaway paste and SAYS how many it dropped', async () => {
    // One mis-paste — a whole school, a spreadsheet column — must not write
    // thousands of rows, and the teacher has to be told rather than left guessing.
    const cls = await aClass();
    const names = Array.from({ length: 320 }, (_, i) => `Child ${i + 1}`).join('\n');
    const res = await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: names });

    expect(res.added).toBe(300);
    expect(res.dropped).toBe(20);
  });

  it('rejects an empty paste', async () => {
    const cls = await aClass();
    const res = await svc.addStudents({ classId: cls.id, teacherUserId: TEACHER, rawText: '   \n\n' });
    expect(res).toMatchObject({ error: 'no_names' });
    expect(mockDb._tables.students).toHaveLength(0);
  });

  it('refuses a teacher who is not on the class', async () => {
    const cls = await aClass();
    const res = await svc.addStudents({ classId: cls.id, teacherUserId: 'stranger', rawText: 'Ayesha Bibi' });
    expect(res).toMatchObject({ error: 'not_assigned' });
    expect(mockDb._tables.students).toHaveLength(0);
  });
});

describe('the shared roster parser handles the markers teachers actually paste', () => {
  // Only one production consumer (addStudents), and it had a real gap: the closing
  // paren form was not stripped, so "2) Bilal Ahmed" was stored with the marker in
  // the child's name. Asserted here because the root suite is what CI runs first.
  const StudentListService = require('../../bot/shared/services/student-list.service');

  it.each([
    ['1. Ayesha Bibi', 'Ayesha Bibi'],
    ['2) Bilal Ahmed', 'Bilal Ahmed'],
    ['3 - Fatima Noor', 'Fatima Noor'],
    ['04. Hamza Ali', 'Hamza Ali'],
    ['- Zainab Khan', 'Zainab Khan'],
    ['• Usman Tariq', 'Usman Tariq'],
    ['* Hira Shah', 'Hira Shah'],
  ])('strips %s', (line, expected) => {
    expect(StudentListService.parseStudentText(line)[0].studentName).toBe(expected);
  });

  it('leaves a name that merely begins with digits alone', () => {
    // The separator requirement is the whole reason this is safe.
    expect(StudentListService.parseStudentText('7up Khan')[0].studentName).toBe('7up Khan');
  });
});
