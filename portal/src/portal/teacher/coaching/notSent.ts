import { isOffline, type SendError } from '../../lib/coachingSend';
import type { CoachingCopy } from './copy';

type Words = Pick<CoachingCopy, 'noInternet' | 'notSent' | 'recordingNotSent' | 'planNotSent' | 'photoNotSent'>;

/**
 * bd-bmc9a0.1 — ICT IAB rows 28–29: a send that did not go. "No internet" only when the phone says it is offline; else
 * the part that did not go (Recording / Lesson plan / Photo N), or "Not sent" when every file arrived and starting the
 * analysis failed. It said "No internet" on strong Wi-Fi for 39 teachers whose picked file the app could not send.
 *
 * bd-bsc0ox (queue #200) — a file the phone would not read is about the file, offline or not: it names the part (the
 * page adds "File will not open"), never "No internet". Shared by the one screen and the send page.
 */
export function notSentTitle(f: SendError, C: Words): string {
  const d = f.detail;
  if (!(d && d.unreadable) && (d ? d.offline : isOffline())) return C.noInternet;
  if (!d || !d.part) return C.notSent;
  if (d.part.kind === 'audio') return C.recordingNotSent;
  if (d.part.kind === 'lesson_plan') return C.planNotSent;
  return C.photoNotSent(d.part.photo);
}
