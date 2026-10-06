/**
 * bd-o15qnr.2 — which visit times the portal accepts.
 *
 * The coach app v2 picks a time with three toggles (hour, :00/:30, AM/PM) from
 * 7:00 AM to 6:30 PM and posts it as 24-hour "HH:MM". The three slots the old
 * portal offered stay valid, so a form or a client still sending them keeps
 * working. One rule for create and for edit (leader-schedule-write.service,
 * leader-assignment.service), so the two writers cannot disagree.
 *
 * Readers already cope with any HH:MM: the teacher notice and the calendar sync
 * parse it, and the bot's own writer has stored 09:30 / 10:00 / 12:00 for months.
 */

const LEGACY_SLOTS = ['09:00', '11:30', '14:00'];

const EARLIEST = 7 * 60;        // 07:00
const LATEST = 18 * 60 + 30;    // 18:30

/**
 * @param {unknown} slot
 * @returns {boolean} true for "HH:MM" on the half hour between 07:00 and 18:30
 */
function isAllowedSlot(slot) {
  if (typeof slot !== 'string') return false;
  if (LEGACY_SLOTS.includes(slot)) return true;
  const m = /^(\d{2}):(00|30)$/.exec(slot);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= EARLIEST && minutes <= LATEST;
}

module.exports = { isAllowedSlot, LEGACY_SLOTS };
