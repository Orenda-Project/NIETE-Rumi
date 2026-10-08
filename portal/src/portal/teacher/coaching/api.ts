import api from '../../services/api';
import { scoreBandFor, type BandKey } from '../../lib/scoreBands';
import type { KpiItem } from '../ui';
import type { ChipData, HistoryGroup } from '../ui';
import { dayName, pkToday } from '../lessons/days';
import { LESSONS_V2_COPY, type LessonsCopy } from '../lessons/copy';
import { COACHING_V2_COPY, type CoachingCopy } from './copy';
import { lessonPath } from './paths';

/**
 * bd-fmf24g.4 — the Digital Coaching reads (GET /api/portal/teacher/coaching/history, PR #1983).
 * A failed read throws: an empty list would read "you have no lessons".
 *
 * bd-fmf24g.13.2 — the shaping helpers take the page's words (useCopy(COACHING)) and day names
 * (useCopy(LESSONS).days), English by default.
 */
export type DcItem = {
  id: string;
  date: string;
  topic: string | null;
  subject: string | null;
  grade: number | null;
  minutes: number | null;
  percentage: number | null;
  reportReady: boolean;
};

export type DcKpi = { value: number; previous: number | null };

export type DcHistory = {
  range: { key: string; from: string | null; to: string | null };
  previous: { from: string; to: string } | null;
  kpis: { sessions: DcKpi; minutes: DcKpi; reports: DcKpi };
  trend: { bucketDays: number; points: number[] };
  items: DcItem[];
  total: number;
  truncated: boolean;
};

export async function loadDcHistory(params: Record<string, string>): Promise<DcHistory> {
  const { data } = await api.get('/teacher/coaching/history', { params });
  if (!data || data.success === false || !Array.isArray(data.items)) throw new Error('history unavailable');
  return data as DcHistory;
}

const BAND_CHIP: Record<BandKey, ChipData['tone']> = {
  excellent: 'done', good: 'done', average: 'info', below_average: 'waiting', needs_support: 'waiting',
};

/** A lesson's chip: its band (never the number), or Analysing until it has one. */
export function lessonChip(item: DcItem, C: CoachingCopy = COACHING_V2_COPY): ChipData | null {
  const band = scoreBandFor(item.percentage);
  if (band) return { text: C.bands[band], tone: BAND_CHIP[band] };
  if (!item.reportReady) return { text: C.analysing, tone: 'waiting' };
  return null;
}

/** Her lessons as HistoryList groups, by Pakistan day, newest first. */
export function lessonGroups(
  items: DcItem[],
  today: string = pkToday(),
  C: CoachingCopy = COACHING_V2_COPY,
  days: LessonsCopy['days'] = LESSONS_V2_COPY.days,
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const it of items) {
    const label = dayName(it.date, today, days);
    let g = groups[groups.length - 1];
    if (!g || g.day !== label) { g = { day: label, items: [] }; groups.push(g); }
    g.items.push({
      subject: it.subject || '',
      // A lesson whose grade the analysis did not settle has none to show.
      grade: it.grade != null ? it.grade : '–',
      title: it.topic || it.subject || C.yourLesson,
      extra: it.minutes != null ? C.minutes(it.minutes) : undefined,
      chip: lessonChip(it, C),
      to: lessonPath(it.id),
    });
  }
  return groups;
}

/** The dates a page shows and the period before it compares with (DateRangeBar's resolved range). */
export type HistoryDates = { from: string | null; to: string | null; prevFrom?: string | null; prevTo?: string | null };

export function historyParams(d: HistoryDates): Record<string, string> {
  const p: Record<string, string> = d.from && d.to ? { range: 'custom', from: d.from, to: d.to } : { range: 'all' };
  if (d.from && d.to && d.prevFrom && d.prevTo) { p.prevFrom = d.prevFrom; p.prevTo = d.prevTo; }
  return p;
}

/** KpiTiles: the server's counts against the period before, and the latest SCORED lesson's band. */
export function dcKpiItems(h: Pick<DcHistory, 'kpis' | 'trend' | 'items'>, C: CoachingCopy = COACHING_V2_COPY): KpiItem[] {
  const tile = (k: DcKpi, label: string, trend?: number[]): KpiItem => {
    const t: KpiItem = { value: k.value, label };
    if (k.previous != null) t.delta = k.value - k.previous;
    if (trend && trend.length >= 2) t.trend = trend;
    return t;
  };
  const latestBand = h.items.map((i) => scoreBandFor(i.percentage)).find((b): b is BandKey => !!b);
  return [
    tile(h.kpis.sessions, C.kpiSessions, h.trend && h.trend.points),
    { value: latestBand ? C.bands[latestBand] : '—', label: C.kpiLatestBand },
    tile(h.kpis.minutes, C.kpiMinutes),
    tile(h.kpis.reports, C.kpiReports),
  ];
}
