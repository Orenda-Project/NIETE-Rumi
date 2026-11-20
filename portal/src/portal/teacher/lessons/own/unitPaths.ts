import { LESSONS_HOME } from '../paths';
import { OWN_START } from './state';
import { PACES, PERIODS, type Pace } from './unitApi';

/**
 * bd-snkn32.59.1 (queue #165) — where "A whole unit" is, all in the address (the Lesson Plans rule: Back and a reload
 * land where she was). Pure. Codes only: anything off the lists is dropped.
 */
export const LESSONS_UNIT = `${LESSONS_HOME}/unit`;
export const LESSONS_UNIT_NEW = `${LESSONS_HOME}/unit/new`;
/** Make my own's class picker for a unit (NewLessonPage, start=unit). */
export const OWN_UNIT = `${OWN_START}&start=unit`;

export type UnitNewAt = { grade: number; subject: string; from?: number; to?: number; period?: number; pace?: Pace };

export function unitNewUrl(a: UnitNewAt): string {
  const q = new URLSearchParams({ grade: String(a.grade), subject: a.subject });
  if (a.from != null) q.set('from', String(a.from));
  if (a.to != null) q.set('to', String(a.to));
  if (a.period != null) q.set('period', String(a.period));
  if (a.pace) q.set('pace', a.pace);
  return `${LESSONS_UNIT_NEW}?${q.toString()}`;
}

const whole = (v: string | null) => (v != null && /^\d{1,3}$/.test(v) ? Number(v) : undefined);

/** Grades 1–5 only (the unit is the grades 1–5 book start); null for anything else. */
export function readUnitNew(search: string): UnitNewAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  if (!Number.isInteger(grade) || grade < 1 || grade > 5 || !subject) return null;
  const from = whole(q.get('from'));
  const to = from != null ? whole(q.get('to')) : undefined;
  const period = whole(q.get('period'));
  const pace = q.get('pace');
  return {
    grade, subject,
    ...(from != null ? { from } : {}),
    ...(to != null && to >= from! ? { to } : {}),
    ...(period != null && (PERIODS as readonly number[]).includes(period) ? { period } : {}),
    ...(pace && (PACES as readonly string[]).includes(pace) ? { pace: pace as Pace } : {}),
  };
}

export const unitUrl = (id: string) => `${LESSONS_UNIT}?id=${encodeURIComponent(id)}`;
