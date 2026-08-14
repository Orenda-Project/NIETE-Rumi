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
      class_name: 'Grade 4',
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

  it('reuses a teacher\'s existing roster row instead of tripping its unique index', async () => {
    // student_lists is unique on (user_id, LOWER(class_name), academic_year) where
    // active. A teacher who already added "Grade 4" the old way must not get a
    // duplicate-key failure when the class is created the new way.
    boot({
      student_lists: [{
        id: 'legacy-list-1', user_id: TEACHER, class_name: 'Grade 4', section: 'A',
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
    // The adopted roster keeps its students.
    expect(mockDb._tables.student_lists[0].student_count).toBe(8);
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
