import api from '../../../services/api';
import type { Focus, Level, Purpose, Resource, Size, Way } from './rules';

/**
 * bd-snkn32 — "Make my own": is it on for her (GET /config features.lpMakeOwn, fail-closed), and Make my plan
 * (POST /lp612/own). The answer is a render id the 6-12 Preparing poll and viewer already understand.
 * bd-snkn32.4 — a grades 1–5 day goes as `lesson_id` (its plan in the book's own language); a 6–12 lesson as `segment_id`.
 */
import type { LpLesson } from '../../../newui/lessons/lessonPlansApi';

export { useLpMakeOwn } from './flag';

/** A plan Make my own can start from: a 6–12 lesson, or a grades 1–5 day (not a worksheet or a revision). */
export const ownable = (l: Pick<LpLesson, 'lane' | 'kind'>) =>
  (l.lane === 'g612' && l.kind === 'lesson') || (l.lane === 'k5' && l.kind === 'day');

export type OwnBody = {
  size: Size | null; resources: Resource[]; level: Level | null; way: Way | null; note: string; purpose?: Purpose; focus?: Focus;
  /** bd-snkn32.17 — grades 1–5 only: her book pages, when not the day's own. */
  pages?: { start: number; end: number };
};

/** bd-snkn32.13 — a Grade 9–12 lesson's FBISE SLOs, split when they mix Summative and Formative. Not mixed on any failure. */
export type SloMix = { mixed: boolean; summative: string[]; formative: string[] };
export async function fetchSloMix(segmentId: string): Promise<SloMix> {
  try {
    const { data } = await api.get(`/lp612/own/slo/${encodeURIComponent(segmentId)}`);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { mixed: data?.mixed === true, summative: list(data?.summative), formative: list(data?.formative) };
  } catch {
    return { mixed: false, summative: [], formative: [] };
  }
}

/** Her fork's id, or null when it could not be started (the page says "Couldn't make it"). */
export async function makeOwnPlan(lesson: Pick<LpLesson, 'id' | 'lane'>, answers: OwnBody): Promise<string | null> {
  try {
    const at = lesson.lane === 'k5' ? { lesson_id: lesson.id } : { segment_id: lesson.id };
    const { data } = await api.post('/lp612/own', { ...at, answers });
    return typeof data?.renderId === 'string' && data.renderId ? data.renderId : null;
  } catch {
    return null;
  }
}
