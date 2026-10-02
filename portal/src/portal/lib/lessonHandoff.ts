/**
 * bd-5rz1v.7 — the recording she picked on Coaching, handed to the record page.
 *
 * Coaching opens the phone's picker itself, from the tap in its "Send a lesson"
 * sheet: a picker opened later, after the next page has loaded, can be refused
 * for want of a fresh tap. The File then waits here, in memory, for the record
 * page to take it. A reload loses it, and the record page sends her back to
 * Coaching to choose again.
 */

let pending: File | null = null;

export function handOffRecording(file: File): void {
  pending = file;
}

/** The handed-over recording, once: taking it clears it. */
export function takeHandedOffRecording(): File | null {
  const file = pending;
  pending = null;
  return file;
}
