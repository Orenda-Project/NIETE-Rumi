import { useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import type { AssessmentSpec } from '../../services/api';
import { usePaperJobs, type PaperJob, type StartResult } from '../../components/assessment-jobs/usePaperJobs';
import type { V2Spec } from './model';

/**
 * bd-fmf24g.6 — her papers being made, as today's Assessment page tracks them (usePaperJobs: polled until
 * ready or failed, kept for the tab's session under her phone number, so Being made survives a refresh
 * and two teachers on one computer never see each other's). The v2 spec carries the fields the create
 * route now reads (seenCount, per-type counts, totalMarks); the shared type predates them, hence the cast.
 */
export function useJobs(opts: { onReady?: (job: PaperJob) => void } = {}) {
  const { user } = useAuth();
  const jobs = usePaperJobs({ userKey: user?.phoneNumber || null, onReady: opts.onReady });
  const { start: startShared } = jobs;
  const start = useCallback(
    (spec: V2Spec, label: string): Promise<StartResult> => startShared(spec as unknown as AssessmentSpec, label),
    [startShared],
  );
  return { ...jobs, start };
}

export type { PaperJob };
