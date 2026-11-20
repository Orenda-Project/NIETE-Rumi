import { LESSONS_NEW, LESSONS_OWN } from '../paths';
import {
  FOCI, LEVELS, RESOURCES, SIZES, isSecondary, purposesFor, waysFor, type Focus, type Level, type Purpose, type Resource, type Size, type Way,
} from './rules';
import { EXTENDS, type Extend } from './extend';
import { fmtPg, parsePg, type PageRange } from './pages';

/**
 * bd-snkn32 — where "Make my own" is, all in the address (the Lesson Plans rule, paths.ts: Back and a reload land where
 * she was). Pure. Codes only: anything off the lists is dropped. The textbook is always there, so it never rides in it.
 */

export { LESSONS_OWN };
/** bd-snkn32.25 — `pick=own`: grade and subject, then a chapter, lead straight into these steps (from the main page). */
export const OWN_PICK = 'own';
export const OWN_START = `${LESSONS_NEW}?pick=${OWN_PICK}`;
/**
 * bd-snkn32.58.1 (queue #155 A) — with the goal switch on, OWN_START is two equal choices: from a textbook chapter
 * (OWN_BOOK: today's class → chapter → steps) or from a learning goal (OWN_GOAL: class → the goal step, no chapter).
 */
export const OWN_BOOK = `${OWN_START}&start=book`;
export const OWN_GOAL = `${OWN_START}&start=goal`;
/** Every step there is, in the one order every grade walks ; stepsFor says which she walks. */
export const OWN_STEPS = ['pages', 'goal', 'purpose', 'focus', 'size', 'level', 'resources', 'way', 'check'] as const;
export type OwnStep = (typeof OWN_STEPS)[number];

/** bd-snkn32.56 — "Start from a learning goal or topic" (every grade, bd-snkn32.57): what she picked, or null kind before she picks. */
export const GOAL_KINDS = ['outcome', 'topic'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export type GoalPick = { kind: GoalKind | null; text: string };
export const GOAL_TEXT_MAX = 120;
/** bd-m8zwt1.3 — a picked official outcome (up to 371 characters) is never cut; only a typed topic is held to 120. */
export const OUTCOME_TEXT_MAX = 400;
const goalMax = (kind: GoalKind | null) => (kind === 'outcome' ? OUTCOME_TEXT_MAX : GOAL_TEXT_MAX);

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
  /** bd-snkn32.24 — every way she ticked, in order, only when more than one (`way` is the first). */
  ways?: Way[];
  /** bd-snkn32.13 — grades 6–12: what the lesson is for, and (a mixed lesson) which SLOs first. */
  purpose: Purpose | null;
  focus: Focus | null;
  /** bd-snkn32.14 — add the next lesson's pages, and how (grades 6–12). */
  ext?: Extend | null;
  /** bd-snkn32.17 — grades 1–5: the book pages she chose, when not the day's own. */
  pg?: PageRange;
  /** bd-snkn32.56 — present only on a goal start (no textbook in class); `seg` is then the closest lesson under it. */
  goal?: GoalPick;
};

const pick = <T extends string>(list: readonly T[], v: string | null): T | null => (v && (list as readonly string[]).includes(v) ? v as T : null);

export function ownUrl(s: Partial<OwnAt> & { grade: number; subject: string; chapter?: string }): string {
  const q = new URLSearchParams({ grade: String(s.grade), subject: s.subject });
  if (s.chapter) q.set('chapter', s.chapter); // a goal start (bd-snkn32.58.1) has none
  if (s.step && s.step !== 'pages') q.set('step', s.step);
  if (s.seg) q.set('seg', s.seg);
  if (s.size) q.set('size', s.size);
  const res = (s.res ?? []).filter((r) => r !== 'textbook');
  if (res.length) q.set('res', res.join(','));
  if (s.level) q.set('level', s.level);
  const ways = s.ways?.length ? s.ways : s.way ? [s.way] : [];
  if (ways.length) q.set('way', ways.join(','));
  if (s.purpose) q.set('purpose', s.purpose);
  if (s.focus) q.set('focus', s.focus);
  if (s.ext) q.set('ext', s.ext);
  if (s.pg && !s.goal) q.set('pg', fmtPg(s.pg));
  if (s.goal) {
    q.set('start', 'goal');
    if (s.goal.kind) q.set('gk', s.goal.kind);
    if (s.goal.text) q.set('gt', s.goal.text.slice(0, goalMax(s.goal.kind)));
  }
  return `${LESSONS_OWN}?${q.toString()}`;
}

export function readOwn(search: string): OwnAt | null {
  const q = new URLSearchParams(search);
  const grade = Number(q.get('grade'));
  const subject = q.get('subject');
  // bd-snkn32.58.1 — a goal start needs no chapter (her class, then her goal); every other own address does.
  const chapter = q.get('chapter') ?? '';
  if (!Number.isInteger(grade) || grade < 1 || grade > 12 || !subject || (!chapter && q.get('start') !== 'goal')) return null;
  const pg = parsePg(q.get('pg'));
  const res = (q.get('res') ?? '').split(',').map((r) => pick(RESOURCES, r)).filter((r): r is Resource => !!r && r !== 'textbook');
  // the band decides what survives: a way off her list, exam practice below Grade 8, the outcomes focus
  // below 9 or on exam practice, and adding the next lesson at 1–5 are all dropped (codes only, never trusted).
  const purpose = pick(purposesFor(grade), q.get('purpose'));
  const allowed = waysFor({ grade, subject });
  const ways = [...new Set((q.get('way') ?? '').split(',').map((x) => pick(allowed, x)).filter((x): x is Way => !!x))];
  const way = ways[0] ?? null;
  const focus = grade >= 9 && purpose !== 'board' ? pick(FOCI, q.get('focus')) : null;
  // bd-snkn32.57 — every grade (1–5 since 19 Nov: "we are an FLN company first").
  const goal: GoalPick | null = q.get('start') === 'goal'
    ? ((kind) => ({ kind, text: (q.get('gt') ?? '').trim().slice(0, goalMax(kind)) }))(pick(GOAL_KINDS, q.get('gk'))) : null;
  const ext = isSecondary(grade) && !goal ? pick(EXTENDS, q.get('ext')) : null;
  return {
    grade, subject, chapter,
    step: pick(OWN_STEPS, q.get('step')) ?? 'pages',
    seg: q.get('seg') || null,
    size: pick(SIZES, q.get('size')),
    res,
    level: pick(LEVELS, q.get('level')),
    way,
    ...(ways.length > 1 ? { ways } : {}),
    purpose,
    focus,
    ...(ext ? { ext } : {}),
    ...(pg && !goal ? { pg } : {}),
    ...(goal ? { goal } : {}),
  };
}

/**
 * /.19 — the steps she walks: every grade asks "what is this lesson for?" right after the pages or the goal (grades
 * 1–5 since bd-snkn32.63), and
 * "which outcomes first?" only at 9–12 when the lesson's FBISE SLOs are mixed and it is not exam practice.
 */
export function stepsFor({ grade, mixed, purpose = null, goal = false }: { grade: number; mixed: boolean; purpose?: Purpose | null; goal?: boolean }): OwnStep[] {
  // bd-snkn32.56 — a goal start: the goal screen stands where the book pages were; no "which outcomes first".
  // Grades 1–5 (bd-snkn32.57) walk it too.
  if (goal) return OWN_STEPS.filter((x) => x !== 'pages' && x !== 'focus');
  const focus = grade >= 9 && mixed && purpose !== 'board';
  return OWN_STEPS.filter((x) => (x === 'goal' ? false : x === 'focus' ? focus : true));
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
 * The body Make my plan sends (the bot checks it again). Purpose and focus ride only when answered (focus: 9–12).
 * `next`: the lesson after hers, when she adds its pages (bd-snkn32.14).
 */
export function toAnswers(s: OwnAt, note: string, next: string | null = null) {
  // bd-snkn32.56 — a goal start: her goal, no textbook, no book pages, no next lesson.
  const goal = s.goal && s.goal.kind && s.goal.text ? { kind: s.goal.kind, text: s.goal.text } : null;
  if (goal) {
    return {
      size: s.size, resources: [...s.res] as Resource[], level: s.level, way: s.way, note: note.trim(), goal,
      ...(s.ways && s.ways.length > 1 ? { ways: s.ways } : {}),
      ...(s.purpose ? { purpose: s.purpose } : {}),
    };
  }
  return {
    size: s.size, resources: ['textbook', ...s.res] as Resource[], level: s.level, way: s.way, note: note.trim(),
    ...(s.ways && s.ways.length > 1 ? { ways: s.ways } : {}),
    ...(s.purpose ? { purpose: s.purpose } : {}),
    ...(s.focus ? { focus: s.focus } : {}),
    ...(s.ext && next ? { extend: { next, shape: s.ext } } : {}),
    ...(s.pg ? { pages: s.pg } : {}),
  };
}
