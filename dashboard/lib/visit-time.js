/**
 * bd-o15qnr.2 — which visit times the portal accepts.
 *
 * The coach app v2 picks a time with three toggles (hour, :00/:30, AM/PM) and
 * posts it as 24-hour "HH:MM". Tapping an hour picks its usual AM/PM (7–11 AM,
 * 12–6 PM), so an out-of-hours visit never happens by accident; she can still
 * flip AM/PM, and since bd-o15qnr.8 (operator: "AM and PM warning can be
 * removed") every half hour the toggles can make is accepted. The three slots
 * the old portal offered stay valid. One rule for create and for edit
 * (leader-schedule-write.service, leader-assignment.service), so the two
 * writers cannot disagree.
 *
 * Readers already cope with any HH:MM: the teacher notice and the calendar sync
 * parse it, and the bot's own writer has stored 09:30 / 10:00 / 12:00 for months.
 */

const LEGACY_SLOTS = ['09:00', '11:30', '14:00'];

/**
 * @param {unknown} slot
 * @returns {boolean} true for "HH:MM" on the half hour, 00:00 to 23:30
 */
function isAllowedSlot(slot) {
  if (typeof slot !== 'string') return false;
  if (LEGACY_SLOTS.includes(slot)) return true;
  const m = /^(\d{2}):(00|30)$/.exec(slot);
  return !!m && Number(m[1]) <= 23;
}

/**
 * bd-o15qnr.22 — a stored visit day as "YYYY-MM-DD", whatever the server's
 * timezone. node-postgres builds a DATE as a Date at LOCAL midnight, so the
 * stored day is its calendar fields — never toISOString(), which is UTC and
 * turned 13 Oct into "2026-10-12" on a server in Asia/Karachi.
 */
function storedDay(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value || '').slice(0, 10);
}

/**
 * Did saving this date and slot move the visit? Strings against strings, so the
 * answer is the same on a server in any timezone. One rule for booking and
 * Reschedule; a same-slot save is not news to the teacher (bd-xorfy).
 */
function visitMoved(prev, date, slot) {
  return storedDay(prev && prev.scheduled_for) !== date
    || ((prev && prev.scheduled_slot) || null) !== (slot || null);
}

/**
 * bd-o15qnr.23 — today, as a coach in Pakistan counts it: the calendar day in
 * Asia/Karachi, whatever the server's own zone. The UTC date (toISOString) is
 * still yesterday from 00:00 to 05:00 PKT, which made a booking for yesterday
 * "not past" (the teacher was told) and yesterday's visit "not yet overdue".
 * The one rule for "past" and "overdue"; the coach app's time.ts karachiDay is
 * its twin.
 */
const PK_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});
function karachiToday(now = new Date()) {
  const parts = PK_DAY.formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = { isAllowedSlot, LEGACY_SLOTS, storedDay, visitMoved, karachiToday };
