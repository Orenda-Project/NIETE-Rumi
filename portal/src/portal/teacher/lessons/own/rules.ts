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
export const PRIMARY_WAYS = ['tarl', 'cpa', 'phonics', 'games', 'story'] as const;
/** bd-snkn32.13 — grades 6–12 (the bot's lp612-own-ways): past-paper practice is 9–12 only, there is no board below. */
export const SECONDARY_WAYS = ['worked', 'numericals', 'practical', 'inquiry', 'concept_map', 'discussion', 'reading', 'past_paper'] as const;
export const WAYS = [...PRIMARY_WAYS, ...SECONDARY_WAYS] as const;
/** What a 6–12 lesson is for: teach new, revise, board exam practice (9–12), re-teach. */
export const PURPOSES = ['new', 'revise', 'board', 'reteach'] as const;
/** On a lesson whose FBISE SLOs are mixed: which come first. */
export const FOCI = ['summative', 'formative'] as const;

export type Size = (typeof SIZES)[number];
export type Resource = (typeof RESOURCES)[number];
export type Level = (typeof LEVELS)[number];
export type Way = (typeof WAYS)[number];
export type Purpose = (typeof PURPOSES)[number];
export type Focus = (typeof FOCI)[number];

export type OwnAnswers = {
  grade: number;
  subject: string;
  /** The chapter segment (its book pages) she picked. */
  segment: string;
  size: Size | null;
  resources: Resource[];
  level: Level | null;
  way: Way | null;
  /** Grades 6–12 only. */
  purpose?: Purpose | null;
};

/** A reason shown under the suggestion ("Why: mixed class · 51–70 children"). */
export type Why = Size | Level | 'math' | 'objects' | 'language' | 'early' | 'board' | 'numbers' | 'science';

const isMath = (subject: string) => /^math/i.test(subject.trim());
const isLanguage = (subject: string) => /^(urdu|english)\b/i.test(subject.trim());
const isEarly = (grade: number) => grade >= 1 && grade <= 3;
/** Grades 6–12 get their own ways and more say (bd-snkn32.13). */
export const isSecondary = (grade: number) => grade >= 6;

/** bd-snkn32.13 — a subject teacher's suggestion: from what the lesson is for, then the subject. */
function suggestSecondary(a: OwnAnswers): { way: Way; why: Why[] } {
  const subject = a.subject.trim();
  if (a.purpose === 'board' && a.grade >= 9) return { way: 'past_paper', why: ['board'] };
  if (isLanguage(subject)) return { way: 'reading', why: ['language'] };
  if (isMath(subject) || /computer/i.test(subject)) return { way: 'worked', why: ['math'] };
  if (/physics|chemistry/i.test(subject)) return { way: 'numericals', why: ['numbers'] };
  if (/biology|science/i.test(subject)) return { way: 'practical', why: ['science'] };
  return { way: 'discussion', why: [] };
}

export function suggestWay(a: OwnAnswers): { way: Way; why: Why[] } {
  if (isSecondary(a.grade)) return suggestSecondary(a);
  if (a.level === 'behind' || a.level === 'mixed') return { way: 'tarl', why: a.size ? [a.level, a.size] : [a.level] };
  if (isMath(a.subject) && a.resources.includes('objects')) return { way: 'cpa', why: ['math', 'objects'] };
  if (isLanguage(a.subject) && isEarly(a.grade)) return { way: 'phonics', why: ['language', 'early'] };
  if ((a.size === 'up30' || a.size === '31_50') && (a.level === 'on_track' || a.level === 'ahead')) {
    return { way: 'games', why: [a.size, a.level] };
  }
  return { way: 'story', why: [] };
}

/**
 * The ways offered for this subject and grade, in WAYS order. Grades 6–12: the whole band set, whatever the subject
 * (more say than primary; the suggestion comes first).
 */
export function waysFor({ grade, subject }: { grade: number; subject: string }): Way[] {
  if (isSecondary(grade)) return SECONDARY_WAYS.filter((w) => w !== 'past_paper' || grade >= 9);
  return PRIMARY_WAYS.filter((w) => (w === 'cpa' ? isMath(subject) : w === 'phonics' ? isLanguage(subject) && isEarly(grade) : true));
}

/** What a lesson can be for in this grade, in order (none for grades 1–5). */
export function purposesFor(grade: number): Purpose[] {
  if (!isSecondary(grade)) return [];
  return PURPOSES.filter((p) => p !== 'board' || grade >= 9);
}

/** Every answer in: Make my plan can be offered. The textbook is always assumed, so no resource is required. */
export function isComplete(a: OwnAnswers): boolean {
  return !!a.segment && a.size != null && a.level != null && a.way != null && (!isSecondary(a.grade) || a.purpose != null);
}
