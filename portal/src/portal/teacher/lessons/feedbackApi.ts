import { useEffect, useState } from 'react';
import api from '../../services/api';
import { readConfigShared } from '../../lib/useNewUi';

/**
 * The survey bar's server side (GET / POST /api/portal/lp/feedback) and its switch (GET /config
 * features.lpFeedbackBar: portal_lp_feedback_bar with the teacher app on; the shared, cached read, fail-closed).
 * The user is the session's on the server; the app sends only the plan and the answer. Never throws.
 */
export type UsedInClass = 'taught' | 'planned' | 'not_yet';
export type PlanFeedback = { useful: boolean; usedInClass: UsedInClass | null };
export type FeedbackPlan = { kind: 'k5' | 'g612'; ref: string };
export type FeedbackAnswer = { useful: boolean } | { usedInClass: UsedInClass } | { reasonText: string };

/** Ten seconds with no answer is "Not saved" (never a spinner). */
export const SAVE_TIMEOUT_MS = 10_000;
/** The longest reason she can type; the server takes up to 300. */
export const REASON_MAX = 280;

/** null while /config is read, then true only for a real `true`. */
export function useLpFeedbackBar(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn((cfg?.features as { lpFeedbackBar?: unknown } | undefined)?.lpFeedbackBar === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

const usedOf = (v: unknown): UsedInClass | null => (v === 'taught' || v === 'planned' || v === 'not_yet' ? v : null);
const feedbackOf = (v: unknown): PlanFeedback | null => {
  const f = v as { useful?: unknown; usedInClass?: unknown } | null;
  return f && typeof f.useful === 'boolean' ? { useful: f.useful, usedInClass: usedOf(f.usedInClass) } : null;
};

/** Her answer for this plan: null (none yet), her answer, or 'off' (switch off, or it could not be read: no bar). */
export async function fetchPlanFeedback(plan: FeedbackPlan): Promise<PlanFeedback | null | 'off'> {
  try {
    const { data } = await api.get('/lp/feedback', { params: plan, timeout: SAVE_TIMEOUT_MS });
    return data?.success === true ? feedbackOf(data.feedback) : 'off';
  } catch {
    return 'off';
  }
}

export type SaveResult =
  | { ok: true; feedback: PlanFeedback | null }
  | { ok: false; reason: 'offline' | 'failed' | 'gone' };

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Save one answer. 'gone' = the switch is off on the server (the bar goes); 'offline' = no connection. */
export async function savePlanFeedback(plan: FeedbackPlan, answer: FeedbackAnswer): Promise<SaveResult> {
  if (offline()) return { ok: false, reason: 'offline' };
  try {
    const { data } = await api.post('/lp/feedback', { ...plan, ...answer }, { timeout: SAVE_TIMEOUT_MS });
    if (data?.success !== true) return { ok: false, reason: 'failed' };
    return { ok: true, feedback: feedbackOf(data.feedback) };
  } catch (err) {
    const r = (err as { response?: { status?: number } } | null)?.response;
    if (r?.status === 404) return { ok: false, reason: 'gone' };
    if (!r && offline()) return { ok: false, reason: 'offline' };
    if (!r && (err as { code?: string } | null)?.code === 'ERR_NETWORK') return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'failed' };
  }
}
