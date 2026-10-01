import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Where the Analytics page's view lives: the tab is the #hash (so the
 * principal's step-5 link to #remarks lands on Remarks) and the date window is
 * ?from=&to=. A shared link, a reload and the back button all keep what she
 * was looking at. See components/AnalyticsControls for the controls.
 */

export type AnalyticsTab = 'observations' | 'attendance' | 'remarks';

export const ANALYTICS_TABS: AnalyticsTab[] = ['observations', 'attendance', 'remarks'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function useAnalyticsView() {
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();

  const fromHash = hash.slice(1);
  const tab: AnalyticsTab = ANALYTICS_TABS.includes(fromHash as AnalyticsTab) ? (fromHash as AnalyticsTab) : 'observations';
  const read = (k: string) => { const v = searchParams.get(k) || ''; return DAY.test(v) ? v : null; };
  const from = read('from');
  const to = read('to');

  const setTab = (next: AnalyticsTab) => {
    navigate({ search: `?${searchParams.toString()}`, hash: next === 'observations' ? '' : `#${next}` }, { replace: true });
  };
  // Every change keeps the other half of the address: a new window stays on
  // the same tab, and (setParam) a new teacher keeps both.
  const setParams = (next: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    navigate({ search: `?${q.toString()}`, hash }, { replace: true });
  };
  const setRange = (next: { from?: string | null; to?: string | null }) => setParams(next);
  return { tab, setTab, from, to, setRange, setParams, searchParams };
}

