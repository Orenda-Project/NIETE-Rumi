import { shortDate } from '../newui/range';
import type { AnalyticsWords } from './copy';

/**
 * bd-s6qbts.3 — how a number reads on the schools analytics page. A count is a count (0 is a real 0); an average is
 * one decimal with its n; no average is "—".
 *
 * bd-97x22y.2 — scores as %, usage as counts (operator, 2026-10-14): a FICO / HITL average reads "64.8%" (`score`).
 * Nothing else is ever a percentage.
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

/** A FICO / HITL score, out of 100: "64.8%". No score → null (the caller shows "—"). */
export function score(v: number | null | undefined, c: AnalyticsWords): string | null {
  const shown = average(v, c);
  return shown === null ? null : c.percent(shown);
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

/**
 * bd-97x22y.4 (PLAN v7, her presentation 1 to 1) — the Trainings tab's "% passed", whole numbers as hers are
 * (Math.round(passed / total × 100)), from the counts so it is exactly her rounding. No teachers → null ("—").
 */
export function wholePercent(x: number, n: number, c: AnalyticsWords): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(n) || n <= 0) return null;
  return c.percent(Math.round((x / n) * 100).toLocaleString(c.numberLocale));
}

/** When a snapshot was read, in Pakistan time (UTC+5, no DST): "14 Oct 2026, 3:51 PM". */
export function pakistanTime(iso: string | null | undefined, c: AnalyticsWords): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 5 * 60 * 60 * 1000);
  const h = d.getUTCHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? c.trainingLevels.clock.am : c.trainingLevels.clock.pm}`;
  return `${d.getUTCDate()} ${c.months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${clock}`;
}
