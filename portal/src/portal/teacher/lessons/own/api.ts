import api from '../../../services/api';
import type { Level, Resource, Size, Way } from './rules';
import { isRefusal, type Refusal } from './change';

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

/** What the bot answered: her new plan's id, a refusal she is told about (bd-snkn32.15), or null (could not reach it). */
export type OwnAnswer = { renderId: string } | { outcome: Refusal } | null;

async function postOwn(url: string, body: object): Promise<OwnAnswer> {
  try {
    const { data } = await api.post(url, body);
    return typeof data?.renderId === 'string' && data.renderId ? { renderId: data.renderId } : null;
  } catch (err) {
    const r = (err as { response?: { status?: number; data?: { outcome?: unknown } } } | null)?.response;
    return r?.status === 409 && isRefusal(r.data?.outcome) ? { outcome: r.data.outcome } : null;
  }
}

/** Make my plan: her fork's id, or the daily limit, or null (the page says "Couldn't make it"). */
export function makeOwnPlan(lesson: Pick<LpLesson, 'id' | 'lane'>, answers: OwnBody): Promise<OwnAnswer> {
  const at = lesson.lane === 'k5' ? { lesson_id: lesson.id } : { segment_id: lesson.id };
  return postOwn('/lp612/own', { ...at, answers });
}

/** bd-snkn32.15 — Change this plan: any id in her plan's chain, the part, her words. */
export function requestChange(ownId: string, part: string, text: string): Promise<OwnAnswer> {
  return postOwn(`/lp612/own/${encodeURIComponent(ownId)}/change`, { part, text });
}
