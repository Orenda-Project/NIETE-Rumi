import { useAnalyticsView } from '../lib/analyticsView';
import { pkToday } from '../newui/range';
import type { PeriodPreset } from './copy';

/**
 * bd-s6qbts.3 — what the schools analytics page is showing, kept in the ADDRESS like the other Analytics pages
 * (lib/analyticsView): ?from=&to= (inclusive days, Pakistan time), ?period=all, ?region=<name>. A shared link, a
 * reload and Back all keep the view.
 *
 *   from/to in the address   that window
 *   ?period=all              all time (no window)
 *   neither                  this month, to today (PLAN v2 §1's default)
 */

export const PRESETS: readonly PeriodPreset[] = ['week', 'month', 'quarter', 'year'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** A preset's window, ending today. Weeks start on Monday; "Last 3 months" is this month and the two before it. */
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const t = utc(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (preset) {
    case 'week': {
      const back = (t.getUTCDay() + 6) % 7; // Monday → 0 … Sunday → 6
      return { from: iso(new Date(Date.UTC(y, m, t.getUTCDate() - back))), to: today };
    }
    case 'month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
    case 'quarter':
      return { from: iso(new Date(Date.UTC(y, m - 2, 1))), to: today };
    case 'year':
      return { from: `${y}-01-01`, to: today };
  }
}

/** Which preset a window is, if any. */
export function presetOf(from: string | null, to: string | null, today: string): PeriodPreset | null {
  return PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === from && r.to === to;
  }) ?? null;
}

/** The region as the API takes it: null → 'all', "Unassigned" → 'unassigned', a sector as written. */
export function regionParam(region: string | null): string {
  if (!region) return 'all';
  return region.toLowerCase() === 'unassigned' ? 'unassigned' : region;
}

export function useSchoolsView() {
  const { from: urlFrom, to: urlTo, setParams, searchParams } = useAnalyticsView();
  const today = pkToday();
  const allTime = !urlFrom && !urlTo && searchParams.get('period') === 'all';
  const month = presetRange('month', today);
  const from = urlFrom || urlTo ? urlFrom : allTime ? null : month.from;
  const to = urlFrom || urlTo ? urlTo : allTime ? null : month.to;
  const region = searchParams.get('region') || null;

  /** From AnalyticsControls: one end at a time, or both cleared (All time). */
  const setRange = (r: { from?: string | null; to?: string | null }) => {
    const next = { from: 'from' in r ? r.from ?? null : from, to: 'to' in r ? r.to ?? null : to };
    if (!next.from && !next.to) setParams({ from: null, to: null, period: 'all' });
    else setParams({ from: next.from, to: next.to, period: null });
  };
  const setPreset = (p: PeriodPreset) => setParams({ ...presetRange(p, today), period: null });
  const setRegion = (next: string | null) => setParams({ region: next });

  return { from, to, allTime, preset: allTime ? null : presetOf(from, to, today), region, today, setRange, setPreset, setRegion };
}
