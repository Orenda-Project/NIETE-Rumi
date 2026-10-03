/**
 * bd-5rz1v.19 — the date range's values: the keys GET /api/portal/progress takes
 * (dashboard/lib/pk-range.js — the server works the dates out in Pakistan time, so a preset
 * carries no dates of its own; Pick dates sends YYYY-MM-DD `from` and `to`), what the button
 * says, and today in Pakistan. The button and the sheet are in DateRange.tsx.
 */
import { KIT_COPY, MONTHS } from './copy';

export type RangePreset = 'this_week' | 'this_month' | 'last_3_months' | 'this_year' | 'all';
export type RangeKey = RangePreset | 'custom';
export type DateRange = { key: RangePreset } | { key: 'custom'; from: string; to: string };

export const RANGE_PRESETS: readonly RangePreset[] = ['this_week', 'this_month', 'last_3_months', 'this_year', 'all'];
export const DEFAULT_RANGE: DateRange = { key: 'this_month' };

export type DateRangeCopy = {
  title: string;
  presets: Record<RangePreset, string>;
  pick: string;
  from: string;
  to: string;
  done: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD date. */
export const isIsoDate = (value: string): boolean => ISO.test(value);

/** "3 Oct" (or "3 Oct 2025" when the year has to be said). */
export function shortDate(iso: string, withYear = false, months: readonly string[] = MONTHS): string {
  if (!ISO.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** What the button says: the preset's name, or the picked dates. */
export function rangeLabel(range: DateRange, copy: DateRangeCopy = KIT_COPY.dateRange): string {
  if (range.key !== 'custom') return copy.presets[range.key];
  if (range.from === range.to) return shortDate(range.from);
  const years = range.from.slice(0, 4) !== range.to.slice(0, 4);
  return `${shortDate(range.from, years)} – ${shortDate(range.to, years)}`;
}

/** The query GET /api/portal/progress takes. */
export function rangeQuery(range: DateRange): { range: RangeKey; from?: string; to?: string } {
  return range.key === 'custom' ? { range: 'custom', from: range.from, to: range.to } : { range: range.key };
}

/** Today in Pakistan, YYYY-MM-DD — the latest date she can pick. */
export function pkToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A real calendar date: 2026-02-30 is not one (Date would roll it into March). */
function realDate(value: string | null): string | null {
  if (!value || !isIsoDate(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * bd-5rz1v.17 — the range lives in the address (?range=…&from=&to=), so Home and its lists share
 * it, Back keeps it, and a reload shows the same numbers. Anything it cannot read is This month.
 */
export function rangeFromSearch(params: URLSearchParams): DateRange {
  const key = params.get('range');
  if (key && (RANGE_PRESETS as readonly string[]).includes(key)) return { key: key as RangePreset };
  if (key === 'custom') {
    const from = realDate(params.get('from'));
    const to = realDate(params.get('to'));
    if (from && to && from <= to) return { key: 'custom', from, to };
  }
  return DEFAULT_RANGE;
}

/** The address's query for a range: "" for the default, so Home's own address stays clean. */
export function rangeSearch(range: DateRange): string {
  if (range.key === DEFAULT_RANGE.key) return '';
  const q = new URLSearchParams(rangeQuery(range) as Record<string, string>);
  return `?${q.toString()}`;
}

/** The day of the month and the short month of a moment, in Pakistan ("3", "Oct"). */
export function pkDayMonth(iso: string, months: readonly string[] = MONTHS): { day: string; month: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [, m, day] = pkToday(d).split('-').map(Number);
  return { day: String(day), month: months[m - 1] };
}
