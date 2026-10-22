import type { SaTaskResult } from '../../types/childTestSa';
import { TASKS, type DashStudent, type ReadLang, type TaskSpec } from './exampleCohort';

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
};

export function applyFilter(students: DashStudent[], f: Filter): DashStudent[] {
  return students.filter((s) => (!f.sector || s.sector === f.sector)
    && (!f.schoolId || s.schoolId === f.schoolId)
    && (!f.grade || s.grade === f.grade)
    && (!f.gender || s.gender === f.gender));
}

export function specOf(taskId: string): TaskSpec | undefined {
  return TASKS.find((t) => t.taskId === taskId);
}

/** A task's right answers: the scorer's count for a spoken task, the phone's for tap / keypad; null when unscored. */
export function correctOf(t: SaTaskResult | undefined): number | null {
  if (!t) return null;
  const scored = t.score && typeof t.score.correct === 'number' ? t.score.correct : null;
  if (scored !== null) return scored;
  return typeof t.correct === 'number' ? t.correct : null;
}

function taskIn(s: DashStudent, taskId: string): SaTaskResult | undefined {
  return s.results.tasks.find((t) => t.taskId === taskId);
}

/** The share of a comprehension task's questions answered right (its own `of`, else the spec's). */
export function comprehensionShare(t: SaTaskResult | undefined, spec: TaskSpec): number | null {
  const c = correctOf(t);
  if (c === null) return null;
  const of = t?.score && typeof t.score.of === 'number' && t.score.of > 0 ? t.score.of : spec.max;
  return c / of;
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
    const c = correctOf(t);
    if (c === null) continue;
    values.push(c);
    shares.push(spec.kind === 'comprehension' ? (comprehensionShare(t, spec) as number) : c / spec.max);
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

export type Headline = {
  n: number;
  /** reading with comprehension (≥80% of the questions), per language */
  readingWithComprehension: Record<ReadLang, number | null>;
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
    const comp = TASKS.find((t) => t.domain === lang && t.kind === 'comprehension') as TaskSpec;
    const wcpm = students.map((s) => correctOf(taskIn(s, passage.taskId))).filter((v): v is number => v !== null);
    const shares = students.map((s) => comprehensionShare(taskIn(s, comp.taskId), comp)).filter((v): v is number => v !== null);
    return {
      rwc: shares.length ? shares.filter((x) => x >= COMPREHENSION_BENCHMARK).length / shares.length : null,
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
