/**
 * Retry cooldown after a failed exam — one place for the hours, the ISO stamp
 * and the sentence that tells the teacher (bd-vej4h, bd-s42dye.5).
 *
 * The hours come from training_vendors.cooldown_hours. Unreadable / negative /
 * non-numeric falls back to 24 (fail closed: an unknown vendor keeps the wait
 * it always had). 0 is a real value: retakes are immediate (I-SAPS).
 *
 * The WRITE (cooldownUntilFor) and the COPY (retryLine) both go through
 * effectiveCooldownHours, so what the teacher is told cannot drift from what
 * is stored. The copy used to say "Try again in 24 hours" for a vendor whose
 * cooldown_until was already null.
 *
 * Pure: no DB, no WhatsApp. quiz-delivery.service re-exports cooldownUntilFor.
 */

const COOLDOWN_HOURS = 24;

/** @param {*} hours training_vendors.cooldown_hours (may be undefined/null) */
function effectiveCooldownHours(hours) {
  const h = Number(hours);
  if (hours === null || hours === undefined || !Number.isFinite(h) || h < 0) return COOLDOWN_HOURS;
  return h;
}

/**
 * @param {number|null|undefined} hours
 * @param {number} [nowMs]
 * @returns {string|null} ISO timestamp, or null for no cooldown
 */
function cooldownUntilFor(hours, nowMs = Date.now()) {
  const use = effectiveCooldownHours(hours);
  if (use === 0) return null;
  return new Date(nowMs + use * 3_600_000).toISOString();
}

/** The retry sentence for a failed exam. 0 hours → offered now, no hours named. */
function retryLine(hours) {
  const use = effectiveCooldownHours(hours);
  if (use === 0) return 'You can take the exam again now. Use a little time to review the modules you struggled with first, if you like.';
  return `Try again in *${use} ${use === 1 ? 'hour' : 'hours'}*. Use that time to review the modules you struggled with.`;
}

module.exports = { COOLDOWN_HOURS, effectiveCooldownHours, cooldownUntilFor, retryLine };
