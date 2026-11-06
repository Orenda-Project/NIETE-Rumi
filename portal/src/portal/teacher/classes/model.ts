import type { ClassesResponse, CreateClassPayload, RosterStudent, TeacherClass } from '../../types/portal';
import type { GradeSubject } from '../../lib/gradeSubjects';
import { LESSONS_HOME, lessonsUrl } from '../lessons/paths';
import { classPath } from './paths';

/**
 * bd-fmf24g.8 — what the teacher v2 My Classes pages show, computed from the existing answers:
 * GET /classes (her classes, already labelled in her language), GET /classes/:id/students and
 * GET /me/grade-subjects?feature=lessons. Nothing here invents a number or a label.
 */

type Words = { grade: (g?: string | number) => string; classTeacher: string };

/** A class grade_code ('grade_4') or a plain number → 1–12; null for early years or anything else. */
export function gradeNumber(code: string | null | undefined): number | null {
  const m = /^(?:grade_)?(\d{1,2})$/.exec(String(code ?? '').trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

const sectionPart = (section: string | null | undefined) => (section ? `-${section}` : '');

/** "Grade 4-A" — the grade and section only (early years keeps its own label). */
export function classTitle(c: TeacherClass, words: Pick<Words, 'grade'>): string {
  const n = gradeNumber(c.gradeCode);
  return n !== null ? words.grade(`${n}${sectionPart(c.section)}`) : `${c.gradeLabel}${sectionPart(c.section)}`;
}

export type ClassRow = {
  key: string;
  /** The grade number on the row's tile; null for early years (the tile shows an icon). */
  tile: number | null;
  /** "Grade 4-A · Morning": the class, never a subject (bd-pqx8h9). */
  title: string;
  /** Line 2: Class teacher, or ''. */
  sub: string;
  to: string;
  first: boolean;
};

type ShiftList = Pick<ClassesResponse, 'shifts'> | null | undefined;

/** "Grade 4-A · Morning" — the class and its shift (the shift's label from GET /classes); no subject. */
export function classLabel(c: TeacherClass, data: ShiftList, words: Pick<Words, 'grade'>): string {
  const shift = (data?.shifts ?? []).find((s) => s.code === c.shiftCode)?.label;
  return [classTitle(c, words), shift].filter(Boolean).join(' · ');
}

/**
 * bd-pqx8h9 — one row per class, titled by the class ("Grade 4-A · Morning"); Class teacher on line 2. Subjects a
 * class may still carry from before are not shown: a class is grade, section and shift.
 */
export function classRows(classes: TeacherClass[], data: ShiftList, words: Words): ClassRow[] {
  return classes.map((c, i) => ({
    key: c.classId,
    tile: gradeNumber(c.gradeCode),
    title: classLabel(c, data, words),
    sub: c.isClassTeacher ? words.classTeacher : '',
    to: classPath(c.classId),
    first: i === 0,
  }));
}

/**
 * bd-pqx8h9 — her class with this grade, section and shift in the current session, or null. Adding it again is
 * not a new class (the server would quietly merge it), so Add a class says so instead of saving.
 */
export function mineAlready(
  classes: TeacherClass[],
  f: { gradeCode: string; section: string; shiftCode: string },
  session: string | null | undefined,
): TeacherClass | null {
  const section = f.section.trim().toUpperCase();
  return classes.find((c) => c.gradeCode === f.gradeCode
    && (c.section ?? '').toUpperCase() === section
    && c.shiftCode === f.shiftCode
    && (!session || !c.sessionCode || c.sessionCode === session)) ?? null;
}

export function classChips(c: TeacherClass, data: Pick<ClassesResponse, 'shifts'> | null | undefined, words: Words): string[] {
  const shift = (data?.shifts ?? []).find((s) => s.code === c.shiftCode)?.label;
  return [shift, c.sessionCode || null, c.isClassTeacher ? words.classTeacher : null]
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/**
 * The Lesson plans shortcut: with ONE subject the lesson-plan catalogue has for this grade, straight to
 * that grade·subject's chapters; otherwise (none, or several) the Lesson Plans home, where her classes
 * are the picker. A class's subject codes are the combos' subject keys (dashboard subject-vocabulary).
 */
export function lessonPlansLink(c: TeacherClass, combos: GradeSubject[] | null | undefined): string {
  const subjects = c.subjects ?? [];
  if (subjects.length !== 1) return LESSONS_HOME;
  const hit = (combos ?? []).find((g) => g.gradeCode === c.gradeCode && g.subjectKey === subjects[0].code
    && g.available === true && !!g.featureKey && g.grade !== null);
  if (!hit || hit.grade === null || !hit.featureKey) return LESSONS_HOME;
  return lessonsUrl('chapters', { grade: hit.grade, subject: hit.featureKey, key: hit.subjectKey });
}

export type RosterRow = { id: string; roll: string; name: string; father: string };

/** The register's order: roll numbers first (ascending), then children without one, by name. */
export function rosterRows(students: RosterStudent[]): RosterRow[] {
  return [...students]
    .sort((a, b) => {
      const ra = a.rollNumber ?? Infinity;
      const rb = b.rollNumber ?? Infinity;
      if (ra !== rb) return ra - rb;
      return a.studentName.localeCompare(b.studentName);
    })
    .map((s) => ({
      id: s.studentId,
      roll: s.rollNumber === null || s.rollNumber === undefined ? '' : String(s.rollNumber),
      name: s.studentName,
      father: s.fatherName ?? '',
    }));
}

export type ClassForm = {
  gradeCode: string;
  section: string | null;
  shiftCode: string | null;
  isClassTeacher: boolean;
};

/**
 * POST /classes's body, or null until a class, a section and a shift are all chosen (bd-pqx8h9: all three
 * required; a class with no sections is section A). No subjects: the portal no longer asks for them.
 */
export function toCreatePayload(f: ClassForm): CreateClassPayload | null {
  if (!f.gradeCode || !f.section || !f.shiftCode) return null;
  return {
    gradeCode: f.gradeCode,
    section: f.section,
    shiftCode: f.shiftCode,
    subjectCodes: [],
    isClassTeacher: f.isClassTeacher,
  };
}
