import { useSyncExternalStore } from 'react';
import { SendError, type PlanChoice } from '../../lib/coachingSend';
import { forgetRecording, sendObservation } from '../../lib/coachObserve';
import { deleteRecording } from '../../lib/recordingStore';
import { itemId } from '../../teacher/notices/model';
import { noticeTracker } from '../../teacher/notices/tracker';
import { clearDraft } from '../observeDraft';

/**
 * bd-4404s7.4 — the coach's observation, sent IN THE BACKGROUND.
 *
 * Check and send hands the observation here and she can go anywhere: this module (not the page) holds the files and
 * runs the existing pipeline (coachObserve.sendObservation: every file to R2, then the analysis starts), so a page
 * change does not stop it. It reports to the notices machinery the teacher app already has (teacher/notices): the
 * strip above the menu while it sends ("Observation · Ayesha Bibi — Sending · 62%"), the ready banner when it has
 * arrived, and the failed banner with Try again. A failure is the app's alone; nothing here tells WhatsApp.
 *
 * What it keeps: the job (and its files) in memory, per visit, until it is sent. A recording is also still on the
 * phone (recordingStore) until the server has it, so after a reload Check and send finds it and she sends again. A
 * job is deleted from the phone only once the server has accepted it.
 *
 * The page that shows a job (Sending) reads it from here (`useSendJob`), so it stays true after the notices let go
 * of the item (they do, once she is looking at it).
 */

export type SendState = 'sending' | 'sent' | 'failed';

export interface SendJob {
  visitId: string;
  teacherExtId: string;
  schoolExtId: string | null;
  /** Data, as the API gave it. */
  teacherName: string;
  /** The visit's day, YYYY-MM-DD. */
  visitDay: string | null;
  durationMs: number | null;
  /** The phone's copy of a recorded observation; null for a file she chose. */
  recordingId: string | null;
  state: SendState;
  /** 0..100 */
  pct: number;
  /** The observation the server started, once it has accepted it. */
  observationId: string | null;
  /** Why it failed: a SendError's kind, or the server's own reason (`not_your_teacher`). */
  errorCode: string | null;
}

export interface SendArgs {
  visitId: string;
  teacherExtId: string;
  schoolExtId: string | null;
  teacherName: string;
  visitDay: string | null;
  durationMs: number | null;
  recordingId: string | null;
  audio: { blob: Blob; filename: string };
  plan: PlanChoice | null;
  photos: File[];
}

/** Where the Sending page for a visit is (the strip's tap, and the page the banner is quiet on). */
export const sendingPath = (visitId: string) => `/portal/coach/visit/${visitId}/sending`;

type Held = { job: SendJob; args: SendArgs };

const held = new Map<string, Held>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

function change(visitId: string, patch: Partial<SendJob>): SendJob | null {
  const h = held.get(visitId);
  if (!h) return null;
  h.job = { ...h.job, ...patch };
  emit();
  return h.job;
}

const errorCodeOf = (err: unknown): string => {
  if (err instanceof SendError) return err.message && err.message !== err.kind && err.kind === 'refused' ? err.message : err.kind;
  return 'network';
};

/** Follow the job in the notices: a new item, or the same visit's earlier one (failed) started over. */
function track(job: SendJob) {
  const id = itemId('observation', job.visitId);
  if (noticeTracker.getItems().some((i) => i.id === id)) {
    noticeTracker.update(id, {
      state: 'making', progress: 0, errorCode: null, announced: false, startedAt: Date.now(), readyAt: null, observationId: null,
      title: job.teacherName, visitDay: job.visitDay, durationMs: job.durationMs,
    });
    return;
  }
  noticeTracker.track({
    kind: 'observation', ref: job.visitId, title: job.teacherName, grade: null, subject: null, questions: null,
    waitHref: sendingPath(job.visitId), visitId: job.visitId, visitDay: job.visitDay, durationMs: job.durationMs,
  });
}

async function run(visitId: string): Promise<void> {
  const h = held.get(visitId);
  if (!h) return;
  const { args } = h;
  const id = itemId('observation', visitId);
  let last = -1;
  try {
    const out = await sendObservation(
      {
        teacherExtId: args.teacherExtId, schoolExtId: args.schoolExtId, audio: args.audio, plan: args.plan, photos: args.photos,
      },
      undefined, undefined,
      (pct) => {
        const whole = Math.max(0, Math.min(100, Math.round(pct)));
        if (whole === last) return;
        last = whole;
        change(visitId, { pct: whole });
        noticeTracker.update(id, { progress: whole / 100 });
      },
    );
    // The server has it: only now is the phone's copy let go.
    if (args.recordingId) {
      try { await deleteRecording(args.recordingId); } catch { /* already gone */ }
      forgetRecording(args.recordingId);
    }
    clearDraft(visitId);
    change(visitId, { state: 'sent', pct: 100, observationId: out.coachingSessionId, errorCode: null });
    noticeTracker.update(id, { state: 'ready', progress: 1, readyAt: Date.now(), observationId: out.coachingSessionId });
  } catch (err) {
    const code = errorCodeOf(err);
    change(visitId, { state: 'failed', errorCode: code });
    noticeTracker.update(id, { state: 'failed', errorCode: code });
  }
}

/**
 * Start sending. One at a time per visit: a visit already sending keeps its job (a second tap does not send twice).
 * Returns at once; the upload carries on after the page that asked has gone.
 */
export function startSend(args: SendArgs): SendJob {
  const existing = held.get(args.visitId);
  if (existing && existing.job.state === 'sending') return existing.job;
  const job: SendJob = {
    visitId: args.visitId, teacherExtId: args.teacherExtId, schoolExtId: args.schoolExtId, teacherName: args.teacherName,
    visitDay: args.visitDay, durationMs: args.durationMs, recordingId: args.recordingId,
    state: 'sending', pct: 0, observationId: null, errorCode: null,
  };
  held.set(args.visitId, { job, args });
  emit();
  track(job);
  void run(args.visitId);
  return job;
}

/** Send the same observation again (Try again): the same files, the same visit. */
export function retrySend(visitId: string): boolean {
  const h = held.get(visitId);
  if (!h || h.job.state !== 'failed') return false;
  const job = change(visitId, { state: 'sending', pct: 0, errorCode: null });
  if (job) track(job);
  void run(visitId);
  return true;
}

export const getJob = (visitId: string): SendJob | null => held.get(visitId)?.job ?? null;

/** The job for a visit, kept current. */
export function useSendJob(visitId: string): SendJob | null {
  return useSyncExternalStore(subscribe, () => getJob(visitId), () => null);
}

/** Tests: forget every job. */
export function resetSender(): void {
  held.clear();
  emit();
}

// The banner's and the strip's Try again come to the same place.
noticeTracker.registerRetry('observation', async (id) => (
  retrySend(id.slice('observation:'.length)) ? { ok: true } : { ok: false, error: '' }
));
