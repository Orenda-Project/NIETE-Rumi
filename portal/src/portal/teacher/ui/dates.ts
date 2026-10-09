/**
 * bd-4404s7.1 — calendar-day arithmetic on "YYYY-MM-DD" strings (a day is a day: no clock, no time zone). The coach's days are
 * Asia/Karachi days; the server and the screens already speak these strings, so nothing here touches `Date` in local time.
 */
const DAY_MS = 86_400_000;

const toUtc = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

/** The seven days of the week containing `day`, Sunday first (the coach app's week). */
export function weekOf(day: string): string[] {
  const start = addDays(day, -weekdayOf(day));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const dayNumber = (day: string): number => Number(day.slice(8, 10));
export const monthIndex = (day: string): number => Number(day.slice(5, 7)) - 1;
export const yearOf = (day: string): number => Number(day.slice(0, 4));
