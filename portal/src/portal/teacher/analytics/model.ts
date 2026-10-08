import type { RemarkReceived, SchoolAnalytics, SchoolPresence } from '../../types/portal';
import type { ProgressCounts } from '../../newui/home/progressApi';
import type { DateRange } from '../../newui/range';
import { BAND_THRESHOLDS, bandLabel, scoreBandFor, scoreBandForScore, type BandKey } from '../../lib/scoreBands';
import type { KpiItem } from '../ui';
import { ANALYTICS_V2_COPY as C } from './copy';

/**
 * bd-fmf24g.8 — what the teacher v2 Analytics page shows, computed from the existing answers:
 * GET /progress (Home's counts, for this period and the one before) and GET /my-analytics (her
 * Human-observation ratings, areas, presence and remarks). Ratings are BANDS, never numbers
 * (lib/scoreBands, operator 2026-09-29); a count that did not load stays empty, never a made-up 0.
 */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function kpi(value: unknown, before: unknown, label: string, hasBefore: boolean): KpiItem {
  const v = num(value);
  const b = num(before);
  const out: KpiItem = { value: v, label };
  if (hasBefore && v !== null && b !== null) out.delta = v - b;
  return out;
}

/** Lesson plans used, modules done, papers made, attendance days — with the change against `prev`. */
export function activityKpis(cur: ProgressCounts, prev: ProgressCounts | null): KpiItem[] {
  const p = prev ?? {};
  const has = prev !== null;
  return [
    kpi(cur.lessonPlans?.used, p.lessonPlans?.used, C.lessonPlansUsed, has),
    kpi(cur.training?.completed, p.training?.completed, C.modulesDone, has),
    kpi(cur.assessments?.made, p.assessments?.made, C.papersMade, has),
    kpi(cur.attendance?.days, p.attendance?.days, C.attendanceDays, has),
  ];
}

/** Coach and principal observations, and her Digital Coaching lessons. */
export function observationKpis(cur: ProgressCounts, prev: ProgressCounts | null): KpiItem[] {
  const p = prev ?? {};
  const has = prev !== null;
  return [
    kpi(cur.coaching?.observations, p.coaching?.observations, C.observations, has),
    kpi(cur.coaching?.digitalCoach, p.coaching?.digitalCoach, C.digitalCoaching, has),
  ];
}

/** The period before as a range GET /progress takes; null when there is none (All time). */
export function previousRange(r: { prevFrom: string | null; prevTo: string | null }): DateRange | null {
  return r.prevFrom && r.prevTo ? { key: 'custom', from: r.prevFrom, to: r.prevTo } : null;
}

/** The five band rows, best on top — the chart's gridlines. */
export const BAND_ROWS: ReadonlyArray<{ key: BandKey; label: string }> = BAND_THRESHOLDS.map((b) => ({ key: b.key, label: b.label }));

export type TrendPoint = { date: string; row: number; band: string };

/** Her rated (Human) observations, oldest first, each on its band's row (0 = Excellent). */
export function bandTrend(points: SchoolAnalytics['scoreTrend'] | null | undefined): TrendPoint[] {
  return (points ?? [])
    .map((p) => ({ date: p.date, key: scoreBandFor(p.percentage) }))
    .filter((p): p is { date: string; key: BandKey } => p.key !== null && !!p.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: p.date, row: BAND_ROWS.findIndex((b) => b.key === p.key), band: bandLabel(p.key) as string }));
}

export type AreaRow = { key: string; name: string; band: string; width: number; focus: boolean };

/** The STEPS areas from Human observations, strongest first; the weakest is the focus. */
export function areaRows(areas: SchoolAnalytics['areas'] | null | undefined): AreaRow[] {
  const sorted = [...(areas ?? [])].filter((a) => num(a.pct) !== null).sort((a, b) => b.pct - a.pct);
  return sorted.map((a, i) => ({
    key: a.key,
    name: a.name,
    band: bandLabel(scoreBandFor(a.pct)) ?? '',
    width: Math.max(0, Math.min(100, Math.round(a.pct))),
    focus: sorted.length > 1 && i === sorted.length - 1,
  }));
}

export type PresenceRows = {
  teacher: { pct: number; present: number; of: number } | null;
  students: { pct: number } | null;
};

/** Her own days (leave is out of the count, as the server's percentage) and her students' presence. */
export function presenceRows(p: SchoolPresence | null | undefined): PresenceRows {
  const t = p?.teacher;
  const s = p?.student;
  const tp = num(t?.presentPct);
  const sp = num(s?.presentPct);
  return {
    teacher: tp !== null && t ? { pct: tp, present: t.present, of: t.present + t.absent } : null,
    students: sp !== null ? { pct: sp } : null,
  };
}

/** A timestamp as Pakistan's calendar day, "28 Sep". */
function pkDay(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 5 * 3_600_000);
  return C.day(d.getUTCDate(), d.getUTCMonth());
}

export type RemarkItem = {
  key: string;
  date: string;
  cycle: string | null;
  comment: string | null;
  areas: Array<{ name: string; band: string }>;
};

/** Principal remarks, newest first: date, cycle, comment; without a comment, each area and its band. */
export function remarkItems(remarks: RemarkReceived[] | null | undefined): RemarkItem[] {
  return (remarks ?? [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.submittedAt ?? '').localeCompare(a.r.submittedAt ?? ''))
    .map(({ r, i }) => ({
      key: `${r.submittedAt ?? ''}-${i}`,
      date: pkDay(r.submittedAt),
      cycle: r.cycleName ?? null,
      comment: r.comment && r.comment.trim() ? r.comment : null,
      areas: r.comment && r.comment.trim()
        ? []
        : (r.areas ?? []).map((a) => ({ name: a.name, band: bandLabel(scoreBandForScore(a.score, 4)) ?? '' })),
    }));
}
