import type { ObserveNote } from "../../services/api";

/**
 * bd-o15qnr.27 (v6) — the Observation Notes typed while a visit records, held beside the app's recording session (memory
 * only, as the recording's draft is: coach/observeDraft.ts). With v6 the recording keeps going while the coach opens
 * other pages, so the record screen can unmount and come back; its notes must not go with it. Stop hands them to Check
 * and send (observeDraft setNotes) and lets go of them here.
 */
const live = new Map<string, ObserveNote[]>();

export function getLiveNotes(visitId: string): ObserveNote[] {
  return [...(live.get(visitId) || [])];
}

export function setLiveNotes(visitId: string, notes: readonly ObserveNote[]): void {
  if (notes.length) live.set(visitId, [...notes]);
  else live.delete(visitId);
}

export function clearLiveNotes(visitId: string): void {
  live.delete(visitId);
}
