import { useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { AssessmentSpec } from '../../services/api';
import { usePaperJobs, type PaperJob, type StartResult } from '../../components/assessment-jobs/usePaperJobs';
import { itemId } from '../notices/model';
import { noticeTracker } from '../notices/tracker';
import type { V2Spec } from './model';
import { requestPath } from './paths';

/**
 * bd-fmf24g.6 — her papers being made, as today's Assessment page tracks them (usePaperJobs: polled until
 * ready or failed, kept for the tab's session under her phone number, so Being made survives a refresh
 * and two teachers on one computer never see each other's). The v2 spec carries the fields the create
 * route now reads (seenCount, per-type counts, totalMarks); the shared type predates them, hence the cast.
 *
 * bd-fmf24g.15 — and every paper started here is handed to the shell's tracker (teacher/notices), which
 * follows it on every screen: the strip of what is being made, the ready banner. Try again follows the new
 * request; Dismiss lets the failed one go from the strip.
 */

/** Hand a job to the shell. `subject` is the name she knows ("Science"); the spec only has the key. */
function follow(job: PaperJob, subject: string | null): void {
  const spec = job.spec as unknown as V2Spec;
  noticeTracker.track({
    kind: 'paper',
    ref: job.requestId,
    title: job.label,
    grade: spec.grade ?? null,
    subject,
    questions: spec.questionCount ?? null,
    waitHref: requestPath(job.requestId),
    spec: job.spec,
  });
}

export function useJobs(opts: { onReady?: (job: PaperJob) => void } = {}) {
  const { user } = useAuth();
  const jobs = usePaperJobs({ userKey: user?.phoneNumber || null, onReady: opts.onReady });
  const { start: startShared, retry: retryShared, dismiss: dismissShared } = jobs;
  const start = useCallback(
    async (spec: V2Spec, label: string, subject?: string | null): Promise<StartResult> => {
      const res = await startShared(spec as unknown as AssessmentSpec, label);
      if (res.ok) follow(res.job, subject ?? spec.subject ?? null);
      return res;
    },
    [startShared],
  );
  const retry = useCallback(
    async (requestId: string): Promise<StartResult | null> => {
      const before = noticeTracker.getItems().find((i) => i.id === itemId('paper', requestId));
      const res = await retryShared(requestId);
      if (res && res.ok) {
        noticeTracker.settle(itemId('paper', requestId));
        follow(res.job, before?.subject ?? (res.job.spec as unknown as V2Spec).subject ?? null);
      }
      return res;
    },
    [retryShared],
  );
  const dismiss = useCallback((requestId: string) => {
    noticeTracker.settle(itemId('paper', requestId));
    dismissShared(requestId);
  }, [dismissShared]);
  return { ...jobs, start, retry, dismiss };
}

export type { PaperJob };
