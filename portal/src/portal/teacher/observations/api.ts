import api, { portal } from '../../services/api';
import { scoreBandFor, type BandKey } from '../../lib/scoreBands';
import type { CoachingSession } from '../../types/portal';
import { COACHING_V2_COPY, type CoachingCopy } from '../coaching/copy';
import { dayName, pkDayOf, pkToday } from '../lessons/days';
import { LESSONS_V2_COPY, type LessonsCopy } from '../lessons/copy';
import type { ChipData, HistoryGroup } from '../ui';
import { obsReportPath } from './paths';

/**
 * bd-fmf24g.4 — the Observations reads: her next visit and the visits still being worked on
 * (GET /teacher/visits, #1983), and the coach visits sent to her (GET /coaching-sessions, the ones that
 * carry `observation`). A failed read throws — "no visit" and "no reports" are real answers.
 */
export type Visit = { date: string; slot: string | null; coachName: string | null; schoolName: string | null };
export type VisitInProgress = { sessionId: string; date: string; coachName: string | null; stage: 'reviewing' | 'debrief' | 'report' };
export type Visits = { next: Visit | null; inProgress: VisitInProgress[] };

export async function loadVisits(): Promise<Visits> {
  const { data } = await api.get('/teacher/visits');
  if (!data || data.success !== true) throw new Error('teacher/visits: unexpected answer');
  return { next: data.next ?? null, inProgress: Array.isArray(data.inProgress) ? data.inProgress : [] };
}

const PAGE = 50;
const MAX_PAGES = 4;

/** The coach visits sent to her, newest first (her own lessons share the list; they are left out). */
export async function loadVisitReports(): Promise<CoachingSession[]> {
  const out: CoachingSession[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const r = await portal.getCoachingSessions(page, PAGE);
    out.push(...(r.sessions || []).filter((s) => !!s.observation));
    if (!r.pagination || page >= r.pagination.totalPages) break;
  }
  return out;
}

const BAND_CHIP: Record<BandKey, ChipData['tone']> = {
  excellent: 'done', good: 'done', average: 'info', below_average: 'waiting', needs_support: 'waiting',
};

/**
 * The reports as HistoryList groups by the day she was observed; a band, never the number. bd-fmf24g.13.2 —
 * the band words (Digital Coaching's) and the day names come in the page's language, English by default.
 */
export function reportGroups(
  reports: CoachingSession[],
  today: string = pkToday(),
  bands: CoachingCopy['bands'] = COACHING_V2_COPY.bands,
  days: LessonsCopy['days'] = LESSONS_V2_COPY.days,
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const s of reports) {
    const day = pkDayOf(s.observation?.observedAt || s.date);
    const label = day ? dayName(day, today, days) : '';
    let g = groups[groups.length - 1];
    if (!g || g.day !== label) { g = { day: label, items: [] }; groups.push(g); }
    const band = scoreBandFor(s.percentage);
    g.items.push({
      id: s.id,
      subject: s.subject || '',
      grade: '–',
      title: s.topic || s.subject || '',
      extra: s.observation?.observerName || undefined,
      chip: band ? { text: bands[band], tone: BAND_CHIP[band] } : null,
      to: obsReportPath(s.id),
    });
  }
  return groups;
}
