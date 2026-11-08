import api from '../../../services/api';
import type { Level, Resource, Size, Way } from './rules';

/**
 * bd-snkn32 — "Make my own": is it on for her (GET /config features.lpMakeOwn, fail-closed), and Make my plan
 * (POST /lp612/own). The answer is a render id the 6-12 Preparing poll and viewer already understand.
 */

export { useLpMakeOwn } from './flag';

export type OwnBody = { size: Size | null; resources: Resource[]; level: Level | null; way: Way | null; note: string };

/** Her fork's id, or null when it could not be started (the page says "Couldn't make it"). */
export async function makeOwnPlan(segmentId: string, answers: OwnBody): Promise<string | null> {
  try {
    const { data } = await api.post('/lp612/own', { segment_id: segmentId, answers });
    return typeof data?.renderId === 'string' && data.renderId ? data.renderId : null;
  } catch {
    return null;
  }
}
