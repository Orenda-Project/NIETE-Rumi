import { clockOf } from '../../ui/ShareActions';
import type { ActivityCopy } from './copy';

/**
 * The "Last 30 days" block's pure rules (no React, no requests).
 *
 *   activityRange  the 30 days the numbers cover: the Pakistan date of the run that counted them, and the 29 days
 *                  before. A tile opens its list on exactly these days.
 *   changeOf       the change pill: both 0 → none; else now − previous (previous 0 → "up n"; never a percentage)
 *   updatedLine    a night run (00:00–06:00 PKT) today → "Updated last night"; a day run today → "Updated today, 2:30
 *                  PM"; a run yesterday → "Updated yesterday, 2:30 PM"; anything else → null (the block hides)
 *   hasNumbers     false when every count, now and previous, is 0 (the no-numbers state)
 */
export type Count = { now: number; prev: number };
export type ActivityTiles = { opened: Count; taught: Count; coached: Count; quizzes: Count; papers: Count };
export type DayRange = { from: string; to: string };

const DAY_MS = 86_400_000;
const PK_OFFSET_MS = 5 * 3_600_000; // Pakistan has no daylight saving
const NIGHT_END_HOUR = 6;

const pkDate = (ms: number) => new Date(ms + PK_OFFSET_MS).toISOString().slice(0, 10);
const pkHour = (ms: number) => new Date(ms + PK_OFFSET_MS).getUTCHours();

export function activityRange(updatedAt: string): DayRange | null {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return null;
  return { from: pkDate(ms - 29 * DAY_MS), to: pkDate(ms) };
}

export function rangeHref(path: string, range: DayRange | null): string {
  if (!range) return path;
  return `${path}?${new URLSearchParams({ range: 'custom', from: range.from, to: range.to }).toString()}`;
}

export function changeOf(c: Count): number | null {
  return c.now === 0 && c.prev === 0 ? null : c.now - c.prev;
}

export function hasNumbers(t: ActivityTiles): boolean {
  return Object.values(t).some((c) => c.now > 0 || c.prev > 0);
}

export function updatedLine(updatedAt: string, now: number, words: ActivityCopy, clock: { am: string; pm: string }): string | null {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms) || ms > now + 60_000) return null;
  const day = pkDate(ms);
  const time = clockOf(updatedAt, clock.am, clock.pm);
  if (!time) return null;
  if (day === pkDate(now)) return pkHour(ms) < NIGHT_END_HOUR ? words.updatedNight : words.updatedToday(time);
  if (day === pkDate(now - DAY_MS)) return words.updatedYesterday(time);
  return null;
}
