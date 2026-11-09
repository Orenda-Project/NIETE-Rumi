/**
 * bd-snkn32 — "Make my own" lesson plan: her answers and the teaching way they suggest.
 *
 * Pure (no I/O, no React). The rules are the design's first draft (artifact KbsvCwJgs6QWy1DQmGjfzi, "How the teaching
 * way is suggested"), checked top to bottom; the first match is suggested, the others stay as choices filtered to the
 * subject. Subjects are matched by name because the grades 6–12 catalogue keys a subject by its display name.
 */

export const SIZES = ['up30', '31_50', '51_70', 'over70'] as const;
export const RESOURCES = ['textbook', 'board', 'charts', 'objects', 'audio'] as const;
export const LEVELS = ['behind', 'on_track', 'ahead', 'mixed'] as const;
export const WAYS = ['tarl', 'cpa', 'phonics', 'games', 'story'] as const;

export type Size = (typeof SIZES)[number];
export type Resource = (typeof RESOURCES)[number];
export type Level = (typeof LEVELS)[number];
export type Way = (typeof WAYS)[number];

export type OwnAnswers = {
  grade: number;
  subject: string;
  /** The chapter segment (its book pages) she picked. */
  segment: string;
  size: Size | null;
  resources: Resource[];
  level: Level | null;
  way: Way | null;
};

/** A reason shown under the suggestion ("Why: mixed class · 51–70 children"). */
export type Why = Size | Level | 'math' | 'objects' | 'language' | 'early';

const isMath = (subject: string) => /^math/i.test(subject.trim());
const isLanguage = (subject: string) => /^(urdu|english)\b/i.test(subject.trim());
const isEarly = (grade: number) => grade >= 1 && grade <= 3;

export function suggestWay(a: OwnAnswers): { way: Way; why: Why[] } {
  if (a.level === 'behind' || a.level === 'mixed') return { way: 'tarl', why: a.size ? [a.level, a.size] : [a.level] };
  if (isMath(a.subject) && a.resources.includes('objects')) return { way: 'cpa', why: ['math', 'objects'] };
  if (isLanguage(a.subject) && isEarly(a.grade)) return { way: 'phonics', why: ['language', 'early'] };
  if ((a.size === 'up30' || a.size === '31_50') && (a.level === 'on_track' || a.level === 'ahead')) {
    return { way: 'games', why: [a.size, a.level] };
  }
  return { way: 'story', why: [] };
}

/** The ways offered for this subject and grade, in WAYS order. */
export function waysFor({ grade, subject }: { grade: number; subject: string }): Way[] {
  return WAYS.filter((w) => (w === 'cpa' ? isMath(subject) : w === 'phonics' ? isLanguage(subject) && isEarly(grade) : true));
}

/** Every answer in: Make my plan can be offered. The textbook is always assumed, so no resource is required. */
export function isComplete(a: OwnAnswers): boolean {
  return !!a.segment && a.size != null && a.level != null && a.way != null;
}
