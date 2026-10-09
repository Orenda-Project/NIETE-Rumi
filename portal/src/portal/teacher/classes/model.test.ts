import { describe, it, expect } from 'vitest';
import type { ClassesResponse, RosterStudent, TeacherClass } from '../../types/portal';
import type { GradeSubject } from '../../lib/gradeSubjects';
import {
  classChips, classRows, classTitle, gradeNumber, lessonPlansLink, rosterRows, toCreatePayload,
} from './model';
import { classPath } from './paths';
import { LESSONS_HOME } from '../lessons/paths';

/**
 * bd-fmf24g.8 — My Classes / Class detail: everything a page shows is computed here from the
 * existing GET /classes, GET /classes/:id/students and GET /me/grade-subjects answers.
 */

const cls = (over: Partial<TeacherClass> = {}): TeacherClass => ({
  classId: 'c1',
  gradeCode: 'grade_4',
  gradeLabel: 'Grade 4',
  section: 'A',
  shiftCode: 'morning',
  sessionCode: '2026-27',
  isClassTeacher: false,
  display: 'Grade 4 - A',
  subjects: [{ code: 'science', label: 'General Science' }],
  ...over,
});

const words = { grade: (g: string | number = '') => `Grade ${g}`.trim(), classTeacher: 'Class teacher' };

describe('gradeNumber', () => {
  it('reads grade_N codes and plain numbers, and gives null for early years or junk', () => {
    expect(gradeNumber('grade_4')).toBe(4);
    expect(gradeNumber('grade_12')).toBe(12);
    expect(gradeNumber('7')).toBe(7);
    expect(gradeNumber('early_years')).toBeNull();
    expect(gradeNumber('grade_13')).toBeNull();
    expect(gradeNumber('')).toBeNull();
  });
});

describe('classRows', () => {
  it('one row per class: grade + section + first subject, other subjects and Class teacher on line 2, linking to the class', () => {
    const rows = classRows([
      cls({ isClassTeacher: true }),
      cls({ classId: 'c2', gradeCode: 'grade_5', section: 'B', subjects: [{ code: 'maths', label: 'Math' }, { code: 'english', label: 'English' }] }),
    ], words);
    expect(rows).toEqual([
      { key: 'c1', grade: 4, section: 'A', subject: 'General Science', sub: 'Class teacher', to: classPath('c1'), first: true },
      { key: 'c2', grade: 5, section: 'B', subject: 'Math', sub: 'English', to: classPath('c2'), first: false },
    ]);
  });

  it('early years keeps its own label in place of a grade; a class with no subject still shows', () => {
    const [row] = classRows([cls({ gradeCode: 'early_years', gradeLabel: 'Early Years', section: null, subjects: [] })], words);
    expect(row.grade).toBe('');
    expect(row.subject).toBe('Early Years');
    expect(row.sub).toBe('');
  });
});

describe('classTitle / classChips', () => {
  it('title is the grade and section only', () => {
    expect(classTitle(cls(), words)).toBe('Grade 4-A');
    expect(classTitle(cls({ section: null }), words)).toBe('Grade 4');
    expect(classTitle(cls({ gradeCode: 'early_years', gradeLabel: 'Early Years', section: 'B' }), words)).toBe('Early Years-B');
  });

  it('chips are the shift (its label), the session and Class teacher — only what the class has', () => {
    const data = { shifts: [{ code: 'morning', label: 'Morning' }] } as Pick<ClassesResponse, 'shifts'>;
    expect(classChips(cls({ isClassTeacher: true }), data, words)).toEqual(['Morning', '2026-27', 'Class teacher']);
    expect(classChips(cls({ shiftCode: 'unknown', sessionCode: '' }), data, words)).toEqual([]);
  });
});

describe('lessonPlansLink', () => {
  const combo = (over: Partial<GradeSubject> = {}): GradeSubject => ({
    grade: 4, gradeCode: 'grade_4', subject: 'Science', subjectKey: 'science', source: 'class',
    featureKey: 'general_science', available: true, ...over,
  });

  it("one subject with lesson plans → that grade·subject's chapters", () => {
    const to = lessonPlansLink(cls(), [combo()]);
    expect(to).toBe(`${LESSONS_HOME}/chapters?grade=4&subject=general_science&key=science`);
  });

  it('no match, an unavailable subject, or several subjects → the Lesson Plans home (her picker)', () => {
    expect(lessonPlansLink(cls(), [])).toBe(LESSONS_HOME);
    expect(lessonPlansLink(cls(), [combo({ available: false, featureKey: null })])).toBe(LESSONS_HOME);
    expect(lessonPlansLink(cls(), [combo({ gradeCode: 'grade_5', grade: 5 })])).toBe(LESSONS_HOME);
    const two = cls({ subjects: [{ code: 'science', label: 'General Science' }, { code: 'maths', label: 'Math' }] });
    expect(lessonPlansLink(two, [combo(), combo({ subjectKey: 'maths', featureKey: 'math' })])).toBe(LESSONS_HOME);
  });
});

describe('rosterRows', () => {
  it('by roll number (no roll last, then by name), with the father on line 2', () => {
    const s = (studentId: string, studentName: string, rollNumber: number | null, fatherName: string | null = null): RosterStudent =>
      ({ studentId, studentName, rollNumber, fatherName, enrolledOn: null });
    expect(rosterRows([s('x', 'Zara', null), s('a', 'Ali', 2, 'Raza'), s('b', 'Amna', 1), s('y', 'Bilal', null)])).toEqual([
      { id: 'b', roll: '1', name: 'Amna', father: '' },
      { id: 'a', roll: '2', name: 'Ali', father: 'Raza' },
      { id: 'y', roll: '', name: 'Bilal', father: '' },
      { id: 'x', roll: '', name: 'Zara', father: '' },
    ]);
  });
});

describe('toCreatePayload', () => {
  it('needs a grade; sends section, shift, subjects and class teacher as chosen', () => {
    expect(toCreatePayload({ gradeCode: '', section: null, shiftCode: null, subjectCodes: [], isClassTeacher: false })).toBeNull();
    expect(toCreatePayload({ gradeCode: 'grade_4', section: 'A', shiftCode: 'morning', subjectCodes: ['science'], isClassTeacher: true }))
      .toEqual({ gradeCode: 'grade_4', section: 'A', shiftCode: 'morning', subjectCodes: ['science'], isClassTeacher: true });
    expect(toCreatePayload({ gradeCode: 'grade_4', section: null, shiftCode: null, subjectCodes: [], isClassTeacher: false }))
      .toEqual({ gradeCode: 'grade_4', section: null, subjectCodes: [], isClassTeacher: false });
  });
});
