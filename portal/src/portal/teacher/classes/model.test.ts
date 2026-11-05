import { describe, it, expect } from 'vitest';
import type { ClassesResponse, RosterStudent, TeacherClass } from '../../types/portal';
import type { GradeSubject } from '../../lib/gradeSubjects';
import {
  classChips, classLabel, classRows, classTitle, gradeNumber, lessonPlansLink, mineAlready, rosterRows, toCreatePayload,
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

const SHIFTS = { shifts: [{ code: 'morning', label: 'Morning' }, { code: 'evening', label: 'Evening' }] };

describe('classRows (bd-pqx8h9: titled by the class, never a subject)', () => {
  it('one row per class: "Grade 4-A · Morning", the grade number on the tile, Class teacher on line 2, linking to the class', () => {
    const rows = classRows([
      cls({ isClassTeacher: true }),
      cls({ classId: 'c2', gradeCode: 'grade_5', section: 'B', shiftCode: 'evening', subjects: [{ code: 'maths', label: 'Math' }, { code: 'english', label: 'English' }] }),
    ], SHIFTS, words);
    expect(rows).toEqual([
      { key: 'c1', tile: 4, title: 'Grade 4-A · Morning', sub: 'Class teacher', to: classPath('c1'), first: true },
      { key: 'c2', tile: 5, title: 'Grade 5-B · Evening', sub: '', to: classPath('c2'), first: false },
    ]);
  });

  it('early years keeps its own label and no number; no section, no shift label → just what there is', () => {
    const [row] = classRows([cls({ gradeCode: 'early_years', gradeLabel: 'Early Years', section: null, shiftCode: 'night' })], SHIFTS, words);
    expect(row.tile).toBeNull();
    expect(row.title).toBe('Early Years');
    expect(classLabel(cls({ section: null }), SHIFTS, words)).toBe('Grade 4 · Morning');
  });
});

describe('mineAlready', () => {
  it('finds her class with the same grade, section and shift in this session; anything else is new', () => {
    const mine = [cls(), cls({ classId: 'c2', sessionCode: '2025-26', gradeCode: 'grade_5' })];
    expect(mineAlready(mine, { gradeCode: 'grade_4', section: 'a', shiftCode: 'morning' }, '2026-27')?.classId).toBe('c1');
    expect(mineAlready(mine, { gradeCode: 'grade_4', section: 'A', shiftCode: 'evening' }, '2026-27')).toBeNull();
    expect(mineAlready(mine, { gradeCode: 'grade_4', section: 'B', shiftCode: 'morning' }, '2026-27')).toBeNull();
    expect(mineAlready(mine, { gradeCode: 'grade_5', section: 'A', shiftCode: 'morning' }, '2026-27')).toBeNull();
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

describe('toCreatePayload (bd-pqx8h9)', () => {
  it('needs a class, a section and a shift; sends no subjects', () => {
    expect(toCreatePayload({ gradeCode: '', section: 'A', shiftCode: 'morning', isClassTeacher: false })).toBeNull();
    expect(toCreatePayload({ gradeCode: 'grade_4', section: null, shiftCode: 'morning', isClassTeacher: false })).toBeNull();
    expect(toCreatePayload({ gradeCode: 'grade_4', section: 'A', shiftCode: null, isClassTeacher: false })).toBeNull();
    expect(toCreatePayload({ gradeCode: 'grade_4', section: 'A', shiftCode: 'morning', isClassTeacher: true }))
      .toEqual({ gradeCode: 'grade_4', section: 'A', shiftCode: 'morning', subjectCodes: [], isClassTeacher: true });
  });
});
