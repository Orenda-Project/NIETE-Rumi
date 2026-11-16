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
/**
 * grades 6–12 (the bot's lp612-own-ways). `writing` (model, plan, write) for English and
 * Urdu; exam practice from Grade 8 (FDE centralised annual exam, Amena 10 Nov), board practice 9–12. No way is rote:
 * every way is how We do and You do are taught, never a replacement for a phase.
 */
export const SECONDARY_WAYS = ['worked', 'numericals', 'practical', 'inquiry', 'reading', 'writing', 'concept_map', 'discussion', 'past_paper', 'exam_fde'] as const;
export const WAYS = [...PRIMARY_WAYS, ...SECONDARY_WAYS] as const;
/** grades 1–5 guardrails (science of reading, numeracy): offered wherever they fit, never removed. */
export const GUARDRAIL_WAYS = ['phonics', 'cpa'] as const;
/** What a 6–12 lesson is for: teach new, revise, board / exam practice (Grade 8+), re-teach. */
export const PURPOSES = ['new', 'revise', 'board', 'reteach'] as const;
/** On a lesson whose FBISE SLOs are mixed: which come first. */
export const FOCI = ['summative', 'formative'] as const;

export type Size = (typeof SIZES)[number];
export type Resource = (typeof RESOURCES)[number];
export type Level = (typeof LEVELS)[number];
export type Way = (typeof WAYS)[number];
export type Purpose = (typeof PURPOSES)[number];
export type Focus = (typeof FOCI)[number];
export type GradeBand = 'primary' | 'middle' | 'senior';
type SecondaryWay = (typeof SECONDARY_WAYS)[number];

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
export type Why = Size | Level | 'math' | 'objects' | 'language' | 'early' | 'board' | 'numbers' | 'science' | 'reteach';

const isMath = (subject: string) => /^math/i.test(subject.trim());
const isLanguage = (subject: string) => /^(urdu|english)\b/i.test(subject.trim());
const isComputer = (subject: string) => /computer/i.test(subject);
const isPhysChem = (subject: string) => /physics|chemistry/i.test(subject);
const isScience = (subject: string) => !isComputer(subject) && /science|biology/i.test(subject);
const isHumanities = (subject: string) => /social|pak|history|geography|islami/i.test(subject);
const isEarly = (grade: number) => grade >= 1 && grade <= 3;
/** Grades 6–12 get their own ways and more say (bd-snkn32.13). */
export const isSecondary = (grade: number) => grade >= 6;
/** the band, from the grade once (as the bot's lp612-own-ways bandOf). */
export const bandOf = (grade: number): GradeBand => (grade <= 5 ? 'primary' : grade <= 8 ? 'middle' : 'senior');
/** Exam practice: Grade 8 (FDE centralised annual exam) and the board years 9–12. */
export const hasExam = (grade: number) => grade >= 8;

/** which 6–12 way fits which subject (the unified spec's table). */
const FITS: Record<SecondaryWay, (subject: string, grade: number) => boolean> = {
  worked: (s) => isMath(s) || isComputer(s),
  numericals: (s, g) => isPhysChem(s) || (g <= 8 && isScience(s) && !/biology/i.test(s)),
  practical: (s) => isPhysChem(s) || isScience(s) || isComputer(s),
  inquiry: (s) => !isLanguage(s),
  reading: (s) => isLanguage(s) || isHumanities(s),
  writing: (s) => isLanguage(s),
  concept_map: () => true,
  discussion: () => true,
  // The bot's codes (lp612-own-ways waysOfGrade): FBISE past papers 9–12, FDE exam practice at Grade 8 only.
  past_paper: (_s, g) => g >= 9,
  exam_fde: (_s, g) => g === 8,
};

/** a subject teacher's suggestion: from what the lesson is for, then the subject (always on her list). */
function suggestSecondary(a: OwnAnswers): { way: Way; why: Why[] } {
  const subject = a.subject.trim();
  const list = waysFor(a);
  const exam = list.find((w) => w === 'past_paper' || w === 'exam_fde');
  if (a.purpose === 'board' && exam) return { way: exam, why: ['board'] };
  // a re-teach or a class behind: the subject's most guided way, and the reason says why.
  const slow: Why[] = a.purpose === 'reteach' ? ['reteach'] : a.level === 'behind' || a.level === 'mixed' ? [a.level] : [];
  const pick = (way: Way, why: Why[]) => (list.includes(way) ? { way, why: [...slow, ...why] } : null);
  return (isLanguage(subject) && pick('reading', ['language']))
    || ((isMath(subject) || isComputer(subject)) && pick('worked', ['math']))
    || (isPhysChem(subject) && pick('numericals', ['numbers']))
    || (isScience(subject) && pick('practical', ['science']))
    || (isHumanities(subject) && pick('reading', []))
    || { way: 'discussion', why: slow };
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
 * The ways offered for this subject and grade, in WAYS order. Grades 1–5: the primary list, phonics for English and
 * Urdu and CPA for Maths in every grade 1–5 (guardrails). Grades 6–12: the band's ways that fit the subject (4–6 rows).
 */
export function waysFor({ grade, subject }: { grade: number; subject: string }): Way[] {
  if (isSecondary(grade)) return SECONDARY_WAYS.filter((w) => FITS[w](subject.trim(), grade));
  return PRIMARY_WAYS.filter((w) => (w === 'cpa' ? isMath(subject) : w === 'phonics' ? isLanguage(subject) : true));
}

/** What a lesson can be for in this grade, in order (none for grades 1–5; exam practice from Grade 8). */
export function purposesFor(grade: number): Purpose[] {
  if (!isSecondary(grade)) return [];
  return ['new', 'revise', 'reteach', ...(hasExam(grade) ? ['board' as const] : [])];
}

/** Every answer in: Make my plan can be offered. The textbook is always assumed, so no resource is required. */
export function isComplete(a: OwnAnswers): boolean {
  return !!a.segment && a.size != null && a.level != null && a.way != null && (!isSecondary(a.grade) || a.purpose != null);
}
