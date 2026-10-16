'use strict';
/**
 * coaching.report.* log events (bd-v0toag.1.2 / .1.3) — Axiom dataset niete-logs, via the structured logger.
 *
 * Logging only: no table, no column, nothing a teacher sees. Every event names the teacher by her users.id
 * (a uuid — a phone number is dropped, never logged) and the coaching_sessions.id; logEvent adds the
 * correlationId from the job's runWithCorrelation context. A logging failure never reaches the caller.
 *
 * Mapping (what each requested event is, in this codebase):
 *   generated        — the report was rendered (with voice-note seconds + report text length, .1.3)
 *   sent             — WhatsApp accepted the report image / PDF (a duplicate send is not logged again)
 *   opened           — portal GET /api/portal/coaching-session/:id; logged by dashboard telemetry, not here
 *   move_committed   — "Yes" on "Will you commit to trying this in your next class?" (card_yes_<session>)
 *   check_back_sent  — the prior commitment came back on her next recording (priorActionReminder)
 *   check_back_reply — design pending: nothing captures a reply to the check-back
 *   disputed         — design pending: there is no "Do you agree with this report?" step on this branch
 */
const { logEvent } = require('../../utils/structured-logger');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const chars = (s) => (typeof s === 'string' ? [...s].length : null);

/** Characters across every string in the narrative (headline, moments, strength…); null when there is none. */
function narrativeChars(n) {
  if (!n || typeof n !== 'object') return null;
  let total = 0;
  const walk = (v) => {
    if (typeof v === 'string') total += [...v].length;
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(n);
  return total;
}

function emit(event, data) {
  try {
    logEvent(event, { ...data, userId: uuidOrNull(data.userId) });
  } catch (_) { /* logging never breaks the flow it watches */ }
}

function reportGenerated({ userId, sessionId, format, audioDurationSeconds, caption, narrative }) {
  const dur = Number(audioDurationSeconds);
  emit('coaching.report.generated', {
    userId, sessionId, format,
    audioDurationSec: audioDurationSeconds == null || !Number.isFinite(dur) ? null : Math.round(dur),
    reportChars: chars(caption),
    narrativeChars: narrativeChars(narrative),
  });
}

function reportSent({ userId, sessionId, format }) {
  emit('coaching.report.sent', { userId, sessionId, format });
}

function moveCommitted({ userId, sessionId }) {
  emit('coaching.report.move_committed', { userId, sessionId });
}

function checkBackSent({ userId, sessionId, priorSessionId, merged }) {
  emit('coaching.report.check_back_sent', { userId, sessionId, priorSessionId: priorSessionId || null, merged: !!merged });
}

module.exports = { reportGenerated, reportSent, moveCommitted, checkBackSent };
