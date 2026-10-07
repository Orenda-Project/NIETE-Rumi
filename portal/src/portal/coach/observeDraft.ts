/**
 * bd-o15qnr.9 — the recording waiting on Check and send, per visit.
 *
 * Record live and Upload recording each hand their audio to Check and send on a
 * different route, so it is held here in memory between the two. A recorded
 * lesson is ALSO on the phone (recordingStore, with whose it is in
 * coachObserve's rememberRecording), so a reload on Check and send can still
 * find it; an uploaded file is simply chosen again.
 */

export type DraftAudio = {
  blob: Blob;
  filename: string;
  durationMs: number | null;
  /** The phone copy's id for a recorded lesson; null for a chosen file. */
  recordingId: string | null;
  label: string;
  sub: string;
};

const drafts = new Map<string, DraftAudio>();

export function setDraft(visitId: string, audio: DraftAudio): void {
  drafts.set(visitId, audio);
}

export function getDraft(visitId: string): DraftAudio | null {
  return drafts.get(visitId) || null;
}

export function clearDraft(visitId: string): void {
  drafts.delete(visitId);
}
