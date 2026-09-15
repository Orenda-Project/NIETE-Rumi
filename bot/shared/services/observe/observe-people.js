'use strict';
/**
 * WHO is the teacher, and WHO is the coach. One owner, two audiences.
 *
 * `coaching_sessions.user_id` holds the BOUND TEACHER when the coach picked her
 * in the visit Flow, and the coach herself when she did not — 98% of finished
 * observations are bound, so the bound case is the normal one. Every surface
 * that read `session.users` therefore got whichever of the two the row happened
 * to carry, and on a bound session that is the teacher. Measured 15 Sep 2026:
 * ~277 delivery confirmations and 238 nudge/give-up messages went to the
 * teacher instead of the coach, addressed with the teacher's own name, and the
 * report's "From {coach}" line named the teacher to herself.
 *
 * The same confusion was already solved for LANGUAGE by naming the audience
 * (observe-language.js). This is the identity half, deliberately the same
 * shape: one read-only users lookup, a clamped result, null on any failure —
 * never a guess, and never the other party.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const _s = (v) => {
  const t = String(v == null ? '' : v).trim();
  return t || null;
};

/** One read-only users lookup. Returns a person shape or null, never throws. */
async function _person(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, phone_number')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return { userId: data.id, name: _s(data.name), phone: _s(data.phone_number) };
  } catch (err) {
    logToFile('⚠️ observe-people: users lookup failed', { userId, error: err.message });
    return null;
  }
}

/**
 * The OBSERVED teacher, in resolution order:
 *   1. the identity the coach named for this report (`teacher_delivery`) — the
 *      only identity a hand-typed teacher has, so this cannot be skipped;
 *   2. the session's own `user_id`, but ONLY when the observation is bound. On
 *      a bare capture that column is the coach, so it is deliberately ignored;
 *   3. null. A bare capture genuinely has no observed teacher on the row, and
 *      returning the coach there is the defect this module exists to prevent.
 */
async function teacherOf(session) {
  const s = session || {};
  const delivery = (s.analysis_data && s.analysis_data.teacher_delivery) || {};
  const namedPhone = _s(delivery.teacher_phone);
  if (namedPhone) {
    return { userId: null, name: _s(delivery.teacher_name), phone: namedPhone };
  }

  const teacherUserId = s.user_id;
  const isBound = teacherUserId && teacherUserId !== s.observer_user_id;
  if (!isBound) return null;
  return _person(teacherUserId);
}

/**
 * The COACH — always `observer_user_id`, on bound and bare sessions alike. Her
 * acks, her nudges and the report's "From" line are hers.
 */
async function coachOf(session) {
  return _person(session && session.observer_user_id);
}

/** Is this observation bound to somebody other than the observer? */
function isBound(session) {
  const s = session || {};
  return !!(s.user_id && s.observer_user_id && s.user_id !== s.observer_user_id);
}

module.exports = { teacherOf, coachOf, isBound };
