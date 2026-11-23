/**
 * My journey's calendar (spec §4): Pakistan days and weeks (Monday first), the week headings, the day word at the end
 * of a row, the "Updated …" line and the 30-day taught filter Home's tile opens. Pure: the instant `now` is passed in.
 * Pakistan is UTC+5 all year, so a Pakistan day is arithmetic, not a time zone lookup.
 */
import { addDays, weekdayOf } from '../ui/dates';

const PK_MS = 5 * 3600 * 1000;
/** The night run's hours (spec §3: 00:00–06:00 Pakistan time is "last night"). */
const NIGHT_UNTIL_HOUR = 6;

export type JourneyStep = { kind: string; at: string; refId: string; meta: Record<string, unknown> };
export type WeekGroup = { start: string; steps: JourneyStep[] };

const ms = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) : NaN);

/** The Pakistan calendar day of an instant, "YYYY-MM-DD". */
export function pkDay(t: number): string {
  return new Date(t + PK_MS).toISOString().slice(0, 10);
}

/** The Monday of the week holding `day`. */
export function weekStartOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

/** Steps into Pakistan weeks, newest week first, newest step first; weeks with no step are not there. */
export function groupByWeek(steps: JourneyStep[]): WeekGroup[] {
  const byWeek = new Map<string, JourneyStep[]>();
  [...steps].filter((s) => Number.isFinite(ms(s.at))).sort((a, b) => ms(b.at) - ms(a.at)).forEach((s) => {
    const start = weekStartOf(pkDay(ms(s.at)));
    byWeek.set(start, [...(byWeek.get(start) ?? []), s]);
  });
  return [...byWeek.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([start, list]) => ({ start, steps: list }));
}

type WeekWords = {
  thisWeek: string; lastWeek: string; weekRange: (d1: number, m1: number, d2: number, m2: number) => string;
};

export function weekHeading(start: string, now: number, w: WeekWords): string {
  const thisWeek = weekStartOf(pkDay(now));
  if (start === thisWeek) return w.thisWeek;
  if (start === addDays(thisWeek, -7)) return w.lastWeek;
  const end = addDays(start, 6);
  const part = (d: string) => [Number(d.slice(8, 10)), Number(d.slice(5, 7)) - 1] as const;
  const [d1, m1] = part(start);
  const [d2, m2] = part(end);
  return w.weekRange(d1, m1, d2, m2);
}

type DayWords = { today: string; yesterday: string; weekdaysShort: readonly string[] };

export function dayWord(at: string, now: number, w: DayWords): string {
  const day = pkDay(ms(at));
  const today = pkDay(now);
  if (day === today) return w.today;
  if (day === addDays(today, -1)) return w.yesterday;
  return w.weekdaysShort[weekdayOf(day)] ?? '';
}

type UpdatedWords = {
  updatedLastNight: string; updatedToday: (time: string) => string; updatedYesterday: (time: string) => string;
};

/** "2:30 PM" in the page's AM/PM words. */
function clock(t: number, w: { am: string; pm: string }): string {
  const d = new Date(t + PK_MS);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? w.am : w.pm}`;
}

/** The "Updated …" line from the store's updated time, or null when it is older than yesterday or unreadable. */
export function updatedLine(updatedAt: unknown, now: number, w: UpdatedWords, time: { am: string; pm: string }): string | null {
  const t = ms(updatedAt);
  if (!Number.isFinite(t)) return null;
  const day = pkDay(t);
  const today = pkDay(now);
  if (day === today) {
    return new Date(t + PK_MS).getUTCHours() < NIGHT_UNTIL_HOUR ? w.updatedLastNight : w.updatedToday(clock(t, time));
  }
  if (day === addDays(today, -1)) return w.updatedYesterday(clock(t, time));
  return null;
}

/** Pakistan midnight `days - 1` days before today: the start of Home's "Last 30 days". */
export function windowStart(now: number, days = 30): number {
  return Date.parse(`${addDays(pkDay(now), -(days - 1))}T00:00:00Z`) - PK_MS;
}

/** The taught steps of Home's 30 days (the Taught in class tile opens these). */
export function taughtInWindow(steps: JourneyStep[], now: number): JourneyStep[] {
  const from = windowStart(now);
  return steps.filter((s) => s.kind === 'taught' && ms(s.at) >= from);
}

