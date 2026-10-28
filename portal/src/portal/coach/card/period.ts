import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { SchoolCardCopy } from "./copy";
import type { Bucket, PeriodKey } from "./types";

/**
 * The School card's period: Today · This week · This month, in the address (`?period=`), so Back, a reload and every
 * link between the card's pages keep the one the coach picked. This week is the default and is left out of the address.
 * The dates themselves are the server's (Pakistan time); nothing here counts.
 */

export const PERIODS: readonly PeriodKey[] = ["today", "week", "month"];

export const periodOf = (raw: string | null | undefined): PeriodKey => (raw === "today" || raw === "month" ? raw : "week");

export function usePeriod(): [PeriodKey, (next: PeriodKey) => void] {
  const [params, setParams] = useSearchParams();
  const period = periodOf(params.get("period"));
  const set = useCallback((next: PeriodKey) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "week") p.delete("period"); else p.set("period", next);
      return p;
    }, { replace: true });
  }, [setParams]);
  return [period, set];
}

/** A link inside the card's pages, carrying the period. */
export const withPeriod = (path: string, period: PeriodKey): string => (period === "week" ? path : `${path}?period=${period}`);

const ymd = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m: m - 1, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

const PK = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" });

/** A stored date or instant as a Pakistan day, YYYY-MM-DD ("2026-10-27" stays as it is). */
export function pkDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : PK.format(t);
}

/** Under each bar and over each grid column: [the day or week, the small date]. This week: Mon / 26. This month: Wk 1 / 28 Sep. */
export function bucketLabels(period: PeriodKey, buckets: readonly Bucket[], C: SchoolCardCopy): [string, string][] {
  return buckets.map((b, i) => {
    const { m, d, wd } = ymd(b.date);
    return period === "month" ? [C.wk(i + 1), C.dayMonth(d, C.months[m])] : [C.weekdays[wd], String(d)];
  });
}

/**
 * "about 9 a day" (the total over the school days so far, rounded), "less than 1 a day" when that rounds to 0 but
 * something happened, nothing for Today or when nothing happened. `perDay` is the server's number.
 */
export function perDayLine(period: PeriodKey, perDay: number | null | undefined, total: number | null | undefined, C: SchoolCardCopy): string | null {
  if (period === "today" || total == null || total <= 0 || perDay == null) return null;
  const n = Math.round(perDay);
  return n >= 1 ? C.aboutDay(n) : C.lessThanOneDay;
}

/** The grid page has no server rate: the same rule from its own total and the period's school days so far. */
export const perDayOf = (total: number, schoolDaysSoFar: number): number | null => (schoolDaysSoFar > 0 ? Math.round(total / schoolDaysSoFar) : null);

/** "Thu and Fri are still ahead" under a week grid; null when no day is ahead. */
export function aheadLine(period: PeriodKey, buckets: readonly Bucket[], C: SchoolCardCopy): string | null {
  if (period !== "week") return null;
  const days = buckets.filter((b) => b.future).map((b) => C.weekdays[ymd(b.date).wd]);
  if (!days.length) return null;
  if (days.length === 1) return C.oneAhead(days[0]);
  return C.manyAhead(C.and(days.slice(0, -1).join(C.listJoin), days[days.length - 1]));
}

/** "Today", "Yesterday", "Wed 21 Oct" for a row's date, against the server's today. */
export function dayLabel(value: string | null | undefined, todayIso: string | null | undefined, C: SchoolCardCopy): string {
  const day = pkDate(value);
  if (!day) return C.dash;
  if (todayIso && day === todayIso) return C.today;
  if (todayIso) {
    const t = ymd(todayIso);
    const y = new Date(Date.UTC(t.y, t.m, t.d - 1)).toISOString().slice(0, 10);
    if (day === y) return C.yesterday;
  }
  const { m, d, wd } = ymd(day);
  return C.weekdayDayMonth(C.weekdays[wd], d, C.months[m]);
}
