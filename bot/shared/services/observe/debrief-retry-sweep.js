/**
 * bd-2kxxa.3 — self-heal for debrief recordings whose transcription failed.
 *
 * WHY: on 1 Sep 2026 the transcription provider's balance was exhausted for
 * 17 hours. processDebriefRecording had no catch around transcription, so the
 * throw reached handleJobFailure (a deliberate no-op for observe jobs), SQS
 * retried 3x inside ~45 minutes — all inside the outage — and dead-lettered.
 * The row stayed debrief_status='pending' with audio_id set and transcript
 * null; the coach had only ever heard "feedback in a few minutes"; nothing
 * retried. 11 debriefs across 6 coaches were stuck when this was written.
 *
 * This module is the PURE half: given the narrow projection the worker pulls,
 * decide which rows get re-queued. The worker (sqs-worker.js
 * runDebriefRetrySweep) owns the DB read, the per-row Redis single-flight
 * lock, the queue call and the per-tick log line. processDebriefRecording is
 * idempotent under a re-queue: it reads audio_id from the row, skips
 * re-transcription when a transcript is stored, and delivers-only when
 * feedback is stored.
 *
 * Rules (each one assertion in the truth-table test):
 *   pending only          debrief_status is a closed vocabulary read by the
 *                         /observe list — the catch never changes it
 *   has audio_id          "later" with no recording is not a failure
 *   no transcript         transcription already succeeded → LLM lane (bd-b5elb)
 *   old enough            minAgeMinutes since recorded_at AND since the last
 *                         failed_at — a 20-min transcription may still be live
 *   attempts < max        6 by default; a provider outage longer than
 *                         6 × (15-min tick + 30-min lock) is a human's problem
 *   inside the ceiling    Meta media ids expire ~30 days; 28 leaves margin
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const MAX_ATTEMPTS = 6;
const MIN_AGE_MINUTES = 30;
const MAX_AGE_DAYS = 28;

function _debriefOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.observer_debrief && typeof row.observer_debrief === 'object') return row.observer_debrief;
  if (row.analysis_data && row.analysis_data.observer_debrief
      && typeof row.analysis_data.observer_debrief === 'object') {
    return row.analysis_data.observer_debrief;
  }
  return null;
}

function _ms(iso) {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
}

/**
 * @param {Array<object>} rows   coaching_sessions rows — either the worker's
 *   narrow projection ({id, debrief_status, created_at, observer_debrief}) or
 *   full rows carrying analysis_data.observer_debrief
 * @param {number} nowMs
 * @param {{minAgeMinutes?: number, maxAttempts?: number, maxAgeDays?: number}} opts
 * @returns {Array<object>} the rows to re-queue, input order preserved
 */
function selectDebriefsToRetry(rows, nowMs = Date.now(), opts = {}) {
  const minAgeMinutes = Number.isFinite(opts.minAgeMinutes) ? opts.minAgeMinutes : MIN_AGE_MINUTES;
  const maxAttempts = Number.isFinite(opts.maxAttempts) ? opts.maxAttempts : MAX_ATTEMPTS;
  const maxAgeDays = Number.isFinite(opts.maxAgeDays) ? opts.maxAgeDays : MAX_AGE_DAYS;

  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.debrief_status !== 'pending') continue;
    const od = _debriefOf(row);
    if (!od || !od.audio_id) continue;
    if (od.transcript) continue;
    if ((Number(od.attempts) || 0) >= maxAttempts) continue;

    const recorded = _ms(od.recorded_at) ?? _ms(row.created_at);
    if (recorded === null) continue;
    if (nowMs - recorded > maxAgeDays * DAY) continue;

    const lastActivity = Math.max(recorded, _ms(od.failed_at) ?? 0);
    if (nowMs - lastActivity < minAgeMinutes * MINUTE) continue;

    out.push(row);
  }
  return out;
}

module.exports = { selectDebriefsToRetry, MAX_ATTEMPTS, MIN_AGE_MINUTES, MAX_AGE_DAYS };
