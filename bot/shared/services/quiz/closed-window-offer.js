'use strict';
/**
 * The coaching quiz offer for a teacher whose 24 h WhatsApp window is CLOSED.
 *
 * WHY. Since bd-v0toag.126 the free-form offer (video + Yes / Not now) is skipped when the window is closed,
 * because Meta refuses it with 131047. The skip left no row: the offer service skips before its claim, so the
 * only trace was a log line, and a third of recording teachers dropped out of the quiz funnel as if they had
 * drifted away. Yet the coaching report itself already reaches that teacher, as the approved share template
 * (coaching/report-window-send.js). This module lets the quiz ride on that same message.
 *
 * TWO THINGS, one switch.
 *   trace            the skip writes the session's `quizzes` row (status 'skipped', meta.skip_reason
 *                    'window_closed', meta.held_path). The unique index (one transcript quiz per session) makes it
 *                    the same row a later claim would have made, so a later offer or tap revives it
 *                    (reviveHeld) instead of being refused as "already claimed".
 *   report_template  the report goes as a sibling of the share template with ONE quick-reply button, "Make a
 *                    quiz", whose payload is `tqr_<coachingSessionId>`. The report template itself is untouched:
 *                    if Meta re-categorises the sibling, only those sends change price and the switch puts every
 *                    report back on the plain template. A tap is the teacher writing to us, so it opens the window,
 *                    and it is the yes: the offer service digests and goes straight to the quiz.
 *
 * THE SWITCH. `app_settings.quiz_offer_closed_window`, a JSON object:
 *   { "trace": true, "report_template": "share_dc_report_quiz_v1" }
 * Missing row, not an object, or unreadable = off (no trace, no button: exactly the behaviour before). A
 * report_template implies trace. Read at most every 30 seconds; a failed read is not cached (fail closed).
 *
 * NOTHING HERE SENDS. Reads and the one insert; every failure is logged and answered as "off" / null.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const SETTING = 'quiz_offer_closed_window';
const TTL_MS = 30 * 1000;
/** Meta template names: lowercase letters, digits and underscores. */
const NAME_RE = /^[a-z0-9_]{1,512}$/;
const TAP_PREFIX = 'tqr_';
const TAP_RX = /^tqr_([0-9a-fA-F-]{36})$/;
const HELD_REASON = 'window_closed';
const HELD_PATHS = Object.freeze({ TEMPLATE: 'template', NONE: 'none' });

const OFF = Object.freeze({ trace: false, reportTemplate: null });
let cache = null; // { at, value }

function _resetCache() { cache = null; }

function parse(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return OFF; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return OFF;
  const name = typeof v.report_template === 'string' ? v.report_template.trim() : '';
  const reportTemplate = NAME_RE.test(name) ? name : null;
  return { trace: v.trace === true || Boolean(reportTemplate), reportTemplate };
}

/** @returns {Promise<{trace: boolean, reportTemplate: string|null}>} */
async function settings(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SETTING]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === SETTING);
    const value = row ? parse(row.value) : OFF;
    cache = { at: now, value };
    return value;
  } catch (err) {
    logToFile('⚠️ closed-window quiz offer: setting unreadable — off', { error: err.message }, 'warn');
    return OFF;
  }
}

/** The coaching session a "Make a quiz" tap names, or null. Payload only: the label alone never names a session. */
function matchReportQuizTap({ payload } = {}) {
  const m = TAP_RX.exec(String(payload || '').trim());
  return m ? m[1] : null;
}

function tapPayload(coachingSessionId) {
  return `${TAP_PREFIX}${coachingSessionId}`;
}

/**
 * The skip's row: the session's transcript quiz, held because the window was closed. A second write for the same
 * session (the report wrote it, then the offer job) is the unique index saying it is already there: true.
 * @returns {Promise<boolean>} true when the row is there
 */
async function recordHeld({ session, heldPath }) {
  if (!session || !session.id || !session.user_id) return false;
  const path = heldPath === HELD_PATHS.TEMPLATE ? HELD_PATHS.TEMPLATE : HELD_PATHS.NONE;
  try {
    const { error } = await supabase.from('quizzes').insert({
      teacher_id: session.user_id,
      quiz_source: 'transcript',
      coaching_session_id: session.id,
      topic: (session.analysis_data && session.analysis_data.topic) || 'Lesson',
      subject: (session.analysis_data && session.analysis_data.subject) || null,
      status: 'skipped',
      meta: { step: 'skipped', skip_reason: HELD_REASON, held_path: path, held_at: new Date().toISOString() },
    });
    if (error && error.code !== '23505') throw new Error(error.message || 'insert failed');
    return true;
  } catch (err) {
    logToFile('❌ closed-window quiz offer: skip row not written', { coachingSessionId: session.id, error: err.message }, 'error');
    return false;
  }
}

/**
 * A held row back to 'generating' — the claim, for a session whose offer was held for a closed window. Only a row
 * still skipped for that reason moves (atomic filter), so a double tap or a racing job moves it once.
 * @returns {Promise<{quizId: string, heldPath: string|null}|null>}
 */
async function reviveHeld({ coachingSessionId, source }) {
  const { data, error } = await supabase.from('quizzes')
    .select('id, status, meta')
    .eq('coaching_session_id', coachingSessionId)
    .eq('quiz_source', 'transcript')
    .maybeSingle();
  if (error || !data) return null;
  const meta = data.meta || {};
  if (data.status !== 'skipped' || meta.skip_reason !== HELD_REASON) return null;
  const { data: moved } = await supabase.from('quizzes')
    .update({
      status: 'generating',
      meta: { step: 'digest', source: source || 'offer', claimed_at: new Date().toISOString(),
        held_path: meta.held_path || null, revived_from: HELD_REASON },
    })
    .eq('id', data.id).eq('status', 'skipped')
    .select('id');
  if (!moved || !moved.length) return null;
  return { quizId: data.id, heldPath: meta.held_path || null };
}

/** The held row's path for this session, or null when there is none. Read-only. */
async function heldPathOf(coachingSessionId) {
  try {
    const { data } = await supabase.from('quizzes')
      .select('status, meta')
      .eq('coaching_session_id', coachingSessionId)
      .eq('quiz_source', 'transcript')
      .maybeSingle();
    return data && data.status === 'skipped' && data.meta && data.meta.skip_reason === HELD_REASON
      ? (data.meta.held_path || HELD_PATHS.NONE) : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  settings, parse, matchReportQuizTap, tapPayload, recordHeld, reviveHeld, heldPathOf, _resetCache,
  SETTING, TAP_PREFIX, HELD_REASON, HELD_PATHS,
};
