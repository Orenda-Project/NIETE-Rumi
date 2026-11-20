import type { ObserveNote } from "../services/api";

/**
 * bd-o15qnr.9 — the recording waiting on Check and send, per visit.
 *
 * Record live and Upload recording each hand their audio to Check and send on a
 * different route, so it is held here in memory between the two. A recorded
 * lesson is ALSO on the phone (recordingStore, with whose it is in
 * coachObserve's rememberRecording), so a reload on Check and send can still
 * find it; an uploaded file is simply chosen again.
 *
 * bd-ra8xu.60 — her Observation Notes ride beside the audio, per visit, in memory as the audio is: the ones typed on
 * Record (each with the recording clock) and the ones added on Check and send. They belong to THIS recording: a new
 * recording or file (setDraft) starts with none, and clearDraft (Redo, or sent) lets go of both.
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

/** bd-ra8xu.60 — the caps the dashboard and the bot hold notes to (observeNotesPick, observation-notes.js). */
export const NOTE_CAP = 600;
export const MAX_NOTES = 40;

const drafts = new Map<string, DraftAudio>();
const notes = new Map<string, ObserveNote[]>();

export function setDraft(visitId: string, audio: DraftAudio): void {
  drafts.set(visitId, audio);
  notes.delete(visitId);
}

export function getDraft(visitId: string): DraftAudio | null {
  return drafts.get(visitId) || null;
}

export function clearDraft(visitId: string): void {
  drafts.delete(visitId);
  notes.delete(visitId);
}

/** bd-ra8xu.60 — her notes for this visit's recording (set after setDraft: a new recording starts with none). */
export function setNotes(visitId: string, list: readonly ObserveNote[]): void {
  if (list.length) notes.set(visitId, list.slice(0, MAX_NOTES));
  else notes.delete(visitId);
}

export function getNotes(visitId: string): ObserveNote[] {
  return [...(notes.get(visitId) || [])];
}

export function clearNotes(visitId: string): void {
  notes.delete(visitId);
}

/**
 * bd-ra8xu.60 — `typed` added to `list`: trimmed, a blank one ignored, each cut at NOTE_CAP characters, MAX_NOTES in all.
 * `perLine` (the Check and send box): one note per line, as the bot reads the WhatsApp box (notesFromText).
 * The stamp is the same for each: where it was typed, when, and (on Record) the recording clock.
 */
export function withTyped(
  list: readonly ObserveNote[],
  typed: string,
  stamp: { source: ObserveNote["source"]; typed_at: string; rec_time?: string },
  perLine = false,
): ObserveNote[] {
  const pieces = (perLine ? String(typed).split(/\r?\n/) : [String(typed)]).map((t) => t.trim()).filter(Boolean);
  const out = [...list];
  for (const piece of pieces) {
    if (out.length >= MAX_NOTES) break;
    const text = Array.from(piece).slice(0, NOTE_CAP).join("");
    out.push(stamp.rec_time
      ? { text, rec_time: stamp.rec_time, source: stamp.source, typed_at: stamp.typed_at }
      : { text, source: stamp.source, typed_at: stamp.typed_at });
  }
  return out;
}
