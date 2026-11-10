import { LESSONS_OWN } from '../paths';
import { LEVELS, RESOURCES, SIZES, WAYS, type Level, type Resource, type Size, type Way } from './rules';
import { EXTENDS, type Extend } from './extend';

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
  /** bd-snkn32.14 — add the next lesson's pages, and how (grades 6–12). */
  ext?: Extend | null;
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
  if (s.ext) q.set('ext', s.ext);
  return `${LESSONS_OWN}?${q.toString()}`;
}

export function readOwn(search: string): OwnAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  const chapter = q.get('chapter');
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || !subject || !chapter) return null;
  const res = (q.get('res') ?? '').split(',').map((r) => pick(RESOURCES, r)).filter((r): r is Resource => !!r && r !== 'textbook');
  return {
    grade, subject, chapter,
    step: pick(OWN_STEPS, q.get('step')) ?? 'pages',
    seg: q.get('seg') || null,
    size: pick(SIZES, q.get('size')),
    res,
    level: pick(LEVELS, q.get('level')),
    way: pick(WAYS, q.get('way')),
    ...(pick(EXTENDS, q.get('ext')) ? { ext: pick(EXTENDS, q.get('ext')) } : {}),
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

/** The body Make my plan sends (the bot checks it again). `next`: the lesson after hers, when she adds its pages. */
export function toAnswers(s: OwnAt, note: string, next: string | null = null) {
  return {
    size: s.size, resources: ['textbook', ...s.res] as Resource[], level: s.level, way: s.way, note: note.trim(),
    ...(s.ext && next ? { extend: { next, shape: s.ext } } : {}),
  };
}
