import { ASSESSMENT, type AssessmentV2Copy } from './copy';

/** English unless a screen passes its page's words (bd-fmf24g.13.1). */
const EN = ASSESSMENT.en;

/**
 * bd-fmf24g.6 — the teacher v2 New paper's choices and its rules, kept out of the screens so they can be
 * tested on their own. The rules are the WhatsApp Flow's (bot assessment-gen-endpoint.js +
 * question-types.js), which POST /api/internal/assessment/create now holds the portal to as well:
 *
 *   Book (seen)    the book's own questions: no types to pick, no book count
 *   New (unseen)   new questions on the same topics: the per-type counts add up to the paper's count
 *   Mix (both)     a book count that leaves room for at least one new question; the per-type counts
 *                  add up to the rest
 *
 * Nothing here holds a cap or a list the bot owns: the question cap and the type list come from
 * GET /assessment/options; the marks ceiling is the bot's MAX_TOTAL_MARKS (1000), checked again server-side.
 */

export type Source = 'seen' | 'unseen' | 'both';
export type Step = 'class' | 'cover' | 'questions' | 'types' | 'extras' | 'check';

export const STEPS: readonly Step[] = ['class', 'cover', 'questions', 'types', 'extras', 'check'];

/** The bot's MAX_TOTAL_MARKS (question-types.js). The server refuses past it either way. */
export const MAX_TOTAL_MARKS = 1000;

export type Picks = {
  grade: number | null;
  /** The assessment catalogue's subject key ("science"), what /assessment/* wants back. */
  subject: string | null;
  /** Its name, as the API gave it, for the screens. */
  subjectName: string | null;
  coverBy: 'chapters' | 'pages';
  /** Chapter numbers, in the order she ticked them (sent sorted). */
  chapters: number[];
  /** Page ranges [from, to], inclusive. */
  ranges: Array<[number, number]>;
  count: number;
  source: Source;
  /** Mix only: how many from the book. */
  seen: number;
  typeMode: 'auto' | 'pick';
  /** Type id → how many, in the order she ticked them. */
  typeCounts: Record<string, number>;
  /** null = no limit. */
  marks: number | null;
  answerLines: boolean;
};

export function newPicks(defaultCount: number): Picks {
  return {
    grade: null, subject: null, subjectName: null,
    coverBy: 'chapters', chapters: [], ranges: [],
    count: defaultCount, source: 'unseen', seen: Math.min(5, Math.max(1, defaultCount - 1)),
    typeMode: 'auto', typeCounts: {},
    marks: null, answerLines: true,
  };
}

/** How many questions the types are for: none on a book paper, the rest after the book on Mix. */
export function unseenTarget(p: Picks): number {
  if (p.source === 'seen') return 0;
  if (p.source === 'both') return p.count - p.seen;
  return p.count;
}

export function typesTotal(p: Picks): number {
  return Object.values(p.typeCounts).reduce((s, n) => s + (n > 0 ? n : 0), 0);
}

/** "4-14, 30-33" — page_ranges as the bot reads it. */
export function rangesText(ranges: Array<[number, number]>): string {
  return ranges.map(([a, b]) => `${a}-${b}`).join(', ');
}

const intIn = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;

/** May she go on from this step? `max` is GET /assessment/options' maxQuestions. */
export function stepReady(step: Step, p: Picks, max: number): boolean {
  switch (step) {
    case 'class':
      return p.grade !== null && !!p.subject;
    case 'cover':
      return p.coverBy === 'chapters' ? p.chapters.length > 0 : p.ranges.length > 0;
    case 'questions':
      if (!intIn(p.count, 1, max)) return false;
      return p.source !== 'both' || intIn(p.seen, 1, p.count - 1);
    case 'types':
      if (p.source === 'seen' || p.typeMode === 'auto') return true;
      return typesTotal(p) === unseenTarget(p) && Object.values(p.typeCounts).some((n) => n > 0);
    case 'extras':
      return p.marks === null || intIn(p.marks, 1, MAX_TOTAL_MARKS);
    case 'check':
      return STEPS.slice(0, -1).every((s) => stepReady(s, p, max));
    default:
      return false;
  }
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
};

export function toSpec(p: Picks): V2Spec {
  const byChapters = p.coverBy === 'chapters';
  const picked = p.source !== 'seen' && p.typeMode === 'pick';
  return {
    grade: p.grade as number,
    subject: p.subject as string,
    chapterNumbers: byChapters ? [...p.chapters].sort((a, b) => a - b) : null,
    pageRanges: byChapters ? null : rangesText(p.ranges),
    questionCount: p.count,
    contentSource: p.source,
    seenCount: p.source === 'both' ? p.seen : null,
    questionTypes: picked
      ? Object.entries(p.typeCounts).filter(([, n]) => n > 0).map(([id, count]) => ({ id, count }))
      : [],
    totalMarks: p.marks,
    answerLines: p.answerLines,
    // Word stays off: its flag (assessment_docx_enabled) is false in production.
    outputFormat: 'pdf',
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
};

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
  return {
    ...newPicks(spec.questionCount),
    grade: spec.grade,
    subject: spec.subject,
    subjectName,
    coverBy: chapters.length || !ranges.length ? 'chapters' : 'pages',
    chapters,
    ranges,
    count: spec.questionCount,
    source,
    seen: source === 'both' && spec.seenCount ? spec.seenCount : newPicks(spec.questionCount).seen,
    typeMode: counted.length ? 'pick' : 'auto',
    typeCounts: Object.fromEntries(counted.map((t) => [t.id, t.count])),
    marks: spec.totalMarks ?? null,
    answerLines: spec.answerLines !== false,
  };
}

/** The job's label in Being made: "Grade 4 · Science · 15 questions". */
export function paperLabel(p: Picks, C: AssessmentV2Copy = EN): string {
  return C.join(p.grade !== null ? C.grade(p.grade) : null, p.subjectName ?? p.subject, C.questionsCount(p.count));
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
