import type { KeptRecording } from "./recordingStore";
import { DC_MIN_SECONDS } from "./coachingUpload";

/**
 * bd-91htd2 (queue #292, NIETE prod 26 Nov) — which recording kept on the phone may come back as a PAUSED lesson.
 *
 * Since portal_recording_resume = "teachers" (25 Nov 23:41 PKT) the DC screen reopened the newest kept recording paused,
 * whatever it was: one she had STOPPED herself and not sent, one from days before. Resume then carried on in it, so
 * today's lesson was joined onto an old one (26 Nov morning: 110 of 117 reopened recordings were older than the release,
 * 63 were resumed; 6 joined 15+ old minutes to 10+ new). And every reopen logged a `cut` (235 for 80 starts).
 *
 *   resume  cut by a kill (not stopped by her) and last saved within RESUME_WINDOW_MS: the lesson she was teaching
 *   send    otherwise, when long enough to send (DC_MIN_SECONDS): hers to send, as Stop would give it; never resumed
 *   none    otherwise (a short take, stopped or too old): the screen as before the switch
 */

export const RESUME_WINDOW_MS = 60 * 60_000;

type Beat = { t?: unknown; st?: unknown };
/** Only its row and heartbeats are read (no audio): a light summary of a kept recording will do. */
export type KeptSummary = Pick<KeptRecording, "meta" | "beats">;

const lastBeat = (k: KeptSummary): Beat | null => (k.beats && k.beats.length ? (k.beats[k.beats.length - 1] as Beat) : null);

/** When it was last saved: its last heartbeat; with none (saved before 25 Nov), its start plus its length. */
export function lastSavedAt(k: KeptSummary): number {
  const b = lastBeat(k);
  if (b && typeof b.t === "number") return b.t;
  const start = Date.parse(k.meta.startedAt);
  return (Number.isFinite(start) ? start : 0) + (k.meta.elapsedMs || 0);
}

/**
 * Cut by a kill, not stopped by her. `finished` is set by Stop and is not cleared by a later Resume (appendChunk keeps
 * the row's flag), so a last heartbeat taken while recording or paused also counts as a cut.
 */
export function wasCut(k: KeptSummary): boolean {
  if (!k.meta.finished) return true;
  const st = lastBeat(k)?.st;
  return st === "r" || st === "p";
}

export type KeptOffer = "resume" | "send" | "none";

export function keptOffer(k: KeptSummary, now: number): KeptOffer {
  if (wasCut(k) && now - lastSavedAt(k) <= RESUME_WINDOW_MS) return "resume";
  if ((k.meta.elapsedMs || 0) >= DC_MIN_SECONDS * 1000) return "send";
  return "none";
}
