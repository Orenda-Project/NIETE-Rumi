import { useEffect, useState } from 'react';
import api from '../../../services/api';
import { readConfigShared } from '../../../lib/useNewUi';
import type { Level, Resource, Size, Way } from './rules';

/**
 * bd-snkn32 — "Make my own": is it on for her (GET /config features.lpMakeOwn, fail-closed), and Make my plan
 * (POST /lp612/own). The answer is a render id the 6-12 Preparing poll and viewer already understand.
 */

/** null while /config is read, then true only for a real `true` (fail-closed). */
export function useLpMakeOwn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.lpMakeOwn === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

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
