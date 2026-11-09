import api from '../../../services/api';
import type { Level, Resource, Size, Way } from './rules';

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

export type OwnBody = { size: Size | null; resources: Resource[]; level: Level | null; way: Way | null; note: string };

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
