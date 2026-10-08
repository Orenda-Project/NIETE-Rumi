import api from '../../services/api';
import { scoreBandFor, bandLabel, type BandKey } from '../../lib/scoreBands';
import type { ChipData, HistoryGroup } from '../ui';
import { dayName, pkToday } from '../lessons/days';
import { COACHING_V2_COPY as C } from './copy';
import { lessonPath } from './paths';

/**
 * bd-fmf24g.4 — the Digital Coaching reads (GET /api/portal/teacher/coaching/history, PR #1983).
 * A failed read throws: an empty list would read "you have no lessons".
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
export function lessonChip(item: DcItem): ChipData | null {
  const band = scoreBandFor(item.percentage);
  if (band) return { text: bandLabel(band) as string, tone: BAND_CHIP[band] };
  if (!item.reportReady) return { text: C.analysing, tone: 'waiting' };
  return null;
}

/** Her lessons as HistoryList groups, by Pakistan day, newest first. */
export function lessonGroups(items: DcItem[], today: string = pkToday()): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const it of items) {
    const label = dayName(it.date, today);
    let g = groups[groups.length - 1];
    if (!g || g.day !== label) { g = { day: label, items: [] }; groups.push(g); }
    g.items.push({
      subject: it.subject || '',
      // A lesson whose grade the analysis did not settle has none to show.
      grade: it.grade != null ? it.grade : '–',
      title: it.topic || it.subject || C.yourLesson,
      extra: it.minutes != null ? C.minutes(it.minutes) : undefined,
      chip: lessonChip(it),
      to: lessonPath(it.id),
    });
  }
  return groups;
}
