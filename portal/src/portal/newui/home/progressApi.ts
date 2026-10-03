import api from '../../services/api';
import type { BandKey } from '../../lib/scoreBands';
import { rangeQuery, type DateRange, type RangeKey } from '../range';

/**
 * bd-5rz1v.17 — Home's data: GET /api/portal/progress and GET /api/portal/progress/:metric
 * (bd-5rz1v.15; dashboard/routes/portal.routes.js, dashboard/services/progress.service.js,
 * dashboard/services/lp-activity.service.js). The teacher is always the session's own user.
 *
 * Every field is read defensively: an older API, or one count that failed to load, must leave
 * that tile at "—", never break the page.
 */

export type ProgressRange = { key: RangeKey; from: string | null; to: string | null; timezone: string };

export type ProgressCounts = {
  range?: ProgressRange;
  lessonPlans?: { used?: number; opened?: number; received?: number; days?: number };
  training?: { completed?: number };
  coaching?: { total?: number; digitalCoach?: number; observations?: number };
  assessments?: { made?: number };
  attendance?: { days?: number; registers?: number; unit?: 'days' };
};

export type LessonPlanOpen = { lane: 'k5'; lessonId: string } | { lane: 'g612'; segmentId: string; lang: 'en' | 'ur' | string };

/** One plan she used (opened in the portal or received on WhatsApp), most recent first. */
export type LessonPlanUsed = {
  planKey: string;
  kind: 'k5' | 'g612';
  lessonId?: string;
  segmentId?: string;
  lang?: string | null;
  /** The catalogue still has it. */
  found: boolean;
  title: string | null;
  grade: number | null;
  subject: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  dayLabel: string | null;
  pagesLabel: string | null;
  lastUsedAt: string | null;
  lastOpenedAt: string | null;
  lastReceivedAt: string | null;
  open: LessonPlanOpen;
};

/** One coaching session or observation she can see. The rating is a band, never a number. */
export type CoachingDone = {
  id: string;
  date: string;
  kind: 'digital_coach' | 'observation';
  observerRole: 'coach' | 'principal' | 'other' | null;
  observerName: string | null;
  band: BandKey | null;
  topic: string | null;
  subject: string | null;
};

export type HomeMetric = 'lesson-plans' | 'coaching';

type ItemOf<M extends HomeMetric> = M extends 'lesson-plans' ? LessonPlanUsed : CoachingDone;

export type ProgressList<M extends HomeMetric> = {
  metric: M;
  /** The tile's own number (the list may be capped). */
  total: number;
  truncated: boolean;
  items: Array<ItemOf<M>>;
};

/** Home's five counts for a range. Throws when the request fails. */
export async function getProgress(range: DateRange): Promise<ProgressCounts> {
  const { data } = await api.get('/progress', { params: rangeQuery(range) });
  return (data && typeof data === 'object' ? data : {}) as ProgressCounts;
}

/** The items behind one tile, for the same range. Throws when the request fails. */
export async function getProgressList<M extends HomeMetric>(metric: M, range: DateRange): Promise<ProgressList<M>> {
  const { data } = await api.get(`/progress/${metric}`, { params: rangeQuery(range) });
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    metric,
    total: Number.isFinite(Number(data?.total)) ? Number(data.total) : items.length,
    truncated: data?.truncated === true,
    items,
  };
}

/**
 * Grades 6-12 plans are written on request: ask for this one in its language, and say whether
 * it can open now (the Curriculum page's POST /lp612/request).
 */
export async function requestPlan612(segmentId: string, lang: string): Promise<{ ready: boolean; renderId: string | null }> {
  const { data } = await api.post('/lp612/request', { segment_id: segmentId, lang });
  return { ready: data?.state === 'ready' && Boolean(data?.renderId), renderId: data?.renderId ?? null };
}

/** A count, or null when the API did not give one (the tile then shows "—"). */
export const countOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
