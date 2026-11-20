import { useEffect, useState } from 'react';
import api from '../../../services/api';
import { readConfigShared } from '../../../lib/useNewUi';

/**
 * bd-snkn32.56 (queue #134 E) — "Start from a learning goal or topic": is it on for her (GET /config
 * features.lpOwnGoalStart, list-only, fail-closed), her grade+subject's learning goals, and the closest lesson to a
 * topic she types. Each goal names the lesson the plan is written over (its pages keep the facts right).
 */
/** bd-snkn32.58.1 — grades 1–5 goals are skill-sized and carry their skill `group` and SLO `code`; 6–12 rows have neither. */
/** bd-snkn32.61 — no chapter: the goal path never names the book's chapters (an older server's `chapter` is dropped). */
export type GoalOutcome = { segmentId: string; text: string; group?: string; code?: string | null };
/** bd-snkn32.58.2 — the typed-topic guard's answer (lp-own-goal-guard): she taps a suggestion; a refusal picks nothing. */
export type GoalSuggestion = { segmentId: string; text: string };
export type GoalMatch = {
  status: 'ok' | 'none' | 'blocked';
  suggestions: GoalSuggestion[];
  otherGrade: (GoalSuggestion & { grade: number }) | null;
};
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
        segmentId: o.segmentId, text: o.text,
        ...(str(o.group) ? { group: o.group, code: str(o.code) ? o.code : null } : {}),
      }));
  } catch {
    return null;
  }
}

const suggestion = (o: Partial<GoalSuggestion> | null | undefined): GoalSuggestion | null => (
  o && str(o.segmentId) && str(o.text) ? { segmentId: o.segmentId, text: o.text } : null);

/** The guard's answer to her topic, or null (a malformed answer or a failure: the screen says try again). */
export async function matchGoal(at: At, q: string): Promise<GoalMatch | null> {
  try {
    const { data } = await api.get('/lp612/own/goals/match', { params: { ...at, q } });
    if (!['ok', 'none', 'blocked'].includes(data?.status)) return null;
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map(suggestion).filter((x: GoalSuggestion | null): x is GoalSuggestion => !!x);
    const o = data.otherGrade;
    const other = suggestion(o);
    return { status: data.status, suggestions, otherGrade: other && Number.isInteger(o.grade) ? { ...other, grade: o.grade } : null };
  } catch {
    return null;
  }
}
