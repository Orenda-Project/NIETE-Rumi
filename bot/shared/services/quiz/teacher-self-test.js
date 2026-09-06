'use strict';
/**
 * PLAN_R5 §1 D8 — a teacher who takes her own class link is recorded as
 * herself, not as a new child.
 *
 * THE MARKER
 * `quiz_sessions.user_id` already means "the registered user who took this
 * session" — `source='video_solo'` sets it. Every `share_link` session is
 * inserted with `userId: null` (video-quiz-share.service.js's
 * `startForStudent`/`consumeJoinReply`), so within one share code,
 * `user_id = teacher_user_id` cannot collide with anything else. No schema
 * change: `quiz_sessions_source_check` does not allow a new `source` value,
 * and widening it would put the live share-link join path behind a schema
 * change for no reason: a live join path must never wait on a migration.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const StudentIdentity = require('./student-identity.service');
const { retireQuizStudentRows } = require('../student-mode.service');

/** Pure: is this SESSION row the teacher's own test run? Never true on a
 *  falsy id either side — a child row (`user_id: null`) is never a self-test,
 *  and a session with no teacherUserId to compare against is never one either. */
function isSelfTest(session, teacherUserId) {
  if (!session || !teacherUserId) return false;
  return Boolean(session.user_id) && session.user_id === teacherUserId;
}

/** Pure: the sessions that are NOT the teacher's own test run. Returns a new
 *  array; never mutates its input. */
function excludeSelfTests(sessions, teacherUserId) {
  return (sessions || []).filter((s) => !isSelfTest(s, teacherUserId));
}

/**
 * Does this inbound phone belong to the teacher who owns this share code?
 *
 * Reads `users` once for the teacher's own phone and name, then compares
 * BOTH phones after normalising with `StudentIdentity.normalisePhone` — the
 * same handset reaches us as `+92 300 …`, `0300…` and `92300…`.
 *
 * Fails OPEN (returns null) on any miss, mismatch, or error: a lookup
 * failure must never stop a quiz from starting (same discipline as
 * `StudentIdentity.findByPhone`).
 */
async function resolveSelfTest({ phone, teacherUserId }) {
  if (!phone || !teacherUserId) return null;
  try {
    const { data: teacher, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, phone_number')
      .eq('id', teacherUserId)
      .maybeSingle();
    if (error || !teacher?.phone_number) return null;

    const inbound = StudentIdentity.normalisePhone(phone);
    const hers = StudentIdentity.normalisePhone(teacher.phone_number);
    if (!inbound || !hers || inbound !== hers) return null;

    // bd-mg9c7.88 residue: a teacher who joined her own class links as a child
    // before this self-test path existed carries stray quiz-joined `students`
    // rows on this same handset. Now that we know this phone IS the teacher,
    // retire them so the data stops lying about who owns the phone.
    // retireQuizStudentRows never throws and is scoped to list_id IS NULL — an
    // attendance-roster child is untouched. A retire failure must never stop
    // the self-test from being recognised, so nothing here can affect `return`.
    const retired = await retireQuizStudentRows(phone, 'self_test');
    if (retired > 0) {
      logEvent('video_quiz.self_test_rows_retired', { userId: teacher.id, retired });
    }

    const name = [teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || null;
    return { userId: teacher.id, name };
  } catch (err) {
    logToFile('⚠️ teacher self-test lookup threw', { error: err.message });
    return null;
  }
}

module.exports = { isSelfTest, excludeSelfTests, resolveSelfTest };
