import api from '../../../services/api';

/**
 * bd-snkn32.42 — "Made by a teacher": the shelf (GET /lp612/shelf, approved plans on a chapter's lessons) and the
 * staff check before a plan is listed (GET/POST /lp612/own/review). Both switches come from GET /config (the shared,
 * cached read): features.lpOwnShelf and features.lpOwnReviewer, fail-closed. Every failure is nothing, never a throw.
 */

export type ShelfPlan = { ownId: string; lesson: string; band: 'k5' | 'g612'; lang: string };
export type BelowCheck = { id: string; name: string; rating: number };
export type ReviewPlan = ShelfPlan & { score: number; reviewedAt: string; below: BelowCheck[]; notAssessed: string[] };
export type Decision = 'approve' | 'reject';

export { useLpOwnShelf, useLpOwnReviewer } from './flag';

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isShelf = (p: unknown): p is ShelfPlan => {
  const r = p as Partial<ShelfPlan> | null;
  return !!r && isStr(r.ownId) && isStr(r.lesson) && (r.band === 'k5' || r.band === 'g612') && isStr(r.lang);
};
const isReview = (p: unknown): p is ReviewPlan => {
  const r = p as Partial<ReviewPlan> | null;
  return isShelf(p) && typeof r!.score === 'number' && Array.isArray(r!.below) && Array.isArray(r!.notAssessed);
};

/** The approved plans on these lessons (the chapter she is browsing). None, or a failure: []. */
export async function fetchShelf(keys: string[]): Promise<ShelfPlan[]> {
  if (!keys.length) return [];
  try {
    const { data } = await api.get('/lp612/shelf', { params: { keys: keys.join(',') } });
    return (Array.isArray(data?.plans) ? data.plans : []).filter(isShelf);
  } catch {
    return [];
  }
}

/** The plans the AI passed that no one has decided yet. A failure throws, so the page can offer Try again. */
export async function fetchReviewQueue(): Promise<ReviewPlan[]> {
  const { data } = await api.get('/lp612/own/review');
  return (Array.isArray(data?.plans) ? data.plans : []).filter(isReview);
}

/** Approve or reject (with a reason). true when it was recorded. */
export async function decideOwn(ownId: string, decision: Decision, reason?: string): Promise<boolean> {
  try {
    const { data } = await api.post(`/lp612/own/review/${encodeURIComponent(ownId)}`, { decision, ...(reason ? { reason } : {}) });
    return data?.success === true;
  } catch {
    return false;
  }
}

/** The plan's PDF as a local link the reviewer's browser can open (the relay needs her session). null on failure. */
export async function reviewPdfUrl(ownId: string): Promise<string | null> {
  try {
    const { data } = await api.get(`/lp612/own/review/${encodeURIComponent(ownId)}/file`, { responseType: 'blob' });
    return data instanceof Blob ? URL.createObjectURL(data) : null;
  } catch {
    return null;
  }
}
