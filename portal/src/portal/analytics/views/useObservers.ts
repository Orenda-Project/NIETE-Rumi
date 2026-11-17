import { useCallback, useEffect, useRef, useState } from 'react';
import { observersAnalytics } from '../../services/api';
import type { ObserverAnalyticsResponse } from '../../types/portal';

/**
 * bd-97daxo.33 — the observers read (GET /api/portal/analytics/observers) for a non-FDE view's Overview and
 * Observations tab: made only when `enabled`, once per window and area; the last numbers stay (dimmed) until the next.
 */
export type ObserversStatus = 'loading' | 'ready' | 'refetching' | 'error' | 'forbidden';
export interface ObserversState {
  status: ObserversStatus;
  data: ObserverAnalyticsResponse | null;
  retry: () => void;
}

const statusOf = (err: unknown): ObserversStatus => ((err as { response?: { status?: number } })?.response?.status === 403 ? 'forbidden' : 'error');

/** The observers read: only when `enabled`, once per window and area; the last numbers stay (dimmed) until the next. */
export function useObserversRead(enabled: boolean, from: string | null, to: string | null, region: string): ObserversState {
  const key = `${from ?? ''}|${to ?? ''}|${region}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; status: ObserversStatus; data: ObserverAnalyticsResponse | null } | null>(null);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const want = `${key}#${attempt}`;
    if (asked.current === want) return;
    asked.current = want;
    let alive = true;
    let done = false;
    setState((s) => ({ key, status: s?.data ? 'refetching' : 'loading', data: s?.data ?? null }));
    observersAnalytics
      .get({ from, to, region })
      .then((d) => { done = true; if (alive) setState({ key, status: 'ready', data: d }); })
      .catch((err) => { done = true; if (alive) setState({ key, status: statusOf(err), data: null }); });
    return () => {
      alive = false;
      if (!done) asked.current = null;
    };
  }, [enabled, key, attempt, from, to, region]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!state) return { status: 'loading', data: null, retry };
  return { status: state.key === key ? state.status : 'refetching', data: state.data, retry };
}
