import { useCallback, useEffect, useRef, useState } from 'react';
import { trainingLevelsAnalytics } from '../../services/api';
import type { TrainingBand, TrainingLevelsResponse } from '../../types/portal';

/**
 * bd-97x22y.4 — the Trainings tab's own read (GET /api/portal/analytics/training-levels): all time, for the chosen
 * region and her Primary / Mid-High band. Made only while the tab is on screen, so its cost never slows the others.
 *
 * The first read owns the tab's placeholder; a later one (another band, another region) keeps the numbers on screen,
 * marked `refetching` so the tab can dim them, rather than flashing back to grey blocks. A failed read drops them:
 * old numbers under a new choice would be read as the new ones.
 */
export type TrainingLevelsStatus = 'loading' | 'refetching' | 'ready' | 'error' | 'forbidden';

const statusOf = (err: unknown): TrainingLevelsStatus =>
  ((err as { response?: { status?: number } })?.response?.status === 403 ? 'forbidden' : 'error');

export function useTrainingLevels(region: string | null, band: TrainingBand) {
  const [data, setData] = useState<TrainingLevelsResponse | null>(null);
  const [status, setStatus] = useState<TrainingLevelsStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    let alive = true;
    setStatus(hasData.current ? 'refetching' : 'loading');
    trainingLevelsAnalytics
      .get({ region, band })
      .then((d) => {
        if (!alive) return;
        hasData.current = true;
        setData(d);
        setStatus('ready');
      })
      .catch((err) => {
        if (!alive) return;
        hasData.current = false;
        setData(null);
        setStatus(statusOf(err));
      });
    return () => { alive = false; };
  }, [region, band, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, status, retry };
}
