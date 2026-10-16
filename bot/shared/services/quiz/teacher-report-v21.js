'use strict';
/**
 * bd-v0toag.10 (2a, 2d) — behind app_settings `quiz_slo_retest_enabled`.
 *
 * Every attempt is already its own quiz_sessions row (video-quiz / web-quiz insert one per
 * start; nothing deletes them). The report keeps counting ONE attempt per child for the score;
 * these helpers add how many tries each child made and how many who started went on to finish.
 * Pure: the rows are the ones teacher-report.data already read.
 */

const NOT_STARTED = new Set(['invited', 'cancelled']);

function childKey(s) {
  if (s.student_id) return s.student_id;
  if (s.device_ref) return `d:${s.device_ref}`;
  return `s:${s.id}`;
}

// The class report's own exclusions: the teacher's own run, friends a child invited, and rows
// that never started.
function startedRows(rows, teacherId) {
  return (rows || []).filter((s) => s
    && !(s.user_id && teacherId && s.user_id === teacherId)
    && !s.invited_by_student_id
    && !NOT_STARTED.has(s.status));
}

/** childKey → number of attempts. */
function attemptCounts(rows, teacherId) {
  const m = new Map();
  startedRows(rows, teacherId).forEach((s) => { const k = childKey(s); m.set(k, (m.get(k) || 0) + 1); });
  return m;
}

/** Children who started vs the counted finishers; null when nobody started. */
function completion(rows, teacherId, finished) {
  const started = Math.max(new Set(startedRows(rows, teacherId).map(childKey)).size, finished || 0);
  if (!started) return null;
  return { started, finished: finished || 0, pct: Math.round(((finished || 0) / started) * 100) };
}

module.exports = { childKey, attemptCounts, completion };
