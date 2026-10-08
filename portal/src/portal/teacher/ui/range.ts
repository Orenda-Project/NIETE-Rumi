import { MONTHS } from '../../newui/copy';
import type { DateRange } from '../../newui/range';

/**
 * bd-fmf24g.2.3 — a DateRange (the portal's own: newui/range.ts, what GET /api/portal/progress takes) as dates, and
 * the period a change is measured against. `today` is Pakistan's (pkToday()); every range runs to it.
 *
 *   This week      Monday → today            vs the same days last week
 *   This month     the 1st → today           vs the same days last month (1–8 Oct vs 1–8 Sep)
 *   Last 3 months  the 1st two months back   vs the 3 months before, to the same day
 *   This year      1 Jan → today             vs last year to the same day
 *   Pick dates     From → To (n days)        vs the n days just before
 *   All time       —                         nothing to compare with
 *
 * A day of the month is clamped (31 Mar → 28 Feb). Dates are YYYY-MM-DD; the arithmetic is in UTC so no time
 * zone can move a day.
 */

export interface ResolvedRange {
  from: string | null;
  to: string;
  prevFrom: string | null;
  prevTo: string | null;
  /** "1 – 8 Oct 2026" ("" for All time). */
  span: string;
  /** The previous period, the same way ("" when there is none). */
  prevSpan: string;
}

const DAY = 86_400_000;
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (t: number, n: number) => t + n * DAY;
const addMonths = (t: number, n: number) => {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last));
};

/** "8 Oct 2026", "1 – 8 Oct 2026", "28 Sep – 1 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function formatSpan(fromIso: string, toIso: string, months: readonly string[] = MONTHS): string {
  const a = new Date(parse(fromIso));
  const b = new Date(parse(toIso));
  const day = (d: Date) => `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  if (fromIso === toIso) return `${day(b)} ${b.getUTCFullYear()}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${day(a)} ${a.getUTCFullYear()} – ${day(b)} ${b.getUTCFullYear()}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} – ${day(b)} ${b.getUTCFullYear()}`;
  return `${day(a)} – ${day(b)} ${b.getUTCFullYear()}`;
}

export function resolveRange(range: DateRange, today: string, months: readonly string[] = MONTHS): ResolvedRange {
  const t = parse(today);
  const out = (from: number, to: number, prevFrom: number, prevTo: number): ResolvedRange => ({
    from: iso(from), to: iso(to), prevFrom: iso(prevFrom), prevTo: iso(prevTo),
    span: formatSpan(iso(from), iso(to), months), prevSpan: formatSpan(iso(prevFrom), iso(prevTo), months),
  });
  const d = new Date(t);
  switch (range.key) {
    case 'this_week': {
      const monday = addDays(t, -((d.getUTCDay() + 6) % 7));
      return out(monday, t, addDays(monday, -7), addDays(t, -7));
    }
    case 'this_month': {
      const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      return out(first, t, addMonths(first, -1), addMonths(t, -1));
    }
    case 'last_3_months': {
      const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1);
      return out(first, t, addMonths(first, -3), addMonths(t, -3));
    }
    case 'this_year': {
      const first = Date.UTC(d.getUTCFullYear(), 0, 1);
      return out(first, t, addMonths(first, -12), addMonths(t, -12));
    }
    case 'custom': {
      const a = parse(range.from);
      const b = parse(range.to);
      const n = Math.round((b - a) / DAY) + 1;
      return out(a, b, addDays(a, -n), addDays(a, -1));
    }
    default:
      return { from: null, to: today, prevFrom: null, prevTo: null, span: '', prevSpan: '' };
  }
}
