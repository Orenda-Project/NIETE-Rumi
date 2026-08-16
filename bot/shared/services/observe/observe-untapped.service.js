/**
 * bd-2675 — reports waiting on the teacher's tap.
 *
 * A teacher outside the 24-hour messaging window can't be sent a report
 * directly; she gets an approved UTILITY template, and the report follows only
 * when she TAPS it (observe-send.service.js, phase 'teacher_tap'). Until then
 * the coach has been told "sent" and hears nothing more — which is what Riffat
 * read as "Rumi does not send the report to that number" (R30).
 *
 * Operator decision (2026-08-13): nudge the teacher — "but please make sure
 * that we have events that tell her when the teacher has tapped, otherwise we
 * end up trapping them forever."
 *
 * Hence this planner is bounded and event-closed:
 *   • the tap is recorded (tapped_at) and the coach is told when it lands;
 *   • at most ONE nudge, after a full day of silence;
 *   • then we stop and tell the coach plainly.
 * A teacher is never nudged twice, and a coach is never left guessing.
 *
 * Pure — no I/O, no clock of its own — mirroring coaching-stale-recovery.js:
 * the planner decides, the worker executes.
 */

const HOUR = 60 * 60 * 1000;

/** A full day of silence before we say anything again. */
const NUDGE_AFTER_MS = 24 * HOUR;
/** …and a further two days before we stop and tell the coach. */
const GIVE_UP_AFTER_MS = 48 * HOUR;

const parsed = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/**
 * @param {object} delivery analysis_data.teacher_delivery
 * @param {number} nowMs
 * @returns {{action:'skip'|'nudge'|'give_up', reason:string}}
 */
function classifyUntappedDelivery(delivery, nowMs = Date.now()) {
  const d = delivery || {};
  if (d.status !== 'awaiting_teacher_tap') return { action: 'skip', reason: 'not_awaiting_tap' };
  // The event that closes the loop: once she has tapped, we never chase again.
  if (d.tapped_at) return { action: 'skip', reason: 'already_tapped' };
  if (d.gave_up_at) return { action: 'skip', reason: 'already_gave_up' };

  const sentAt = parsed(d.template_sent_at);
  if (sentAt == null) return { action: 'skip', reason: 'no_send_timestamp' };

  const nudgedAt = parsed(d.nudged_at);
  const alreadyNudged = nudgedAt != null || Number(d.nudge_count || 0) > 0;

  if (!alreadyNudged) {
    if (nowMs - sentAt < NUDGE_AFTER_MS) return { action: 'skip', reason: 'within_grace_window' };
    return { action: 'nudge', reason: 'no_tap_after_grace' };
  }

  // Nudged once already — the only remaining move is to stop and say so.
  const since = nudgedAt != null ? nudgedAt : sentAt;
  if (nowMs - since < GIVE_UP_AFTER_MS) return { action: 'skip', reason: 'awaiting_nudge_response' };
  return { action: 'give_up', reason: 'no_tap_after_nudge' };
}

module.exports = { classifyUntappedDelivery, NUDGE_AFTER_MS, GIVE_UP_AFTER_MS };
