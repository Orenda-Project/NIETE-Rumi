import api from '../../services/api';
import type { JourneyStep } from './weeks';

/**
 * GET /api/portal/me/journey — her own steps, read by the server from the activity store only (never a database
 * read). Never throws: { status: 'ok', data } | { status: 'off' } (switch off: 404) | { status: 'error' }.
 * `ready: false` = nothing stored for her yet (or expired): "Not ready yet", never an error.
 */
export type JourneyData = { ready: boolean; updatedAt: string | null; steps: JourneyStep[] };
export type JourneyLoad = { status: 'ok'; data: JourneyData } | { status: 'off' } | { status: 'error' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The steps of an answer, each one checked; a malformed step is dropped, never drawn. */
export function parseSteps(raw: unknown): JourneyStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is JourneyStep => isObj(s) && typeof s.kind === 'string' && typeof s.at === 'string'
    && Number.isFinite(Date.parse(s.at)) && typeof s.refId === 'string' && isObj(s.meta));
}

export function parseJourney(body: unknown): JourneyData | null {
  if (!isObj(body) || body.success !== true) return null;
  if (body.ready !== true) return { ready: false, updatedAt: null, steps: [] };
  return { ready: true, updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null, steps: parseSteps(body.steps) };
}

export async function loadJourney(): Promise<JourneyLoad> {
  try {
    const { data } = await api.get('/me/journey');
    const parsed = parseJourney(data);
    return parsed ? { status: 'ok', data: parsed } : { status: 'error' };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return status === 404 ? { status: 'off' } : { status: 'error' };
  }
}
