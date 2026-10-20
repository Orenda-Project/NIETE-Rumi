import { browserEnv, getApiBaseUrl } from '@/lib/runtime';

/**
 * bd-1d6g8o — ICT IAB row 19: a Digital Coach Submit that failed says WHY, to the logs (the page still says "No
 * internet"). The server answered every request it saw with 200; the failure was in the phone, uploading a file
 * straight to storage, and the page threw the real error away. This reports the step, the file (kind, its place,
 * size, type), the HTTP status or the browser's reason, and how long it ran. No names, no file names. Fire-and-forget:
 * nothing waits on it and nothing it does can throw into the page (the same text/plain + keepalive send the app
 * funnel uses, so it also works from the Android app's https://localhost origin).
 */
export type SendFailure = {
  stage: 'presign' | 'upload' | 'start';
  kind: 'audio' | 'lesson_plan' | 'photo' | null;
  item: number;
  items: number;
  status: number | null;
  reason: 'http' | 'network' | 'abort' | 'unknown';
  sizeBytes: number;
  type: string;
  elapsedMs: number;
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
