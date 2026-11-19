import { useEffect, useState } from 'react';
import api from '../../../services/api';
import { readConfigShared } from '../../../lib/useNewUi';

/**
 * bd-snkn32.56 (queue #134 E) — "Start from a learning goal or topic": is it on for her (GET /config
 * features.lpOwnGoalStart, list-only, fail-closed), her grade+subject's learning goals, and the closest lesson to a
 * topic she types. Each goal names the lesson the plan is written over (its pages keep the facts right).
 */
/** bd-snkn32.58.1 — grades 1–5 goals are skill-sized and carry their skill `group` and SLO `code`; 6–12 rows have neither. */
export type GoalOutcome = { segmentId: string; text: string; chapter: string | null; group?: string; code?: string | null };
export type GoalMatch = { segmentId: string; title: string };
type At = { grade: number; subject: string };

/** null while /config is read, then true only for a real `true`. */
export function useLpOwnGoalStart(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.lpOwnGoalStart === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Her grade's learning goals; null on any failure (the screen says so; never an empty list it cannot vouch for). */
export async function fetchGoals(at: At): Promise<GoalOutcome[] | null> {
  try {
    const { data } = await api.get('/lp612/own/goals', { params: at });
    if (!Array.isArray(data?.outcomes)) return null;
    return data.outcomes
      .filter((o: Partial<GoalOutcome>) => str(o?.segmentId) && str(o?.text))
      .map((o: GoalOutcome) => ({
        segmentId: o.segmentId, text: o.text, chapter: str(o.chapter) ? o.chapter : null,
        ...(str(o.group) ? { group: o.group, code: str(o.code) ? o.code : null } : {}),
      }));
  } catch {
    return null;
  }
}

/** The closest lesson to her topic, or null (none, a malformed answer or a failure). */
export async function matchGoal(at: At, q: string): Promise<GoalMatch | null> {
  try {
    const { data } = await api.get('/lp612/own/goals/match', { params: { ...at, q } });
    const m = data?.match;
    return m && str(m.segmentId) && str(m.title) ? { segmentId: m.segmentId, title: m.title } : null;
  } catch {
    return null;
  }
}
