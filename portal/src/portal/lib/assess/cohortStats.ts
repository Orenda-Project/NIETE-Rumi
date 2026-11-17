import type { SaTaskResult } from '../../types/childTestSa';
import { TASKS, type DashStudent, type ReadLang, type TaskSpec } from './exampleCohort';
import { pktDay } from './realCohort';

/**
 * The example dashboard's numbers, from the results shape alone (SaTaskResult), so real sessions feed the same code.
 *
 * Benchmarks (proposed to the lead; one place to change them):
 *  - oral reading fluency, correct words per minute: zero 0 · beginning 1–19 · developing 20–39 · fluent 40+;
 *  - reading with comprehension: 80% or more of the passage's questions right;
 *  - a maths subtask is met at 75% or more right; mental-maths fluency is read as correct per minute (of 20).
 */

export const ORF_BANDS = [
  { key: 'zero', min: 0, max: 0 },
  { key: 'beginning', min: 1, max: 19 },
  { key: 'developing', min: 20, max: 39 },
  { key: 'fluent', min: 40, max: Infinity },
] as const;
export type OrfBand = (typeof ORF_BANDS)[number]['key'];
export const COMPREHENSION_BENCHMARK = 0.8;
export const MATHS_BENCHMARK = 0.75;

export type Filter = {
  sector?: string | null;
  schoolId?: string | null;
  grade?: 1 | 2 | 3 | 4 | 5 | null;
  gender?: 'girl' | 'boy' | null;
  /** live data with sa_dash_filters (round 7b): coach-led or auto, one coach, and Pakistan days from–to (YYYY-MM-DD) */
  mode?: 'coach_led' | 'auto' | null;
  coachId?: string | null;
  from?: string | null;
  to?: string | null;
};

export function applyFilter(students: DashStudent[], f: Filter): DashStudent[] {
  return students.filter((s) => (!f.sector || s.sector === f.sector)
    && (!f.schoolId || s.schoolId === f.schoolId)
    && (!f.grade || s.grade === f.grade)
    && (!f.gender || s.gender === f.gender)
    && (!f.mode || s.mode === f.mode)
    && (!f.coachId || s.coachId === f.coachId)
    && (!f.from || pktDay(s.startedAt) >= f.from)
    && (!f.to || (pktDay(s.startedAt) !== '' && pktDay(s.startedAt) <= f.to)));
}

export function specOf(taskId: string): TaskSpec | undefined {
  return TASKS.find((t) => t.taskId === taskId);
}

/** A task's right answers: the scorer's count for a spoken task, the phone's for tap / keypad; null when unscored. */
export function correctOf(t: SaTaskResult | undefined): number | null {
  if (!t) return null;
  // round 28: a tapped task the child heard too few items of is unrated: no score, never a low one
  if (t.unrated === true) return null;
  const scored = t.score && typeof t.score.correct === 'number' ? t.score.correct : null;
  if (scored !== null) return scored;
  return typeof t.correct === 'number' ? t.correct : null;
}

/**
 * A passage's correct words per minute: the scorer's per_minute (a child who finishes the passage early reads faster
 * than their count of words), else the count itself; null when unscored.
 */
export function wcpmOf(t: SaTaskResult | undefined): number | null {
  if (t && t.score && typeof t.score.per_minute === 'number') return t.score.per_minute;
  return correctOf(t);
}

function taskIn(s: DashStudent, taskId: string): SaTaskResult | undefined {
  return s.results.tasks.find((t) => t.taskId === taskId);
}

/**
 * The items a round-28 tapped task is read on (null for every other row): the MCQ (a tapped comprehension task) is
 * of ofAll (the served variant's questions; the spec's 6 when absent) − the questions whose clips were lost (`unavailable`), a question the reading gate did not ask counting as
 * wrong (so never `asked.length`); the picker (a live-only tapped spec) is of the items `presented`. The share and the
 * guessing floor both divide by this, never a second formula.
 */
export function tapOf(t: SaTaskResult | undefined, spec: TaskSpec): number | null {
  if (t?.mode !== 'tap') return null;
  if (spec.kind === 'comprehension') {
    const lost = typeof t.unavailable === 'number' && t.unavailable > 0 ? t.unavailable : 0;
    // the served variant's questions (ofAll: 5 on a 5-question story), else the spec's
    const all = typeof t.ofAll === 'number' && t.ofAll > 0 ? t.ofAll : spec.max;
    return all - lost > 0 ? all - lost : null;
  }
  if (spec.example === false && typeof t.presented === 'number' && t.presented > 0) return t.presented;
  return null;
}

/**
 * The share of a comprehension task's questions answered right: its own `of`, else the spec's. Round 28's tapped MCQ:
 * of tapOf (6 − lost). An unrated task has no share (correctOf is null).
 */
export function comprehensionShare(t: SaTaskResult | undefined, spec: TaskSpec): number | null {
  const c = correctOf(t);
  if (c === null) return null;
  if (t?.mode === 'tap') {
    const of = tapOf(t, spec);
    return of ? c / of : null;
  }
  const of = t?.score && typeof t.score.of === 'number' && t.score.of > 0 ? t.score.of : spec.max;
  return c / of;
}

/** Round 28's picker: correct of the items presented (tapOf; lost clips are out of the denominator); every other task: of its max. */
function itemsShare(t: SaTaskResult | undefined, c: number, spec: TaskSpec): number {
  return c / (tapOf(t, spec) ?? spec.max);
}

/**
 * The guessing floor's `of` for a cohort card: the most common tapOf among the rated children (ties: the larger), and
 * how many rated children had a shorter one. Null when no rated child carries one.
 */
export function cohortTapOf(students: DashStudent[], spec: TaskSpec): { of: number; fewer: number } | null {
  const ofs: number[] = [];
  for (const s of students) {
    const t = taskIn(s, spec.taskId);
    if (correctOf(t) === null) continue;
    const of = tapOf(t, spec);
    if (of !== null) ofs.push(of);
  }
  if (!ofs.length) return null;
  const count = new Map<number, number>();
  for (const x of ofs) count.set(x, (count.get(x) || 0) + 1);
  let mode = ofs[0];
  for (const [x, k] of count) if (k > (count.get(mode) as number) || (k === count.get(mode) && x > mode)) mode = x;
  return { of: mode, fewer: ofs.filter((x) => x < mode).length };
}

export type TaskSummary = {
  taskId: string;
  /** students with a score for this task */
  n: number;
  /** mean right answers as a share of the task's items (passage / fluency: mean per minute instead, see meanValue) */
  meanShare: number | null;
  meanValue: number | null;
  zeroShare: number | null;
  /** students per score 0..max (passage: per ORF band, in ORF_BANDS order) */
  distribution: number[];
  /** share meeting the task's benchmark (comprehension 80%, maths 75%); null where none applies */
  benchmarkShare: number | null;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function orfBand(wcpm: number): OrfBand {
  return (ORF_BANDS.find((b) => wcpm >= b.min && wcpm <= b.max) || ORF_BANDS[0]).key;
}

export function summariseTask(students: DashStudent[], spec: TaskSpec): TaskSummary {
  const values: number[] = [];
  const shares: number[] = [];
  for (const s of students) {
    const t = taskIn(s, spec.taskId);
    const c = spec.kind === 'passage' ? wcpmOf(t) : correctOf(t);
    if (c === null) continue;
    values.push(c);
    shares.push(spec.kind === 'comprehension' ? (comprehensionShare(t, spec) as number) : itemsShare(t, c, spec));
  }
  const n = values.length;
  const distribution = spec.kind === 'passage'
    ? ORF_BANDS.map((b) => values.filter((v) => orfBand(v) === b.key).length)
    : Array.from({ length: spec.max + 1 }, (_, k) => values.filter((v) => v === k).length);
  let benchmarkShare: number | null = null;
  if (n && spec.kind === 'comprehension') benchmarkShare = shares.filter((x) => x >= COMPREHENSION_BENCHMARK).length / n;
  else if (n && spec.domain === 'ma' && spec.kind === 'items') benchmarkShare = shares.filter((x) => x >= MATHS_BENCHMARK).length / n;
  return {
    taskId: spec.taskId,
    n,
    meanShare: mean(shares),
    meanValue: mean(values),
    zeroShare: n ? values.filter((v) => v === 0).length / n : null,
    distribution,
    benchmarkShare,
  };
}

/**
 * Reading with comprehension per FORM (SPEC F): today's spoken questions (`*.story_comp_w3`) and round 28's tapped MCQ
 * (`*.story_mcq_w3`). Each is null when no child in view has a rated share for that form. Never pooled: the MCQ's 25%
 * guess floor lifts its 80%+ share by construction, so one number would move with the switch date, not with reading.
 */
export type ComprehensionByForm = { spoken: number | null; tapped: number | null };

export type Headline = {
  n: number;
  /** reading with comprehension (≥80% of the questions), per language, per form */
  readingWithComprehension: Record<ReadLang, ComprehensionByForm>;
  /** median correct words per minute, per language */
  orfMedian: Record<ReadLang, number | null>;
  /** zero score on the passage, per language */
  orfZero: Record<ReadLang, number | null>;
  /** share meeting the benchmark on every maths subtask scored */
  mathsAllMet: number | null;
  /** median minutes from start to end of the session */
  minutesMedian: number | null;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function headline(students: DashStudent[]): Headline {
  const per = (lang: ReadLang) => {
    const passage = TASKS.find((t) => t.domain === lang && t.kind === 'passage') as TaskSpec;
    // The rule (SPEC F): "reading with comprehension" is reported per form, spoken and tapped, never one pooled share;
    // the dashboard shows one number when the cohort has one form and both, labelled, when it has both. An unrated
    // tapped task has no share, so it counts in neither.
    const rwcOf = (mode: 'spoken' | 'tapped'): number | null => {
      const specs = TASKS.filter((t) => t.domain === lang && t.kind === 'comprehension' && (t.mode === 'tap') === (mode === 'tapped'));
      const shares = students
        .map((s) => specs.map((spec) => comprehensionShare(taskIn(s, spec.taskId), spec)).find((x) => x !== null) ?? null)
        .filter((v): v is number => v !== null);
      return shares.length ? shares.filter((x) => x >= COMPREHENSION_BENCHMARK).length / shares.length : null;
    };
    const wcpm = students.map((s) => wcpmOf(taskIn(s, passage.taskId))).filter((v): v is number => v !== null);
    return {
      rwc: { spoken: rwcOf('spoken'), tapped: rwcOf('tapped') },
      median: median(wcpm),
      zero: wcpm.length ? wcpm.filter((v) => v === 0).length / wcpm.length : null,
    };
  };
  const ur = per('ur');
  const en = per('en');
  const maths = TASKS.filter((t) => t.domain === 'ma' && t.kind === 'items');
  const mathsScored = students.filter((s) => maths.some((m) => correctOf(taskIn(s, m.taskId)) !== null));
  const allMet = mathsScored.filter((s) => maths.every((m) => {
    const c = correctOf(taskIn(s, m.taskId));
    return c === null || c / m.max >= MATHS_BENCHMARK;
  })).length;
  const minutes = students.map((s) => {
    const a = Date.parse(s.results.session.startedAt || '');
    const b = Date.parse(s.results.session.endedAt || '');
    return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 60000 : null;
  }).filter((v): v is number => v !== null);
  return {
    n: students.length,
    readingWithComprehension: { ur: ur.rwc, en: en.rwc },
    orfMedian: { ur: ur.median, en: en.median },
    orfZero: { ur: ur.zero, en: en.zero },
    mathsAllMet: mathsScored.length ? allMet / mathsScored.length : null,
    minutesMedian: median(minutes),
  };
}

export type GroupRow = { key: string; label: string; n: number; h: Headline };

/** One row per value of `by` (sector or school), largest first within the fixed sector order. */
export function groupBy(students: DashStudent[], by: 'sector' | 'school'): GroupRow[] {
  const groups = new Map<string, { label: string; rows: DashStudent[] }>();
  for (const s of students) {
    const key = by === 'sector' ? s.sector : s.schoolId;
    const label = by === 'sector' ? s.sector : s.schoolName;
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    (groups.get(key) as { rows: DashStudent[] }).rows.push(s);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, n: g.rows.length, h: headline(g.rows) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
