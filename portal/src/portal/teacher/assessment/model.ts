import { ASSESSMENT, type AssessmentV2Copy } from './copy';

/** English unless a screen passes its page's words (bd-fmf24g.13.1). */
const EN = ASSESSMENT.en;

/**
 * bd-fmf24g.6 — the teacher v2 New paper's choices and its rules, kept out of the screens so they can be
 * tested on their own. The rules are the WhatsApp Flow's (bot assessment-gen-endpoint.js +
 * question-types.js), which POST /api/internal/assessment/create now holds the portal to as well.
 *
 * She chooses the paper in parts, as the Flow counts it: how many seen questions (the book's own; no types,
 * the book's questions already are one), and a count for each unseen type she picked. The paper is what
 * they add up to, so nothing she types has to match a number typed somewhere else:
 *
 *   seen only      contentSource "seen", no types
 *   unseen only    contentSource "unseen", the types add up to the paper
 *   both           contentSource "both" with the seen count; the types add up to the rest
 *
 * Nothing here holds a cap or a list the bot owns: the question cap and the type list come from
 * GET /assessment/options; the marks ceiling is the bot's MAX_TOTAL_MARKS (1000), checked again server-side.
 */

export type Source = 'seen' | 'unseen' | 'both';
export type Step = 'class' | 'cover' | 'topics' | 'questions' | 'check';

export const STEPS: readonly Step[] = ['class', 'cover', 'questions', 'check'];

/** One chapter with topics: Topics comes after Chapters (topics.ts `topicsApply`). Today's four steps otherwise. */
export const TOPIC_STEPS: readonly Step[] = ['class', 'cover', 'topics', 'questions', 'check'];

/** The Flow's MAX_TYPE_SLOTS (question-types.js): the most unseen types one paper takes. */
export const MAX_TYPES = 8;

/**
 * The FDE board pattern's New paper: Class, then Check (scope and style are trays on Check). Only when
 * /assessment/options offers the pattern for the grade and subject (`eligible`) and the pattern is picked.
 */
export const FDE_STEPS: readonly Step[] = ['class', 'check'];

export function stepsFor(p: Pick<Picks, 'style'>, eligible: boolean): readonly Step[] {
  return eligible && p.style === 'fde' ? FDE_STEPS : STEPS;
}

/**
 * Edit on a board-pattern paper (the paper page and Versions). Off until the server's editor for those papers is live:
 * the server refuses to edit one until then (PATTERN_NO_EDIT), and the editor reached by a link says so in the deck's words.
 */
export const FDE_EDITING = false;

/** The bot's MAX_TOTAL_MARKS (question-types.js). The server refuses past it either way. */
export const MAX_TOTAL_MARKS = 1000;

export type Picks = {
  grade: number | null;
  /** The assessment catalogue's subject key ("science"), what /assessment/* wants back. */
  subject: string | null;
  /** Its name, as the API gave it, for the screens. */
  subjectName: string | null;
  /** 'fde' = the FDE syllabus of the board pattern, which the server resolves to pages. */
  coverBy: 'chapters' | 'pages' | 'fde';
  /** Chapter numbers, in the order she ticked them (sent sorted). */
  chapters: number[];
  /** Page ranges [from, to], inclusive. */
  ranges: Array<[number, number]>;
  /** How many seen questions (the book's own); 0 = none. */
  seen: number;
  /** The unseen types on the page, type id → how many, in the order she added them. A 0 is a row she emptied. */
  typeCounts: Record<string, number>;
  /** The first visit to Questions for this class has filled in the default mix (a class change clears it). */
  typesSeeded: boolean;
  /** null = no limit. */
  marks: number | null;
  answerLines: boolean;
  /** The FDE door (or the side-door card) asked for a board-pattern paper: the pattern id, kept across Class. */
  patternIntent?: string | null;
  /** 'fde' = the board pattern; 'own' = the teacher's own paper after picking it; null = a plain New paper. */
  style?: 'fde' | 'own' | null;
  /** The board pattern the request carries (only with style 'fde'). */
  pattern?: string | null;
  /** The Topics step: 'chapter' = the whole chapter, 'topics' = the ones she ticks, null = not asked (skipped). */
  topicScope?: 'chapter' | 'topics' | null;
  /** The ticked topic ids in book order; null = every topic (the whole chapter), [] = none ticked yet. */
  topicIds?: string[] | null;
};

export function newPicks(defaultCount: number): Picks {
  return {
    grade: null, subject: null, subjectName: null,
    coverBy: 'chapters', chapters: [], ranges: [],
    seen: Math.min(5, Math.max(0, defaultCount - 1)), typeCounts: {}, typesSeeded: false,
    marks: null, answerLines: true,
    patternIntent: null, style: null, pattern: null,
    topicScope: null, topicIds: null,
  };
}

/** The board pattern is picked: the request carries it. */
export const isFde = (p: Pick<Picks, 'style' | 'pattern'>): boolean => p.style === 'fde' && !!p.pattern;

/** "1-12" / "218-226, 239-244" per unit → page ranges for the units kept (Maths customises by pages). */
export function fdeUnitRanges(unitRanges: Array<{ chapter: number; ranges: string }>, units: number[]): Array<[number, number]> {
  return unitRanges
    .filter((u) => units.includes(u.chapter))
    .flatMap((u) => u.ranges.split(',').map((r) => r.trim().match(/^(\d+)\s*-\s*(\d+)$/)).filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [Number(m[1]), Number(m[2])] as [number, number]));
}

/** The unseen types with a count, in her order (a row she emptied to 0 is not on the paper). */
export function chosenTypes(p: Pick<Picks, 'typeCounts'>): Array<[string, number]> {
  return Object.entries(p.typeCounts).filter(([, n]) => n > 0);
}

/** How many unseen questions: her types added up. */
export function unseenTotal(p: Pick<Picks, 'typeCounts'>): number {
  return chosenTypes(p).reduce((s, [, n]) => s + n, 0);
}

/** How many questions on the paper: the seen ones and the unseen ones. */
export function questionTotal(p: Pick<Picks, 'seen' | 'typeCounts'>): number {
  return Math.max(0, p.seen) + unseenTotal(p);
}

/** Where the paper's questions come from, as the bot names it. */
export function sourceOf(p: Pick<Picks, 'seen' | 'typeCounts'>): Source {
  const unseen = unseenTotal(p);
  if (p.seen > 0 && unseen > 0) return 'both';
  return p.seen > 0 ? 'seen' : 'unseen';
}

/** The kinds a first visit starts with, in this order: the objective ones a teacher marks fastest (the bot's DEFAULT_MIX). */
const DEFAULT_KINDS = ['MCQs', 'True/False', 'Fill in the Blanks'];

/**
 * A first visit's unseen types: `unseen` questions over the default kinds this subject offers, the remainder to the
 * earlier ones (as the bot spreads a count), each at least 1. A subject offering none of them starts with its first type.
 */
export function defaultTypeCounts(offered: Array<{ id: string; category: 'objective' | 'subjective' }>, unseen: number): Record<string, number> {
  if (unseen <= 0 || offered.length === 0) return {};
  const ids = offered.map((t) => t.id);
  const kinds = DEFAULT_KINDS.filter((k) => ids.includes(k));
  const use = (kinds.length ? kinds : [ids[0]]).slice(0, unseen);
  const base = Math.floor(unseen / use.length);
  const spare = unseen - base * use.length;
  return Object.fromEntries(use.map((id, i) => [id, base + (i < spare ? 1 : 0)]));
}

/** "4-14, 30-33" — page_ranges as the bot reads it. */
export function rangesText(ranges: Array<[number, number]>): string {
  return ranges.map(([a, b]) => `${a}-${b}`).join(', ');
}

const intIn = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

/** What is wrong with the step: ONE reason, as data (whyText in copy.ts words it, en and ur). null = she may go on. */
export type Why =
  | { code: 'class' }
  | { code: 'chapters' }
  | { code: 'ranges' }
  | { code: 'none' }
  | { code: 'count'; max: number }
  | { code: 'typesMax'; max: number }
  | { code: 'marks'; max: number }
  | { code: 'marksLow'; total: number }
  | { code: 'earlier'; step: Step }
  | { code: 'generating' }
  | { code: 'scopeOrFde' }
  | { code: 'topics' };

/**
 * Why she may not go on from this step, or null when she may. `max` is GET /assessment/options' maxQuestions.
 * The limits are the server's: the paper 1..max questions, up to MAX_TYPES unseen types, marks 1..MAX_TOTAL_MARKS;
 * and a marks total under the question count is held here, because the generator drops whole questions to fit a
 * budget it cannot meet. Every disabled Next / Make my paper says this beside it (ButtonWithReason).
 */
export function stepWhy(step: Step, p: Picks, max: number, opts: { busy?: boolean; offerFde?: boolean } = {}): Why | null {
  if (isFde(p)) {
    // The board pattern: the class, and the FDE syllabus or at least one of its units; the rest the pattern fixes.
    if (step === 'class' || step === 'check') {
      if (p.grade === null || !p.subject) return step === 'class' ? { code: 'class' } : { code: 'earlier', step: 'class' };
      if (step === 'class') return null;
      if (opts.busy) return { code: 'generating' };
      if (p.coverBy === 'fde') return null;
      return (p.coverBy === 'chapters' ? p.chapters.length : p.ranges.length) > 0 ? null : { code: 'chapters' };
    }
    if (step === 'cover') return null;
  }
  switch (step) {
    case 'class':
      return p.grade !== null && !!p.subject ? null : { code: 'class' };
    case 'cover':
      if (p.coverBy === 'chapters') return p.chapters.length > 0 ? null : { code: opts.offerFde ? 'scopeOrFde' : 'chapters' };
      return p.ranges.length > 0 ? null : { code: 'ranges' };
    case 'topics':
      return p.topicScope === 'topics' && Array.isArray(p.topicIds) && p.topicIds.length === 0 ? { code: 'topics' } : null;
    case 'questions': {
      const total = questionTotal(p);
      if (total === 0) return { code: 'none' };
      if (total > max) return { code: 'count', max };
      if (Object.keys(p.typeCounts).length > MAX_TYPES) return { code: 'typesMax', max: MAX_TYPES };
      if (p.marks !== null) {
        if (!intIn(p.marks, 1, MAX_TOTAL_MARKS)) return { code: 'marks', max: MAX_TOTAL_MARKS };
        if (p.marks < total) return { code: 'marksLow', total };
      }
      return null;
    }
    case 'check': {
      const first = TOPIC_STEPS.slice(0, -1).find((s) => stepWhy(s, p, max) !== null);
      return first ? { code: 'earlier', step: first } : null;
    }
    default:
      return null;
  }
}

/** May she go on from this step? */
export function stepReady(step: Step, p: Picks, max: number): boolean {
  return stepWhy(step, p, max) === null;
}

export { digitsOnly } from '../ui/digits';

/** The From and To boxes of a page range, against the book: pages 1..last, From before To (the Flow's PAGES rules). */
export type PageCheck =
  | { ok: true; from: number; to: number }
  | { ok: false; why: 'empty' }
  | { ok: false; why: 'zero' }
  | { ok: false; why: 'beyond'; last: number }
  | { ok: false; why: 'order'; from: number; to: number };

/** `last` is the book's last page when the chapters give one; null = no upper limit is known, so none is held. */
export function checkPages(from: string, to: string, last: number | null): PageCheck {
  if (from === '' || to === '') return { ok: false, why: 'empty' };
  const a = Number(from);
  const b = Number(to);
  if (a < 1 || b < 1) return { ok: false, why: 'zero' };
  if (last !== null && Math.max(a, b) > last) return { ok: false, why: 'beyond', last };
  if (a > b) return { ok: false, why: 'order', from: a, to: b };
  return { ok: true, from: a, to: b };
}

/** The body for POST /api/portal/assessment/generate (the bot's create route reads every field). */
export type V2Spec = {
  grade: number;
  subject: string;
  chapterNumbers: number[] | null;
  pageRanges: string | null;
  questionCount: number;
  contentSource: Source;
  seenCount: number | null;
  questionTypes: Array<{ id: string; count: number }>;
  totalMarks: number | null;
  answerLines: boolean;
  outputFormat: 'pdf';
  /** A topic paper: the ticked topics of its one chapter. Absent = the whole chapter (today's request). */
  topicIds?: string[];
};

/** The board pattern's request: the pattern, and the FDE syllabus (`scope`) or the chosen chapters / pages; the pattern fixes
 *  the count, the types and the marks (the server refuses a marks budget), so `totalMarks` is not sent at all. */
export type FdeSpec = {
  grade: number;
  subject: string;
  pattern: string;
  scope?: 'fde';
  chapterNumbers?: number[];
  pageRanges?: string;
  questionCount: 0;
  contentSource: 'unseen';
  seenCount: null;
  questionTypes: [];
  answerLines: true;
  outputFormat: 'pdf';
};

export function toSpec(p: Picks): V2Spec | FdeSpec {
  if (isFde(p)) {
    return {
      grade: p.grade as number,
      subject: p.subject as string,
      pattern: p.pattern as string,
      ...(p.coverBy === 'fde' ? { scope: 'fde' as const }
        : p.coverBy === 'chapters' ? { chapterNumbers: [...p.chapters].sort((a, b) => a - b) }
          : { pageRanges: rangesText(p.ranges) }),
      questionCount: 0,
      contentSource: 'unseen',
      seenCount: null,
      questionTypes: [],
      answerLines: true,
      outputFormat: 'pdf',
    };
  }
  const byChapters = p.coverBy === 'chapters';
  const source = sourceOf(p);
  return {
    grade: p.grade as number,
    subject: p.subject as string,
    chapterNumbers: byChapters ? [...p.chapters].sort((a, b) => a - b) : null,
    pageRanges: byChapters ? null : rangesText(p.ranges),
    questionCount: questionTotal(p),
    contentSource: source,
    seenCount: source === 'both' ? p.seen : null,
    // A seen-only paper sends none: the server holds any types it is sent to the paper's whole count.
    questionTypes: source === 'seen' ? [] : chosenTypes(p).map(([id, count]) => ({ id, count })),
    totalMarks: p.marks,
    answerLines: p.answerLines,
    // Word stays off: its flag (assessment_docx_enabled) is false in production.
    outputFormat: 'pdf',
    ...(byChapters && p.chapters.length === 1 && p.topicScope === 'topics' && p.topicIds?.length ? { topicIds: [...p.topicIds] } : {}),
  };
}

/** A request as a job stored it — this page's V2Spec, or today's page's older AssessmentSpec. */
export type AnySpec = {
  grade: number;
  subject: string;
  chapterNumber?: number | null;
  chapterNumbers?: number[] | null;
  pageRanges?: string | null;
  questionCount: number;
  contentSource?: Source;
  seenCount?: number | null;
  questionTypes?: Array<string | { id: string; count: number }>;
  totalMarks?: number | null;
  answerLines?: boolean;
  pattern?: string | null;
  scope?: 'fde' | null;
  topicIds?: string[] | null;
};

/** A board-pattern request (it carries `pattern`), whatever shape the job stored it in. */
export function isPatternSpec(spec: unknown): boolean {
  return !!spec && typeof spec === 'object' && !!(spec as { pattern?: string | null }).pattern;
}

/**
 * How many questions a request's paper has: a board-pattern request is sent with questionCount 0 (the pattern fixes it),
 * so it counts the pattern's own total when known, else nothing (never "0 questions").
 */
export function questionsOf(spec: unknown, patternTotal: number | null): number | null {
  if (isPatternSpec(spec)) return patternTotal;
  const n = spec && typeof spec === 'object' ? (spec as { questionCount?: number | null }).questionCount : null;
  return typeof n === 'number' ? n : null;
}

/** Her choices back from a request she sent (Change choices on a paper that failed). */
export function fromSpec(spec: AnySpec, subjectName: string | null): Picks {
  const chapters = spec.chapterNumbers?.length ? [...spec.chapterNumbers]
    : (spec.chapterNumber != null ? [spec.chapterNumber] : []);
  const ranges = chapters.length ? [] : String(spec.pageRanges ?? '')
    .split(',')
    .map((part) => part.trim().match(/^(\d+)\s*-\s*(\d+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  const counted = (spec.questionTypes ?? []).filter((t): t is { id: string; count: number } => typeof t === 'object' && !!t);
  const source: Source = spec.contentSource ?? 'unseen';
  const pattern = spec.pattern ?? null;
  // An older request with no per-type counts (the auto mix) comes back without types: Questions fills in the default mix.
  const typed = source !== 'seen' && counted.length > 0;
  return {
    ...newPicks(spec.questionCount),
    grade: spec.grade,
    subject: spec.subject,
    subjectName,
    coverBy: chapters.length || !ranges.length ? 'chapters' : 'pages',
    chapters,
    ranges,
    seen: source === 'both' ? (spec.seenCount ?? 0) : source === 'seen' ? spec.questionCount : 0,
    typeCounts: typed ? Object.fromEntries(counted.map((t) => [t.id, t.count])) : {},
    typesSeeded: typed || source === 'seen',
    marks: spec.totalMarks ?? null,
    answerLines: spec.answerLines !== false,
    ...(spec.topicIds?.length ? { topicScope: 'topics' as const, topicIds: [...spec.topicIds] } : {}),
    ...(pattern ? {
      style: 'fde' as const, pattern, patternIntent: pattern,
      ...(spec.scope === 'fde' ? { coverBy: 'fde' as const } : {}),
      seen: newPicks(15).seen, typeCounts: {}, typesSeeded: false,
    } : {}),
  };
}

/** The job's label in Being made: "Grade 4 · Science · 15 questions". */
export function paperLabel(p: Picks, C: AssessmentV2Copy = EN): string {
  return C.join(p.grade !== null ? C.grade(p.grade) : null, p.subjectName ?? p.subject, C.questionsCount(questionTotal(p)));
}

/* ── days (Pakistan, UTC+5 all year) ─────────────────────────────────────── */

const PK_MS = 5 * 3_600_000;

export function pkToday(now: number = Date.now()): string {
  return new Date(now + PK_MS).toISOString().slice(0, 10);
}

/** The Pakistan day an ISO instant falls on, or null. */
export function pkDay(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? pkToday(t) : null;
}

const parse = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** Today · Yesterday · "Mon 5 Oct". */
export function dayLabel(ymd: string, today: string, D: AssessmentV2Copy['days'] = EN.days): string {
  const gap = Math.round((parse(today).getTime() - parse(ymd).getTime()) / 86_400_000);
  if (gap === 0) return D.today;
  if (gap === 1) return D.yesterday;
  const d = parse(ymd);
  return D.date(d.getUTCDay(), d.getUTCDate(), d.getUTCMonth());
}

/** Papers grouped by the Pakistan day they were ready, newest day first, each day in its given order. */
export function groupPapersByDay<T extends { ready_at: string | null }>(
  papers: T[], today: string, D: AssessmentV2Copy['days'] = EN.days,
): Array<{ key: string; day: string; items: T[] }> {
  const out: Array<{ key: string; day: string; items: T[] }> = [];
  for (const paper of papers) {
    const key = pkDay(paper.ready_at);
    if (!key) continue;
    let group = out.find((g) => g.key === key);
    if (!group) { group = { key, day: dayLabel(key, today, D), items: [] }; out.push(group); }
    group.items.push(paper);
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}
