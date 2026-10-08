import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useRecordingSession } from './recordingSession';

/**
 * bd-5rz1v.10 — how a lesson plan opens.
 *
 * TODAY'S WAY ("outside"): ask the API for a presigned R2 link and
 * window.open it. On the web that is a new tab. In the Android app (a Capacitor
 * WebView, which has no PDF viewer of its own) it hands the PDF to another app:
 * the portal goes to the background, and Android silences the microphone of a
 * background app — the operator's phone showed exactly that, mid-recording.
 *
 * THE PORTAL'S OWN VIEWER ("in app"): the PDF's bytes come from the portal's
 * own server (GET …/file, a same-origin relay — the R2 bucket's CORS does not
 * cover every portal host) and pdf.js draws them on the page
 * (components/LessonPlanViewer.tsx). Nothing leaves the app.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE SWITCH. 'always' = every lesson plan opens in the portal's viewer │
 * │ (operator, 2026-10-03). 'while-recording' = only while a lesson records.  │
 * │ 'never' = today's way everywhere. Change this line and nothing else.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type InAppMode = 'always' | 'while-recording' | 'never';
export const IN_APP_LESSON_PLANS: InAppMode = 'always';

export function shouldOpenInApp(recording: boolean, mode: InAppMode = IN_APP_LESSON_PLANS): boolean {
  if (mode === 'always') return true;
  if (mode === 'while-recording') return recording;
  return false;
}

/** Which lesson plan: a grades 1-5 catalogue lesson, or a written grades 6-12 lesson. */
export type LessonPlanSource =
  | { lane: 'k5'; lessonId: string; assetKind: 'lesson' | 'answer_key' }
  | { lane: 'g612'; renderId: string };

/**
 * What the viewer is opened with, in the history entry (so Back closes it). `crumb` is the new
 * UI's breadcrumb over the viewer ("Lesson Plans · Day 3", bd-5rz1v.14); the old page ignores it.
 */
export type LessonPlanView = { source: LessonPlanSource; title: string; crumb?: string };

/** bd-5rz1v.14 — how the new Lesson Plans opens one: its breadcrumb, and whether the viewer
 *  REPLACES the page it opens from (a "Preparing…" page that opened it by itself).
 *  bd-fmf24g.3 — `page`: the viewer page to open it on (the teacher v2 Lesson Plans has its own;
 *  default the Curriculum page), and `state`: anything more that page reads from its history entry. */
export type OpenOptions = { crumb?: string; replace?: boolean; page?: string; state?: Record<string, unknown> };

/** The viewer sits over the Curriculum page, where every lesson plan is opened. */
export const LESSON_PLAN_PAGE = '/portal/curriculum';

export function sourceKey(source: LessonPlanSource): string {
  return source.lane === 'k5' ? `k5:${source.lessonId}:${source.assetKind}` : `g612:${source.renderId}`;
}

/** "Not published yet" (1-5) / "still being written" (6-12): an answer, not a fault. */
export class LessonPlanNotReady extends Error {
  constructor() { super('lesson plan not ready'); this.name = 'LessonPlanNotReady'; }
}

/** The PDF's bytes, from the portal's own server. */
export async function fetchLessonPlanPdf(
  source: LessonPlanSource,
  onProgress?: (percent: number) => void,
): Promise<ArrayBuffer> {
  const path = source.lane === 'k5'
    ? `/curriculum/lp/${encodeURIComponent(source.lessonId)}/file`
    : `/lp612/file/${encodeURIComponent(source.renderId)}`;
  try {
    const res = await api.get(path, {
      ...(source.lane === 'k5' ? { params: { kind: source.assetKind } } : {}),
      responseType: 'arraybuffer',
      timeout: 120_000,
      onDownloadProgress: (e: { loaded: number; total?: number }) => {
        if (onProgress && e.total) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      },
    });
    return res.data as ArrayBuffer;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 409) throw new LessonPlanNotReady();
    throw err;
  }
}

/**
 * TODAY'S WAY, unchanged: mint the link, window.open it. 'not_ready' when the
 * API says there is nothing to open (yet); throws on a real failure.
 */
export async function openLessonPlanOutside(source: LessonPlanSource): Promise<'opened' | 'not_ready'> {
  if (source.lane === 'k5') {
    const { data } = await api.get(`/curriculum/lp/${source.lessonId}/pdf`, { params: { kind: source.assetKind } });
    if (data.available && data.url) {
      window.open(data.url, '_blank', 'noopener');
      return 'opened';
    }
    return 'not_ready';
  }
  // `open: 1` — this status call IS an open, so the server records it (bd-5rz1v.15). The same
  // route is the poll that waits for a lesson to be written, which must record nothing.
  const { data } = await api.get(`/lp612/status/${source.renderId}`, { params: { open: 1 } });
  if (data.state === 'ready' && data.url) {
    window.open(data.url, '_blank', 'noopener,noreferrer');
    return 'opened';
  }
  return 'not_ready';
}

/**
 * Open a lesson plan the way the switch says: in the portal's viewer (a history
 * entry over Curriculum, so Back closes it and Curriculum keeps her picks), or
 * today's way. Resolves to what the outside way answered, for its messages.
 */
export function useLessonPlanOpener() {
  const navigate = useNavigate();
  const recording = !!useRecordingSession()?.active;
  return useCallback(async (source: LessonPlanSource, title: string, opts: OpenOptions = {}): Promise<'viewer' | 'opened' | 'not_ready'> => {
    if (shouldOpenInApp(recording)) {
      const lessonPlan: LessonPlanView = opts.crumb ? { source, title, crumb: opts.crumb } : { source, title };
      navigate(opts.page ?? LESSON_PLAN_PAGE, { state: { ...opts.state, lessonPlan }, ...(opts.replace ? { replace: true } : {}) });
      return 'viewer';
    }
    return openLessonPlanOutside(source);
  }, [navigate, recording]);
}
