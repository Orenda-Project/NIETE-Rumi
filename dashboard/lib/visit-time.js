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

module.exports = { isAllowedSlot, LEGACY_SLOTS };
