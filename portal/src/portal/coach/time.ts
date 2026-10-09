/**
 * bd-o15qnr — a visit's time in the coach app v2.
 *
 * The server stores 24-hour "HH:MM" (dashboard/lib/visit-time.js holds the same
 * rule: any half hour, plus the three old slots). Picking one is the kit's TimePicker
 * (bd-4404s7.3); showing one is the kit's TimeStamp, and `formatSlot` below is the same
 * clock as a string for the words around it.
 */

import { parseTime } from "../teacher/ui";

const LEGACY_SLOTS = ["09:00", "11:30", "14:00"];

/** A slot the server accepts: any half hour, plus the three old slots (dashboard/lib/visit-time.js). */
export function isAllowedSlot(slot: string | null | undefined): boolean {
  if (!slot) return false;
  if (LEGACY_SLOTS.includes(slot)) return true;
  const m = /^(\d{2}):(00|30)$/.exec(slot);
  return !!m && Number(m[1]) <= 23;
}

/**
 * "14:00" → "2:00 PM". A legacy word ("morning") is shown capitalised; nothing → "—".
 * bd-4404s7.3: the clock is the kit's `parseTime` (the one TimeStamp draws), so a time reads the same as a string
 * (crumbs, sentences) and as a TimeStamp. The screens show a time with <TimeStamp>; this is for the words around it.
 */
export function formatSlot(slot: string | null | undefined): string {
  if (!slot) return "—";
  const p = parseTime(slot);
  if (!p) return slot.charAt(0).toUpperCase() + slot.slice(1);
  return `${p.hm} ${p.meridiem}`;
}

/** The 12-hour time and its AM/PM apart, for a time tile ("9:00" over "AM"). */
export function splitSlot(slot: string | null | undefined): { time: string; meridiem: string } {
  const f = formatSlot(slot);
  const m = /^(\d{1,2}:\d{2}) (AM|PM)$/.exec(f);
  return m ? { time: m[1], meridiem: m[2] } : { time: f, meridiem: "" };
}

/** The coach's own calendar day, YYYY-MM-DD (the server's day is UTC). */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * bd-o15qnr.23 — today as a coach in Pakistan counts it: YYYY-MM-DD in
 * Asia/Karachi, whatever the phone's own zone. The one rule for "past",
 * "overdue" and "today" on a visit; the server's lib/visit-time karachiToday is
 * its twin. (localDay stays for plain day arithmetic.)
 */
export function karachiDay(now: Date = new Date()): string {
  const parts = PK_DAY.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Whole hours from now until today's "HH:MM" slot (negative once it has passed); null for no time.
 * The slot is Pakistan's wall clock (UTC+5 all year, no daylight saving), on Pakistan's today.
 */
export function hoursUntil(slot: string | null | undefined, now: Date = new Date()): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(slot || ""));
  if (!m) return null;
  const [y, mo, d] = karachiDay(now).split("-").map(Number);
  const at = Date.UTC(y, mo - 1, d, Number(m[1]) - 5, Number(m[2]));
  return Math.round((at - now.getTime()) / 3600000);
}

/**
 * bd-o15qnr.18 — the Home subheading: "Wednesday, 7th October", for the day it
 * is in Pakistan (the coach's day), whatever the phone's own time zone.
 */
export function fullDate(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", weekday: "long", day: "numeric", month: "long" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const day = Number(get("day"));
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] || "th";
  return `${get("weekday")}, ${day}${suffix} ${get("month")}`;
}
