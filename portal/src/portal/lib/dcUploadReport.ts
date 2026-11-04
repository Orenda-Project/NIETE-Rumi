import { browserEnv, getApiBaseUrl } from '@/lib/runtime';

/**
 * bd-1d6g8o — ICT IAB row 19: a Digital Coach Submit that failed says WHY, to the logs (since bd-bmc9a0.1 the DC one
 * screen says it too: "No internet" only when offline). The server answered every request it saw with 200; the failure was in the phone, uploading a file
 * straight to storage, and the page threw the real error away. This reports the step, the file (kind, its place,
 * size, type), the HTTP status or the browser's reason, and how long it ran. No names, no file names. Fire-and-forget:
 * nothing waits on it and nothing it does can throw into the page (the same text/plain + keepalive send the app
 * funnel uses, so it also works from the Android app's https://localhost origin).
 */
export type SendFailure = {
  /** bd-bmc9a0.1: 'read' — reading a picked file into memory, before anything is sent. */
  stage: 'read' | 'presign' | 'upload' | 'start';
  kind: 'audio' | 'lesson_plan' | 'photo' | null;
  item: number;
  items: number;
  status: number | null;
  /** bd-bmc9a0.1: 'unreadable' — the phone could not read the file she picked. */
  reason: 'http' | 'network' | 'abort' | 'unknown' | 'unreadable';
  sizeBytes: number;
  /** The MIME type without parameters ("audio/webm;codecs=opus" → "audio/webm"), so the server can keep it. */
  type: string;
  elapsedMs: number;
  /**
   * bd-bmc9a0.1 — what tells "the connection dropped" from "the phone refused the request": how many bytes of the
   * failed part the browser had sent (0 = nothing left the phone), whether the phone said it was online, and what was
   * sent — 'copy' (an in-memory copy of a picked file), 'slice' (a slice of a large one), 'blob' (the page's own Blob,
   * an in-app recording) or 'none' (it failed before a body existed).
   */
  sentBytes: number;
  online: boolean;
  sentAs: 'copy' | 'slice' | 'blob' | 'none';
};

export function reportSendFailure(f: SendFailure): void {
  try {
    const body = JSON.stringify({ ...f, b: browserEnv() });
    void fetch(`${getApiBaseUrl()}/funnel/dc-upload-failed`, {
      method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'include', keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}

/** The HTTP status and reason of a failed step: an axios error (presign, start) or uploadToR2's Error. */
export function failureOf(err: unknown): { status: number | null; reason: SendFailure['reason'] } {
  const s = (err as { response?: { status?: number } })?.response?.status;
  if (typeof s === 'number') return { status: s, reason: 'http' };
  const m = String((err as { message?: string })?.message || '');
  const code = m.match(/\((\d{3})\)/);
  if (code) return { status: Number(code[1]), reason: 'http' };
  if (/abort/i.test(m)) return { status: null, reason: 'abort' };
  if (/network/i.test(m)) return { status: null, reason: 'network' };
  return { status: null, reason: 'unknown' };
}
