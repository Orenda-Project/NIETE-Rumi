import { browserEnv, getApiBaseUrl } from '@/lib/runtime';

/**
 * bd-zrdvmi.21 — ICT Feedback sheet, GB row 3: the lesson-plan reader (components/LessonPlanViewer) sometimes shows
 * "Can't show it here". The server answered every file request with 200 in about a second, so the failure is in the
 * phone, and the reader threw the reason away. This reports WHICH step failed — 'download' (the file from the portal's
 * server), 'reader' (loading pdf.js), 'read' (pdf.js reading the file), 'draw' (drawing page 1) — and why: the HTTP
 * status or the browser's reason, pdf.js's own error name, the file's size, page 1's shape in points, how long it ran,
 * and whether the phone said it was online. No names, no plan ids. Fire-and-forget, like dcUploadReport.ts.
 */
export type LpViewerFailure = {
  stage: 'download' | 'reader' | 'read' | 'draw';
  lane: 'k5' | 'g612' | 'paper';
  reason: 'http' | 'network' | 'timeout' | 'abort' | 'unknown';
  status: number | null;
  errName: string | null;
  sizeBytes: number;
  pages: number;
  pageWidth: number;
  pageHeight: number;
  elapsedMs: number;
  online: boolean | null;
};

export function reportViewerFailure(f: LpViewerFailure): void {
  try {
    const body = JSON.stringify({ ...f, b: browserEnv() });
    void fetch(`${getApiBaseUrl()}/funnel/lp-viewer-failed`, {
      method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'include', keepalive: true,
    }).catch(() => {});
  } catch {
    /* the report never decides anything */
  }
}

/** Why a step failed: an axios error (status, timeout, network), an abort, or the thrown error's own name. */
export function viewerReasonOf(err: unknown): Pick<LpViewerFailure, 'reason' | 'status' | 'errName'> {
  const e = (err || {}) as { response?: { status?: number }; code?: string; name?: string; message?: string };
  const name = typeof e.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name) && e.name !== 'Error' ? e.name : null;
  if (typeof e.response?.status === 'number') return { reason: 'http', status: e.response.status, errName: null };
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(String(e.message || ''))) {
    return { reason: 'timeout', status: null, errName: null };
  }
  if (e.code === 'ERR_CANCELED' || name === 'AbortError' || name === 'CanceledError') return { reason: 'abort', status: null, errName: name };
  if (e.code === 'ERR_NETWORK' || /network/i.test(String(e.message || ''))) return { reason: 'network', status: null, errName: null };
  return { reason: 'unknown', status: null, errName: name };
}

/** The phone's own idea of whether it is online; null where it cannot say. */
export function onlineNow(): boolean | null {
  try { return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : null; } catch { return null; }
}
