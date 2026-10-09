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
  /** A number for GradeSubjectButton's "Grade 4-A"; '' when the title is carried by `subject`. */
  grade: number | '';
  section: string;
  subject: string;
  sub: string;
  to: string;
  first: boolean;
};

/**
 * One row per class: "Grade 4-A · <first subject>"; line 2 = her other subjects in that class, then
 * Class teacher. A class with no subject, or an early-years class, shows its title as the name.
 */
export function classRows(classes: TeacherClass[], words: Words): ClassRow[] {
  return classes.map((c, i) => {
    const n = gradeNumber(c.gradeCode);
    const labels = (c.subjects ?? []).map((s) => s.label).filter(Boolean);
    const sub = [labels.slice(1).join(', '), c.isClassTeacher ? words.classTeacher : '']
      .filter(Boolean).join(' · ');
    const titled = n === null || labels.length === 0;
    return {
      key: c.classId,
      grade: titled ? '' : n,
      section: titled ? '' : (c.section ?? ''),
      subject: titled ? [classTitle(c, words), labels[0]].filter(Boolean).join(' · ') : labels[0],
      sub,
      to: classPath(c.classId),
      first: i === 0,
    };
  });
}

/** Class detail's chips: the shift (by its label), the session and Class teacher — only what it has. */
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
  subjectCodes: string[];
  isClassTeacher: boolean;
};

/** POST /classes's body, or null until a class (grade) is chosen. No shift chosen → the server's default. */
export function toCreatePayload(f: ClassForm): CreateClassPayload | null {
  if (!f.gradeCode) return null;
  const out: CreateClassPayload = {
    gradeCode: f.gradeCode,
    section: f.section ?? null,
    subjectCodes: [...f.subjectCodes],
    isClassTeacher: f.isClassTeacher,
  };
  if (f.shiftCode) out.shiftCode = f.shiftCode;
  return out;
}
