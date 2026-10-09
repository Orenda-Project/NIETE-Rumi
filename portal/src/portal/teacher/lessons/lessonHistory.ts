import api from '../../services/api';
import { LESSONS_V2_COPY, type LessonsCopy } from './copy';
import { dayName } from './days';
import { openUrl } from './paths';
import type { HistoryGroup } from '../ui';

/**
 * bd-fmf24g.3 — "All lesson plans" (teacher v2): the client for GET /api/portal/lesson-plans/history
 * and the shaping the page needs.
 *
 * The server counts (dashboard lp-history.service): lesson plans used, classes covered, sent on
 * WhatsApp, days active — each for the range and for the period before — plus a trend and one row
 * per plan. This file only asks and arranges: the query from the DateRangeBar's range (its own
 * dates and its own period before, so the numbers match the "vs …" it shows), the KpiTiles items,
 * and the list grouped by Pakistan day. Nothing here invents a number.
 */

/** What DateRangeBar's onChange gives (COMPONENTS.md §9); only the dates are read here. */
export type DateRange = {
  preset?: string;
  from: string | null;
  to: string | null;
  prevFrom?: string | null;
  prevTo?: string | null;
};

/** A class to narrow to: from the grade·subject picker (lib/gradeSubjects). */
export type ClassFilter = { grade: number | null; subjectKey: string } | null;

export type Kpi = { value: number; previous: number | null };

export type HistoryOpen =
  | { lane: 'k5'; lessonId: string }
  | { lane: 'g612'; segmentId: string; lang: string };

export type HistoryItem = {
  planKey: string;
  kind: 'k5' | 'g612';
  found: boolean;
  title: string | null;
  grade: number | null;
  subject: string | null;
  subjectKey: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  dayLabel: string | null;
  pagesLabel: string | null;
  lastUsedAt: string;
  /** Pakistan day of the last use, YYYY-MM-DD. */
  day: string;
  via: 'portal' | 'whatsapp';
  open: HistoryOpen;
};

export type LessonHistory = {
  range: { key: string; from: string | null; to: string | null };
  previous: { from: string; to: string } | null;
  kpis: { lessonPlans: Kpi; classesCovered: Kpi; sentOnWhatsapp?: Kpi; daysActive: Kpi };
  trend: { bucketDays: number; points: number[] };
  items: HistoryItem[];
  total: number;
  truncated: boolean;
};

export function historyParams(range: DateRange, filter: ClassFilter = null): Record<string, string | number> {
  const p: Record<string, string | number> = range.from && range.to
    ? { range: 'custom', from: range.from, to: range.to }
    : { range: 'all' };
  if (range.from && range.to && range.prevFrom && range.prevTo) {
    p.prevFrom = range.prevFrom;
    p.prevTo = range.prevTo;
  }
  if (filter) {
    if (filter.grade != null) p.grade = filter.grade;
    p.subject = filter.subjectKey;
  }
  return p;
}

export async function loadLessonHistory(range: DateRange, filter: ClassFilter): Promise<LessonHistory> {
  const { data } = await api.get('/lesson-plans/history', { params: historyParams(range, filter) });
  if (!data || data.success !== true || !data.kpis || !Array.isArray(data.items)) {
    throw new Error('lesson-plans/history: unexpected answer');
  }
  return data as LessonHistory;
}

/** KpiTiles items (COMPONENTS.md §10): value, change against the period before, a trend of ≥2 points. */
export type KpiItem = { value: number; label: string; delta?: number; trend?: number[] };

export function kpiItems(h: Pick<LessonHistory, 'kpis' | 'trend'>, words: LessonsCopy = LESSONS_V2_COPY): KpiItem[] {
  const C = words.all.kpis;
  const tile = (k: Kpi, label: string, trend?: number[]): KpiItem => {
    const t: KpiItem = { value: k.value, label };
    if (k.previous != null) t.delta = k.value - k.previous;
    if (trend && trend.length >= 2) t.trend = trend;
    return t;
  };
  return [
    tile(h.kpis.lessonPlans, C.lessonPlans, h.trend && h.trend.points),
    tile(h.kpis.classesCovered, C.classesCovered),
    tile(h.kpis.daysActive, C.daysActive),
  ];
}

/** The rows by Pakistan day, in the server's order (newest first), as the kit's HistoryList groups;
 *  each row reopens its plan by key (OpenPlanPage). `today` is Pakistan's today. */
export function groupByDay(items: HistoryItem[], today: string, words: LessonsCopy = LESSONS_V2_COPY): HistoryGroup[] {
  const C = words.all;
  const groups: HistoryGroup[] = [];
  for (const it of items) {
    const label = dayName(it.day, today, words.days);
    let g = groups[groups.length - 1];
    if (!g || g.day !== label) { g = { day: label, items: [] }; groups.push(g); }
    const title = it.title || words.planFallback;
    g.items.push({
      id: it.planKey,
      subject: it.subject ?? '',
      grade: it.grade ?? '',
      title,
      ...(it.chapterNumber != null ? { extra: C.chapter(it.chapterNumber) } : {}),
      chip: it.via === 'whatsapp' ? { text: C.whatsapp, tone: 'done' } : { text: C.opened, tone: 'info' },
      to: openUrl(it.open.lane === 'k5'
        ? { plan: `k5:${it.open.lessonId}`, title: it.title, grade: it.grade }
        : { plan: `g612:${it.open.segmentId}`, lang: it.open.lang, title: it.title, grade: it.grade }),
    });
  }
  return groups;
}

export { pkToday } from './days';
