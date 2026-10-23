import { childTestSa } from '../../services/api';
import type { SaList } from '../../types/childTestSa';
import type { QueuedOutcome } from './visitStore';

/**
 * Sending one outcome the phone kept while offline. 2xx: sent. No answer, 409
 * or 429, or a server error: try again later. Any other 4xx: the server turned
 * it down for good, so it is dropped (and logged by the caller).
 */

export type SendResult =
  | { kind: 'sent'; list: SaList | null; sessionId: string | null }
  | { kind: 'retry' }
  | { kind: 'refused'; status: number };

export function statusOf(err: unknown): number | null {
  const r = (err as { response?: { status?: unknown } } | null)?.response;
  return r && typeof r.status === 'number' ? r.status : null;
}

export function isRefusal(status: number | null): status is number {
  return status !== null && status >= 400 && status < 500 && status !== 409 && status !== 429;
}

export async function sendQueued(q: QueuedOutcome): Promise<SendResult> {
  const args: Parameters<typeof childTestSa.markOutcome>[0] = { schoolId: q.schoolId, visitId: q.visitId, drawId: q.drawId, outcome: q.outcome };
  if (q.clientSessionId) args.clientSessionId = q.clientSessionId;
  if (q.block) args.block = q.block;
  if (q.grade) args.grade = q.grade;
  try {
    const out = await childTestSa.markOutcome(args);
    return { kind: 'sent', list: out?.list ?? null, sessionId: out?.sessionId ?? null };
  } catch (err) {
    const status = statusOf(err);
    return isRefusal(status) ? { kind: 'refused', status } : { kind: 'retry' };
  }
}
