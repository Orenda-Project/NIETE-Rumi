/**
 * bd-o15qnr — a visit's time in the coach app v2.
 *
 * Picked with three toggles: hour (7–6), minutes (:00 / :30), AM/PM. Hours
 * 7–11 default to AM and 12–6 to PM, so tapping an hour never makes an
 * out-of-hours visit by accident; she can still flip AM/PM, and whatever the
 * toggles make can be booked (bd-o15qnr.8: no warning). Default 9:00 AM.
 * The server stores 24-hour "HH:MM" (dashboard/lib/visit-time.js holds the same
 * rule: any half hour, plus the three old slots).
 */

export type Meridiem = "AM" | "PM";
export type VisitTime = { hour: number; minute: 0 | 30; meridiem: Meridiem };

export const HOURS = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
export const DEFAULT_TIME: VisitTime = { hour: 9, minute: 0, meridiem: "AM" };
const LEGACY_SLOTS = ["09:00", "11:30", "14:00"];

export function defaultMeridiem(hour: number): Meridiem {
  return hour >= 7 && hour <= 11 ? "AM" : "PM";
}

/** Picking an hour also picks its default AM/PM. */
export function pickHour(hour: number): { hour: number; meridiem: Meridiem } {
  return { hour, meridiem: defaultMeridiem(hour) };
}

/** The next (+1) or previous (-1) hour in HOURS, wrapping at the ends. */
export function stepHour(hour: number, dir: 1 | -1): number {
  const i = HOURS.indexOf(hour);
  const at = i < 0 ? HOURS.indexOf(DEFAULT_TIME.hour) : i;
  return HOURS[(at + dir + HOURS.length) % HOURS.length];
}

export function toSlot(t: VisitTime): string {
  let h = t.hour % 12;
  if (t.meridiem === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${t.minute === 30 ? "30" : "00"}`;
}

export function fromSlot(slot: string | null | undefined): VisitTime {
  const m = /^(\d{2}):(\d{2})$/.exec(String(slot || ""));
  if (!m) return { ...DEFAULT_TIME };
  const h24 = Number(m[1]);
  const minute = Number(m[2]) >= 30 ? 30 : 0;
  const meridiem: Meridiem = h24 >= 12 ? "PM" : "AM";
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour, minute, meridiem };
}

export function isAllowedSlot(slot: string | null | undefined): boolean {
  if (!slot) return false;
  if (LEGACY_SLOTS.includes(slot)) return true;
  const m = /^(\d{2}):(00|30)$/.exec(slot);
  return !!m && Number(m[1]) <= 23;
}

/** "14:00" → "2:00 PM". A legacy word ("morning") is shown capitalised; nothing → "—". */
export function formatSlot(slot: string | null | undefined): string {
  if (!slot) return "—";
  const m = /^(\d{2}):(\d{2})$/.exec(slot);
  if (!m) return slot.charAt(0).toUpperCase() + slot.slice(1);
  const t = fromSlot(slot);
  return `${t.hour}:${m[2]} ${t.meridiem}`;
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
