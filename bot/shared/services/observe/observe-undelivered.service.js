/**
 * Observations that finished and never reached the teacher.
 *
 * Teacher delivery on the coach path is a manual action: she taps Send, checks
 * the preview, taps Send again. Three of the states that flow writes are read
 * by nothing at all.
 *
 *   awaiting_confirm   the preview was shown and she tapped neither Send nor
 *                      Cancel -- she closed WhatsApp, lost signal, or was
 *                      pulled into the next lesson
 *   previewing         the render was queued and she left before it arrived
 *   (no record)        she never opened the send flow on that observation
 *
 * A repo-wide grep finds the writes and no read: the one existing sweep that
 * looks inside `teacher_delivery` narrows to `awaiting_teacher_tap` in the
 * query itself, so these three are structurally invisible rather than missed by
 * a filter -- they are sub-states of `analysis_data` on a session whose own
 * `status` is already terminal.
 *
 * Measured read-only on production 15 Sep: of 2,499 finished coach
 * observations, 465 carry no delivery record, 62 sit at `awaiting_confirm` and
 * 12 at `previewing`. 539 reports, across 51 coaches, that no mechanism will
 * ever mention again. Every day in the fortnight before produced 13-26 more.
 *
 * WHY THE SHAPE IS WHAT IT IS. 407 of those 539 are already over a week old.
 * A planner that simply reminds everyone overdue would fire roughly 400
 * messages on its first tick -- a mistake already on the record for the sibling
 * untapped sweep, whose remedy is copied here: past the ceiling, a delivery
 * NOBODY ever chased is closed silently. A row that HAS been chased still ends
 * in give_up and the coach is still told, because that is the closing event
 * this planner exists to deliver, and it fires exactly once.
 *
 * Deliberately NOT in scope: `awaiting_observer_review`, which has its own
 * owner mid-fix, and `awaiting_teacher_tap`, which the untapped planner owns.
 * Two sweeps on one row is how a coach gets told two contradictory things about
 * the same observation in the same tick.
 *
 * Pure -- no I/O, no clock of its own, mirroring its siblings: the planner
 * decides, the worker executes.
 */

const HOUR = 60 * 60 * 1000;

/**
 * The delivery states this planner owns. A null/absent `teacher_delivery` is
 * the third case and is handled separately, because there is no status string
 * to match on.
 *
 * Exported as a set so the worker's queries and this table cannot drift apart —
 * a query that selected a state the planner refuses would read rows every tick
 * and act on none, which looks exactly like an empty backlog.
 */
const OWNED_DELIVERY_STATES = new Set(['awaiting_confirm', 'previewing']);

/**
 * Session statuses at which the report EXISTS. Anything else and there is
 * nothing to deliver yet, so chasing the coach would be noise about work she
 * has not finished.
 */
const FINISHED_SESSION_STATUSES = new Set(['completed', 'observer_review_complete']);

const _hoursFromEnv = (name, defaultMs) => {
  const hours = Number(process.env[name]);
  if (Number.isFinite(hours) && hours > 0) return hours * HOUR;
  return defaultMs;
};

/** A full day before we say anything: she may simply be teaching. */
const REMIND_AFTER_MS = _hoursFromEnv('OBSERVE_UNDELIVERED_REMIND_HOURS', 24 * HOUR);
/** …and a further two days after the reminder before we stop and say so. */
const GIVE_UP_AFTER_MS = _hoursFromEnv('OBSERVE_UNDELIVERED_GIVE_UP_HOURS', 72 * HOUR);
/**
 * Past this, a delivery nobody has chased is CLOSED SILENTLY.
 *
 * Env-overridable so the ramp can be widened or narrowed without a deploy —
 * the backlog's shape changes the moment it starts draining, and the operator
 * reads a dry-run tally before this is ever switched on.
 */
const EXPIRE_AFTER_MS = _hoursFromEnv('OBSERVE_UNDELIVERED_EXPIRE_HOURS', 7 * 24 * HOUR);

const parsed = (iso) => {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso.getTime();
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/**
 * @param {object} candidate
 * @param {string|null} candidate.deliveryStatus analysis_data.teacher_delivery.status
 *   (null/undefined for a finished observation with no delivery record at all)
 * @param {string} candidate.sessionStatus coaching_sessions.status
 * @param {string} candidate.finishedAt when the report became available
 * @param {string|null} candidate.reminded_at teacher_delivery.reminded_at
 * @param {string|null} candidate.gave_up_at teacher_delivery.gave_up_at
 * @param {number} nowMs
 * @returns {{action:'skip'|'remind'|'give_up'|'expire', reason:string}}
 */
function classifyUndelivered(candidate, nowMs = Date.now()) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};

  // The report has to exist before anyone can be chased about sending it. This
  // is also the boundary with the other owner: `awaiting_observer_review` is a
  // SESSION status, and it is not ours.
  if (!FINISHED_SESSION_STATUSES.has(c.sessionStatus)) {
    return { action: 'skip', reason: 'session_not_finished' };
  }

  const status = c.deliveryStatus;
  const noRecord = status === null || status === undefined || status === '';
  if (!noRecord && !OWNED_DELIVERY_STATES.has(status)) {
    return { action: 'skip', reason: 'not_undelivered' };
  }

  // Notify-once, both ways: a closed row is never reopened by a later tick.
  if (c.gave_up_at) return { action: 'skip', reason: 'already_closed' };

  const finishedAt = parsed(c.finishedAt);
  if (finishedAt == null) return { action: 'skip', reason: 'no_finished_timestamp' };

  const remindedAt = parsed(c.reminded_at);
  const alreadyReminded = remindedAt != null || Number(c.reminder_count || 0) > 0;

  if (!alreadyReminded) {
    if (nowMs - finishedAt < REMIND_AFTER_MS) {
      return { action: 'skip', reason: 'within_grace_window' };
    }
    // Never chased, and now too stale to start. Close it, say nothing.
    if (nowMs - finishedAt >= EXPIRE_AFTER_MS) {
      return { action: 'expire', reason: 'too_old_to_chase' };
    }
    return { action: 'remind', reason: 'no_send_after_grace' };
  }

  // Reminded once already -- the only remaining move is to stop and say so.
  // Measured from the REMINDER, not from the observation: give_up is the answer
  // to a question she was asked, so the clock starts when we asked it.
  const since = remindedAt != null ? remindedAt : finishedAt;
  if (nowMs - since < GIVE_UP_AFTER_MS - REMIND_AFTER_MS) {
    return { action: 'skip', reason: 'awaiting_reminder_response' };
  }
  return { action: 'give_up', reason: 'no_send_after_reminder' };
}

module.exports = {
  classifyUndelivered,
  OWNED_DELIVERY_STATES,
  FINISHED_SESSION_STATUSES,
  REMIND_AFTER_MS,
  GIVE_UP_AFTER_MS,
  EXPIRE_AFTER_MS,
};
