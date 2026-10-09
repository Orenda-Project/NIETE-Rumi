/**
 * bd-4404s7.3 — the Schedule area's pure rules: which visits are already booked on a day, when a slot clashes, how a
 * school's last visit reads as a status tone, and the day/time wording. No React here.
 */
import { parseTime } from '../../teacher/ui';
import type { ChipTone } from '../../teacher/ui';
import type { CoachVisit } from '../types';
import type { ScheduleCopy } from './copy';

/** The kit's AM/PM words (TeacherUiCopy `am`, `pm`). */
export type MeridiemWords = { am: string; pm: string };

/** "14:30" → "2:30 PM" (English) or "2:30 شام" (Urdu): the same clock the kit's TimeStamp draws, as one string. */
export function timeWords(slot: string | null | undefined, words: MeridiemWords): string {
  const p = parseTime(slot);
  if (!p) return slot ? String(slot) : '';
  return `${p.hm} ${p.meridiem === 'AM' ? words.am : words.pm}`;
}

/** Her visits on `date`, in time order, leaving out the one being rescheduled and any she did not keep. */
export function bookedOn(visits: readonly CoachVisit[] | null | undefined, date: string, ignoreId?: string | null): CoachVisit[] {
  return (visits ?? [])
    .filter((v) => v.scheduledFor === date && v.id !== ignoreId && v.status !== 'cancelled')
    .slice()
    .sort((a, b) => String(a.scheduledSlot ?? '').localeCompare(String(b.scheduledSlot ?? '')));
}

/** The visits already at this exact slot ("HH:MM"). A clash WARNS; it never blocks (operator, 9 Oct). */
export function clashesAt(booked: readonly CoachVisit[], slot: string | null | undefined): CoachVisit[] {
  if (!slot) return [];
  return booked.filter((v) => v.scheduledSlot === slot);
}

/**
 * New visit 1's status, in the kit's tones only (operator, 9 Oct): none or over 30 days = waiting (amber), 8 to 30 =
 * info (grey), within a week = done (green). The teacher count stays plain text.
 */
export function sinceTone(days: number | null | undefined): ChipTone {
  if (days == null || days > 30) return 'waiting';
  if (days > 7) return 'info';
  return 'done';
}

export function sinceText(days: number | null | undefined, c: Pick<ScheduleCopy, 'noVisitsYet' | 'daysAgo' | 'today'>): string {
  if (days == null) return c.noVisitsYet;
  return days === 0 ? c.today : c.daysAgo(days);
}

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "Wed 7" */
export function dayShort(iso: string, c: Pick<ScheduleCopy, 'weekdaysShort' | 'dayShort'>): string {
  const d = dayOf(iso);
  return c.dayShort(c.weekdaysShort[d.getUTCDay()], d.getUTCDate());
}

/** "Wednesday 7 October" */
export function dayLong(iso: string, c: Pick<ScheduleCopy, 'weekdaysLong' | 'months'>): string {
  const d = dayOf(iso);
  return `${c.weekdaysLong[d.getUTCDay()]} ${d.getUTCDate()} ${c.months[d.getUTCMonth()]}`;
}

/** "Wed 7 Oct": the short day, its number and the SHORT month (the kit's `months`; Urdu's are whole). */
export function dayMonth(iso: string, c: Pick<ScheduleCopy, 'weekdaysShort' | 'dayShort'>, shortMonths: readonly string[]): string {
  return `${dayShort(iso, c)} ${shortMonths[dayOf(iso).getUTCMonth()]}`;
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
