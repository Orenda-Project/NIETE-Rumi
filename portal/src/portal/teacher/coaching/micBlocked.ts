import type { CoachingCopy } from './copy';

/**
 * bd-qccbrv — ICT feedback (IAB Experience View, row 18), operator-approved mockup: the line under "Microphone blocked"
 * says what to do for what actually happened.
 *   browserBlocked  the browser reports the microphone 'denied' for this site (Chrome remembers a Block): Try again
 *                   cannot bring the prompt back, so say where to unblock it — wins over everything else
 *   retried         Try again was tapped and refused again: in WhatsApp's browser that is usually WhatsApp itself
 *                   without the phone's microphone permission (it cannot report it), elsewhere the browser or phone
 *   otherwise       the first refusal: Try again brings the prompt back
 */
export function micBlockedLine(
  s: { browserBlocked: boolean; retried: boolean; inApp: boolean },
  C: Pick<CoachingCopy, 'micBlockedHint' | 'micBrowserBlocked' | 'micStillBlockedWhatsApp' | 'micStillBlocked'>,
): string {
  if (s.browserBlocked) return C.micBrowserBlocked;
  if (s.retried) return s.inApp ? C.micStillBlockedWhatsApp : C.micStillBlocked;
  return C.micBlockedHint;
}

/** True when the browser says the microphone is blocked for this site. Browsers that cannot say → false. */
export async function micPermissionDenied(): Promise<boolean> {
  try {
    const p = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!p || typeof p.query !== 'function') return false;
    const s = await p.query({ name: 'microphone' as PermissionName });
    return s.state === 'denied';
  } catch {
    return false;
  }
}
