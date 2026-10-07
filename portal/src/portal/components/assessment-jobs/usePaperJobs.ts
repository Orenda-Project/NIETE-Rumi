/**
 * usePaperJobs — every paper she has asked for on this page, and where each has got to
 * (bd-t5tow).
 *
 * WHY AT PAGE LEVEL
 * -----------------
 * The page has two tabs, Create paper and My papers, and a paper being made is shown in both.
 * The polling used to live inside AssessmentGeneratorPanel; here it belongs to the page, so
 * switching tabs never stops a job being tracked.
 *
 * WHY IT POLLS, AND WHY IT NO LONGER GIVES UP
 * -------------------------------------------
 * Generation is a queued job of about a minute (the model call alone is ~25s).
 * `queued` and `generating` are ordinary answers, not errors — only `failed`
 * draws an apology, and it names the real reason rather than shrugging.
 *
 * The panel used to stop after five minutes with "this is taking longer than it should". A paper
 * that arrived after that never reached her screen, though it was in the database. Now the job
 * is simply checked less often (every 30 s, marked `slow` so My papers can say so), for as long
 * as she keeps the page — a late paper still lands.
 *
 * WHY sessionStorage
 * ------------------
 * A refresh must not lose a paper she is waiting for. Pending and failed jobs are kept for the
 * browser tab's session and picked up again on mount; a ready one is dropped once delivered,
 * since My papers holds it for good. Every read and write is in try/catch: storage can be
 * blocked, full or hand-edited, and none of that may break the page.
 *
 * The key carries her phone number (`assessment-jobs:v1:<phone>`): two teachers can share one
 * school computer, and one must never see — or Try again — the other's papers. Until the user
 * is known nothing is read or written.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { portal } from '../../services/api';
import type { AssessmentSpec } from '../../services/api';
import { FAILURE_FALLBACK } from './failureMessages';

const JOBS_STORAGE_PREFIX = 'assessment-jobs:v1';
export const jobsStorageKey = (userKey: string) => `${JOBS_STORAGE_PREFIX}:${userKey}`;
export const FAST_POLL_MS = 4000;
export const SLOW_POLL_MS = 30_000;
/** The job extends its own SQS visibility to 300s; past that it is slow, not lost. */
export const FAST_WINDOW_MS = 5 * 60 * 1000;

export type PaperJobStatus = 'writing' | 'ready' | 'failed';

export type PaperJob = {
  requestId: string;
  /** The exact body sent to generateAssessment, so Try again re-sends the same request. */
  spec: AssessmentSpec;
  /** e.g. "Grade 4 Science · Plants · 15 questions". */
  label: string;
  startedAt: number;
  status: PaperJobStatus;
  paperId?: string | null;
  errorCode?: string | null;
  slow?: boolean;
};

export type StartResult = { ok: true; job: PaperJob } | { ok: false; error: string };

type Options = {
  /** Whose jobs these are (her phone number); null until known, and then storage is untouched. */
  userKey?: string | null;
  onReady?: (job: PaperJob) => void;
  onFailed?: (job: PaperJob) => void;
};

function readStored(userKey: string | null): PaperJob[] {
  if (!userKey) return [];
  try {
    const raw = sessionStorage.getItem(jobsStorageKey(userKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((j): j is PaperJob => !!j && typeof j === 'object'
      && typeof (j as PaperJob).requestId === 'string'
      && typeof (j as PaperJob).label === 'string'
      && typeof (j as PaperJob).startedAt === 'number'
      && !!(j as PaperJob).spec && typeof (j as PaperJob).spec === 'object'
      && ((j as PaperJob).status === 'writing' || (j as PaperJob).status === 'failed'));
  } catch {
    return [];
  }
}

function writeStored(userKey: string | null, jobs: PaperJob[]) {
  if (!userKey) return;
  try {
    sessionStorage.setItem(
      jobsStorageKey(userKey),
      JSON.stringify(jobs.filter((j) => j.status !== 'ready')),
    );
  } catch {
    /* storage is a convenience: the jobs in memory are what the page shows */
  }
}

export function usePaperJobs({ userKey = null, onReady, onFailed }: Options = {}) {
  const [jobs, setJobs] = useState<PaperJob[]>(() => readStored(userKey));
  const jobsRef = useRef(jobs);
  const userKeyRef = useRef(userKey);
  // Failed jobs whose Try again is in flight — a second press must not make a second paper.
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  const retryingRef = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Bumped on every mount/unmount, so a poll that resolves after an unmount is ignored.
  const generation = useRef(0);

  const onReadyRef = useRef(onReady);
  const onFailedRef = useRef(onFailed);
  onReadyRef.current = onReady;
  onFailedRef.current = onFailed;

  const commit = useCallback((next: PaperJob[]) => {
    jobsRef.current = next;
    setJobs(next);
    writeStored(userKeyRef.current, next);
  }, []);

  const patch = useCallback((requestId: string, change: Partial<PaperJob>) => {
    const next = jobsRef.current.map((j) => (j.requestId === requestId ? { ...j, ...change } : j));
    commit(next);
    return next.find((j) => j.requestId === requestId);
  }, [commit]);

  const clearTimer = useCallback((requestId: string) => {
    const t = timers.current.get(requestId);
    if (t) { clearTimeout(t); timers.current.delete(requestId); }
  }, []);

  // `poll` and `schedule` call each other; the ref breaks the cycle.
  const pollRef = useRef<(requestId: string) => void>(() => {});

  const schedule = useCallback((requestId: string) => {
    const job = jobsRef.current.find((j) => j.requestId === requestId);
    if (!job || job.status !== 'writing') return;
    const slow = Date.now() - job.startedAt >= FAST_WINDOW_MS;
    if (slow && !job.slow) patch(requestId, { slow: true });
    clearTimer(requestId);
    timers.current.set(requestId, setTimeout(
      () => pollRef.current(requestId),
      slow ? SLOW_POLL_MS : FAST_POLL_MS,
    ));
  }, [clearTimer, patch]);

  const poll = useCallback(async (requestId: string) => {
    timers.current.delete(requestId);
    const gen = generation.current;
    const live = () => gen === generation.current
      && jobsRef.current.some((j) => j.requestId === requestId && j.status === 'writing');
    if (!live()) return;

    let res;
    try {
      res = await portal.getAssessmentStatus(requestId);
    } catch {
      // A transport blip must not kill the wait: the job is running on the
      // server regardless of whether this one request got through.
      if (live()) schedule(requestId);
      return;
    }
    if (!live()) return;

    if (res.status === 'ready' && res.paperId) {
      const job = patch(requestId, { status: 'ready', paperId: res.paperId, slow: false });
      if (job) onReadyRef.current?.(job);
      return;
    }
    if (res.status === 'failed' || res.status === 'not_found') {
      const job = patch(requestId, {
        status: 'failed',
        errorCode: res.status === 'failed' ? (res.errorCode ?? null) : null,
      });
      if (job) onFailedRef.current?.(job);
      return;
    }
    // queued | generating — keep waiting.
    schedule(requestId);
  }, [patch, schedule]);
  pollRef.current = poll;

  // A different teacher (or the first time we learn who she is): her own stored jobs, not the
  // last one's. Jobs started before she was known are kept and saved under her key.
  useEffect(() => {
    if (userKeyRef.current === userKey) return;
    const carried = userKeyRef.current === null ? jobsRef.current : [];
    userKeyRef.current = userKey;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
    generation.current += 1;
    const stored = readStored(userKey).filter((j) => !carried.some((c) => c.requestId === j.requestId));
    commit([...stored, ...carried]);
    jobsRef.current.filter((j) => j.status === 'writing').forEach((j) => { poll(j.requestId); });
  }, [userKey, commit, poll]);

  // Resume the writing jobs restored from storage; stop everything on unmount.
  useEffect(() => {
    generation.current += 1;
    const pending = timers.current;
    jobsRef.current.filter((j) => j.status === 'writing').forEach((j) => { poll(j.requestId); });
    return () => {
      generation.current += 1;
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, [poll]);

  const start = useCallback(async (spec: AssessmentSpec, label: string): Promise<StartResult> => {
    let res;
    try {
      res = await portal.generateAssessment(spec);
    } catch (e) {
      const message = (e as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      return { ok: false, error: message || FAILURE_FALLBACK };
    }
    if (!res?.success || !res.requestId) {
      return { ok: false, error: res?.error || FAILURE_FALLBACK };
    }
    const job: PaperJob = {
      requestId: res.requestId, spec, label, startedAt: Date.now(), status: 'writing',
    };
    commit([...jobsRef.current, job]);
    poll(job.requestId);
    return { ok: true, job };
  }, [commit, poll]);

  const dismiss = useCallback((requestId: string) => {
    clearTimer(requestId);
    commit(jobsRef.current.filter((j) => j.requestId !== requestId));
  }, [clearTimer, commit]);

  /**
   * Re-send a failed job's exact request; the failed row is replaced only once it starts.
   * A retry already in flight for this job returns `null` and sends nothing.
   */
  const retry = useCallback(async (requestId: string): Promise<StartResult | null> => {
    if (retryingRef.current.has(requestId)) return null;
    const job = jobsRef.current.find((j) => j.requestId === requestId);
    if (!job) return { ok: false, error: FAILURE_FALLBACK };
    retryingRef.current.add(requestId);
    setRetrying(new Set(retryingRef.current));
    try {
      const result = await start(job.spec, job.label);
      if (result.ok) dismiss(requestId);
      return result;
    } finally {
      retryingRef.current.delete(requestId);
      setRetrying(new Set(retryingRef.current));
    }
  }, [dismiss, start]);

  return { jobs, start, retry, dismiss, retrying };
}
