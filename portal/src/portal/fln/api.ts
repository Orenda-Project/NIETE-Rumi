/**
 * bd-t7zk3t.11 — the FLN API client (contracts/api.md v2). Plain `fetch` with the session cookie, never the shared
 * `services/api.ts` client: its 401 handler differs between branches and drops the page the user was going to.
 *
 *   404 → `null`  (the feature is off for this user, or the plan is hidden/unknown)
 *   401 → throws FlnAuthError (the gate sends the user to sign-in with `next=`)
 *   503 / 5xx / network → throws FlnUnavailableError (the calm "not available right now" line)
 */
import type { FlnCatalogue, FlnMe, FlnPlanResponse } from './types';
import type { FlnSubjectKey } from './strings';

export class FlnAuthError extends Error {
  constructor() { super('fln_unauthenticated'); this.name = 'FlnAuthError'; }
}
export class FlnUnavailableError extends Error {
  constructor(public status: number) { super(`fln_unavailable_${status}`); this.name = 'FlnUnavailableError'; }
}

const BASE = '/api/portal/fln';

async function getJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch {
    throw new FlnUnavailableError(0);
  }
  if (res.status === 404) return null;
  if (res.status === 401) throw new FlnAuthError();
  if (!res.ok) throw new FlnUnavailableError(res.status);
  return (await res.json()) as T;
}

export const flnApi = {
  me: () => getJson<FlnMe>('/me'),
  catalogue: (q: { grade: number; subject: FlnSubjectKey; level?: number | null }) => {
    const p = new URLSearchParams({ grade: String(q.grade), subject: q.subject });
    if (q.level) p.set('level', String(q.level));
    return getJson<FlnCatalogue>(`/catalogue?${p.toString()}`);
  },
  plan: (id: number | string) => getJson<FlnPlanResponse>(`/plan/${encodeURIComponent(String(id))}`),
  /** Fire-and-forget telemetry (≤50 per batch); never throws, never blocks a tap. */
  events: (batch: Array<{ kind: string; plan: number | string; clip?: string; ms?: number; result?: string }>) => {
    if (!batch.length) return;
    void fetch(`${BASE}/events`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.slice(0, 50)),
    }).catch(() => undefined);
  },
};
