import { portal } from '../../services/api';

/**
 * bd-v0toag.31 — is live moves on for her? Coaching asks on mount, off Record's path, so a teacher
 * outside group D never waits on the hop (final review I-1). Record uses the last answer at once;
 * only with none yet does it wait, at most 1.5 s, and then records as today. A failure is "off"
 * for now and is asked again on the next prefetch.
 */

const WAIT_MS = 1500;
let known: boolean | null = null;
let pending: Promise<boolean> | null = null;

export function prefetchLiveEligible(): Promise<boolean> {
  if (pending) return pending;
  pending = Promise.resolve()
    .then(() => portal.liveEligible())
    .then((r) => !!r && r.on === true, () => false)
    .then((on) => { known = on; pending = null; return on; });
  return pending;
}

export function liveEligibleNow(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((res) => { timer = setTimeout(() => res(false), WAIT_MS); });
  return Promise.race([prefetchLiveEligible(), late]).finally(() => clearTimeout(timer));
}

/** Tests only: start each from no answer. */
export function forgetLiveEligible(): void { known = null; pending = null; }
