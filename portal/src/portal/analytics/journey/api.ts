import api from '../../services/api';
import { parseSteps } from '../../teacher/journey/api';
import type { JourneyStep } from '../../teacher/journey/weeks';

/**
 * The team view's reads (dashboard/routes/portal-analytics-journey.routes.js): the activity store only, scoped by the
 * server to the account's organization. Each answers null when the section should not show (switch off: 404, a
 * failed read, nothing stored yet): the section then stays out of the page, never an error on it.
 */
export type TeamStep = { step: string; reached: number; stopped: number };
export type TeamView = { updatedAt: string | null; tracked: number; steps: TeamStep[]; largestDrop: string | null };
export type StoppedTeacher = { id: string; name: string | null; school: string | null; lastKind: string | null; lastAt: string | null };
export type HerJourney = { name: string | null; school: string | null; ready: boolean; steps: JourneyStep[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const params = (region: string | null) => (region ? { region } : {});

async function get(url: string, p: Record<string, string>): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await api.get(url, { params: p });
    return isObj(data) && data.success === true ? data : null;
  } catch {
    return null;
  }
}

export async function loadTeam(region: string | null): Promise<TeamView | null> {
  const d = await get('/analytics/journey', params(region));
  if (!d || d.ready !== true || !Array.isArray(d.steps)) return null;
  return {
    updatedAt: str(d.updatedAt),
    tracked: num(d.tracked),
    largestDrop: str(d.largestDrop),
    steps: d.steps.filter(isObj).map((s) => ({ step: String(s.step), reached: num(s.reached), stopped: num(s.stopped) })),
  };
}

export async function loadStopped(step: string, region: string | null): Promise<StoppedTeacher[] | null> {
  const d = await get('/analytics/journey/teachers', { step, ...params(region) });
  if (!d || !Array.isArray(d.teachers)) return null;
  return d.teachers.filter(isObj).filter((t) => typeof t.id === 'string').map((t) => ({
    id: String(t.id), name: str(t.name), school: str(t.school), lastKind: str(t.lastKind), lastAt: str(t.lastAt),
  }));
}

export async function loadHerJourney(id: string): Promise<HerJourney | null> {
  const d = await get(`/analytics/journey/teacher/${encodeURIComponent(id)}`, {});
  if (!d) return null;
  return { name: str(d.name), school: str(d.school), ready: d.ready === true, steps: parseSteps(d.steps) };
}
