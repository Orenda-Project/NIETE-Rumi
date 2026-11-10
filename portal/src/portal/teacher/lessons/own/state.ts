import { LESSONS_OWN } from '../paths';
import { LEVELS, RESOURCES, SIZES, WAYS, type Level, type Resource, type Size, type Way } from './rules';
import { fmtPg, parsePg, type PageRange } from './pages';

/**
 * bd-snkn32 — where "Make my own" is, all in the address (the Lesson Plans rule, paths.ts: Back and a reload land where
 * she was). Pure. Codes only: anything off the lists is dropped. The textbook is always there, so it never rides in it.
 */

export { LESSONS_OWN };
export const OWN_STEPS = ['pages', 'size', 'resources', 'level', 'way', 'check'] as const;
export type OwnStep = (typeof OWN_STEPS)[number];

export type OwnAt = {
  grade: number;
  subject: string;
  chapter: string;
  step: OwnStep;
  seg: string | null;
  size: Size | null;
  res: Resource[];
  level: Level | null;
  way: Way | null;
  /** bd-snkn32.17 — grades 1–5: the book pages she chose, when not the day's own. */
  pg?: PageRange;
};

const pick = <T extends string>(list: readonly T[], v: string | null): T | null => (v && (list as readonly string[]).includes(v) ? v as T : null);

export function ownUrl(s: Partial<OwnAt> & { grade: number; subject: string; chapter: string }): string {
  const q = new URLSearchParams({ grade: String(s.grade), subject: s.subject, chapter: s.chapter });
  if (s.step && s.step !== 'pages') q.set('step', s.step);
  if (s.seg) q.set('seg', s.seg);
  if (s.size) q.set('size', s.size);
  const res = (s.res ?? []).filter((r) => r !== 'textbook');
  if (res.length) q.set('res', res.join(','));
  if (s.level) q.set('level', s.level);
  if (s.way) q.set('way', s.way);
  if (s.pg) q.set('pg', fmtPg(s.pg));
  return `${LESSONS_OWN}?${q.toString()}`;
}

export function readOwn(search: string): OwnAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  const chapter = q.get('chapter');
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || !subject || !chapter) return null;
  const pg = parsePg(q.get('pg'));
  const res = (q.get('res') ?? '').split(',').map((r) => pick(RESOURCES, r)).filter((r): r is Resource => !!r && r !== 'textbook');
  return {
    grade, subject, chapter,
    step: pick(OWN_STEPS, q.get('step')) ?? 'pages',
    seg: q.get('seg') || null,
    size: pick(SIZES, q.get('size')),
    res,
    level: pick(LEVELS, q.get('level')),
    way: pick(WAYS, q.get('way')),
    ...(pg ? { pg } : {}),
  };
}

export function nextStep(step: OwnStep): OwnStep | null {
  const i = OWN_STEPS.indexOf(step);
  return i < OWN_STEPS.length - 1 ? OWN_STEPS[i + 1] : null;
}

export function prevStep(step: OwnStep): OwnStep | null {
  const i = OWN_STEPS.indexOf(step);
  return i > 0 ? OWN_STEPS[i - 1] : null;
}

/** The body Make my plan sends (the bot checks it again). */
export function toAnswers(s: OwnAt, note: string) {
  return {
    size: s.size, resources: ['textbook', ...s.res] as Resource[], level: s.level, way: s.way, note: note.trim(),
    ...(s.pg ? { pages: s.pg } : {}),
  };
}
