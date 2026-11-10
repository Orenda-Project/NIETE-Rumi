import { LESSONS_OWN } from '../paths';
import {
  FOCI, LEVELS, PURPOSES, RESOURCES, SIZES, WAYS, isSecondary, type Focus, type Level, type Purpose, type Resource, type Size, type Way,
} from './rules';
import { EXTENDS, type Extend } from './extend';
import { fmtPg, parsePg, type PageRange } from './pages';

/**
 * bd-snkn32 — where "Make my own" is, all in the address (the Lesson Plans rule, paths.ts: Back and a reload land where
 * she was). Pure. Codes only: anything off the lists is dropped. The textbook is always there, so it never rides in it.
 */

export { LESSONS_OWN };
/** Every step there is; stepsFor says which she walks. */
export const OWN_STEPS = ['pages', 'size', 'resources', 'level', 'purpose', 'way', 'focus', 'check'] as const;
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
  /** bd-snkn32.13 — grades 6–12: what the lesson is for, and (a mixed lesson) which SLOs first. */
  purpose: Purpose | null;
  focus: Focus | null;
  /** bd-snkn32.14 — add the next lesson's pages, and how (grades 6–12). */
  ext?: Extend | null;
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
  if (s.purpose) q.set('purpose', s.purpose);
  if (s.focus) q.set('focus', s.focus);
  if (s.ext) q.set('ext', s.ext);
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
    purpose: pick(PURPOSES, q.get('purpose')),
    focus: pick(FOCI, q.get('focus')),
    ...(pick(EXTENDS, q.get('ext')) ? { ext: pick(EXTENDS, q.get('ext')) } : {}),
    ...(pg ? { pg } : {}),
  };
}

/**
 * bd-snkn32.13 — the steps she walks: grades 6–12 add "what is this lesson for?", and "which outcomes first?" only when
 * the lesson's FBISE SLOs are mixed (Summative and Formative).
 */
export function stepsFor({ grade, mixed }: { grade: number; mixed: boolean }): OwnStep[] {
  return OWN_STEPS.filter((x) => (x === 'purpose' ? isSecondary(grade) : x === 'focus' ? isSecondary(grade) && mixed : true));
}

const PRIMARY_STEPS = stepsFor({ grade: 1, mixed: false });

export function nextStep(step: OwnStep, steps: readonly OwnStep[] = PRIMARY_STEPS): OwnStep | null {
  const i = steps.indexOf(step);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

export function prevStep(step: OwnStep, steps: readonly OwnStep[] = PRIMARY_STEPS): OwnStep | null {
  const i = steps.indexOf(step);
  return i > 0 ? steps[i - 1] : null;
}

/**
 * The body Make my plan sends (the bot checks it again). Purpose and focus ride only when answered (grades 6–12).
 * `next`: the lesson after hers, when she adds its pages (bd-snkn32.14).
 */
export function toAnswers(s: OwnAt, note: string, next: string | null = null) {
  return {
    size: s.size, resources: ['textbook', ...s.res] as Resource[], level: s.level, way: s.way, note: note.trim(),
    ...(s.purpose ? { purpose: s.purpose } : {}),
    ...(s.focus ? { focus: s.focus } : {}),
    ...(s.ext && next ? { extend: { next, shape: s.ext } } : {}),
    ...(s.pg ? { pages: s.pg } : {}),
  };
}
