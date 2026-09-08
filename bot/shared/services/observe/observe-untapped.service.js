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
/**
 * bd-n6fl1 — past this, a delivery nobody has chased is CLOSED SILENTLY.
 *
 * The sweep that runs this planner was blind for two weeks (an unordered
 * `.limit(500)` over a pool that had grown past 500), so the day it starts
 * seeing again it sees a backlog: measured on prod 2026-09-08, 31 reports
 * overdue for a first nudge, 21 of them between 7.3 and 12.4 days old. A nudge
 * about a twelve-day-old observation is not the bounded chase the operator asked
 * for; it is a spam wave. Anything past the ceiling is marked done without a
 * message to anyone — database-engineering §2 J6, "rows too old to act on are
 * closed silently, not messaged".
 *
 * This only ever catches deliveries NEVER chased. A report that HAS been nudged
 * still ends in give_up and the coach is still told, because that is the closing
 * event this planner exists to deliver, and it fires exactly once.
 *
 * Overridable so the ramp can be widened or narrowed without a deploy.
 */
const EXPIRE_AFTER_MS = (() => {
  const days = Number(process.env.OBSERVE_UNTAPPED_EXPIRE_DAYS);
  if (Number.isFinite(days) && days > 3) return days * 24 * HOUR;
  return 7 * 24 * HOUR;
})();

const parsed = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/**
 * @param {object} delivery analysis_data.teacher_delivery
 * @param {number} nowMs
 * @returns {{action:'skip'|'nudge'|'give_up'|'expire', reason:string}}
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
    // Never chased, and now too stale to start. Close it, say nothing.
    if (nowMs - sentAt >= EXPIRE_AFTER_MS) return { action: 'expire', reason: 'too_old_to_chase' };
    return { action: 'nudge', reason: 'no_tap_after_grace' };
  }

  // Nudged once already — the only remaining move is to stop and say so.
  const since = nudgedAt != null ? nudgedAt : sentAt;
  if (nowMs - since < GIVE_UP_AFTER_MS) return { action: 'skip', reason: 'awaiting_nudge_response' };
  return { action: 'give_up', reason: 'no_tap_after_nudge' };
}

module.exports = {
  classifyUntappedDelivery, NUDGE_AFTER_MS, GIVE_UP_AFTER_MS, EXPIRE_AFTER_MS,
};
