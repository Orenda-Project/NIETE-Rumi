import { shortDate } from '../newui/range';
import type { AnalyticsWords } from './copy';

/**
 * bd-s6qbts.3 — how a number reads on the schools analytics page. A count is a count (0 is a real 0); an average is
 * one decimal with its n; no average is "—". Never a percentage.
 */

/** An average from fewer scored observations than this is shown muted (one or two lessons say little about a school). */
export const LOW_N = 3;

export const NO_VALUE = '—';

export function count(n: number | null | undefined, c: AnalyticsWords): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString(c.numberLocale) : NO_VALUE;
}

export function average(v: number | null | undefined, c: AnalyticsWords): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v.toLocaleString(c.numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const isLowN = (n: number) => n > 0 && n < LOW_N;

/** "1 Oct – 13 Oct 2026", "4 Dec 2025 – 13 Jan 2026", "All time", "From 1 Oct 2026". */
export function windowText(from: string | null, to: string | null, c: AnalyticsWords): string {
  const d = (iso: string, year: boolean) => shortDate(iso, year, c.months);
  if (from && to) {
    if (from === to) return d(to, true);
    return `${d(from, from.slice(0, 4) !== to.slice(0, 4))} – ${d(to, true)}`;
  }
  if (from) return c.scope.from(d(from, true));
  if (to) return c.scope.upTo(d(to, true));
  return c.scope.allTime;
}

/** True when the window starts before LP opens were being recorded (an open start does too). */
export function startsBeforeLpOpens(from: string | null, loggedSince: string | null | undefined): boolean {
  if (!loggedSince) return false;
  return !from || from < loggedSince;
}
