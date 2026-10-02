/**
 * bd-5rz1v — MediaRecorder's WebM carries NO duration in its header. ffprobe
 * then reports "N/A", the pipeline stores no length for the lesson, and the
 * short-recording warning never fires; a browser cannot seek in it either.
 * The length is known here (the recorder's clock), so it is written in.
 */

import fixWebmDuration from "fix-webm-duration";

/**
 * Write `durationMs` into a WebM recording's header — at the end of a
 * recording, and for one recovered from the phone after a reload. Anything
 * else, or a file the patcher cannot read, is returned unchanged.
 */
export async function withDuration(blob: Blob, ext: string, durationMs: number): Promise<Blob> {
  if (ext !== '.webm' || !(durationMs > 0)) return blob;
  try {
    return await fixWebmDuration(blob, durationMs, { logger: false });
  } catch {
    return blob;
  }
}

