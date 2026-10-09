import { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * bd-fmf24g.30 — what ShareActions reads and writes: /api/portal/share/… (dashboard/routes/portal-share.routes.js).
 * The bot decides everything (is a template configured for this kind on this deployment, is it hers, what did Meta
 * answer); nothing here sends or guesses. A failure to reach the server is `failed`, NEVER `sent`.
 */
export type ShareKind = 'lesson' | 'paper' | 'dc' | 'observation';
export type ShareResult = { status: 'sent'; at?: string } | { status: 'failed' } | { status: 'unavailable' };

/** Send one item to her WhatsApp as a template. Never throws. */
export async function shareToWhatsApp(kind: ShareKind, id: string): Promise<ShareResult> {
  try {
    const { data } = await api.post('/share/whatsapp', { kind, id });
    if (data?.status === 'sent') return { status: 'sent', ...(typeof data.at === 'string' ? { at: data.at } : {}) };
    if (data?.status === 'unavailable') return { status: 'unavailable' };
    return { status: 'failed' };
  } catch (err) {
    // 404 = the teacher app is off for her (nothing to send with); anything else is a send that did not happen.
    const status = (err as { response?: { status?: number } })?.response?.status;
    return status === 404 ? { status: 'unavailable' } : { status: 'failed' };
  }
}

type Availability = Record<ShareKind, boolean>;
let pending: Promise<Availability | null> | null = null;

/** Which kinds this deployment can send. Read once per page load; null when it cannot be read. */
function readAvailability(): Promise<Availability | null> {
  if (!pending) {
    // Promise.resolve().then: a read that throws (or a test double that returns nothing) is just "cannot read".
    pending = Promise.resolve().then(() => api.get('/share/availability'))
      .then((res) => (res?.data?.kinds ? (res.data.kinds as Availability) : null))
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

/** true / false once known; null while it is being read. Unknown (an error) reads as false: the button stays off. */
export function useShareAvailable(kind: ShareKind): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readAvailability().then((a) => { if (live) setOn(a ? a[kind] === true : false); });
    return () => { live = false; };
  }, [kind]);
  return on;
}

/** Test seam: forget the cached read. */
export function resetShareAvailability(): void { pending = null; }
