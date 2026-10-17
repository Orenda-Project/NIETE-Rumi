'use strict';
/**
 * WHO A USERS ROW IS, read from the row and its activity — the teacher signs the student ingress decides on, in a
 * leaf module (supabase, the logger and the identity switches only) so any reader can share them without a require
 * cycle. student-ingress.js re-exports them unchanged.
 *
 *   identity(user)            a real sign that an ADULT registered or was rostered on this row (pure)
 *   activity(userId)          teacher activity: true / false / null (a read failed — never "no rows")
 *   withIdentityFields(user)  the row with every identity column read once, or null when that read failed
 */
const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const IdFlags = require('./quiz/web-quiz-identity-flags');

async function phoneBindOn() {
  try { return Boolean((await IdFlags.flags()).phoneBind); } catch (_) { return false; }
}

const IDENTITY_FIELDS = ['registration_completed', 'registration_state', 'name', 'teacher_uuid',
  'school_id', 'portal_activated', 'role'];

/** Any real sign that an ADULT registered or was rostered on this row. */
function identity(user) {
  if (!user) return false;
  return Boolean(
    user.registration_completed === true
    || user.registration_state === 'completed'
    || (typeof user.name === 'string' && user.name.trim())
    || user.teacher_uuid
    || user.school_id
    || user.portal_activated === true
    || user.role === 'coach' || user.role === 'principal',
  );
}

/**
 * Does this user own a row in `table` under `column` (optionally with an extra
 * `.or()` filter)? Head count only. null means the read FAILED — never
 * collapsed into "no rows": that collapse is how a teacher becomes a child
 * during a database hiccup.
 */
async function hasAnyRow(table, column, id, orFilter = null, eqs = null) {
  try {
    let q = supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, id);
    if (orFilter) q = q.or(orFilter);
    if (eqs) Object.entries(eqs).forEach(([c, v]) => { q = q.eq(c, v); });
    const { count, error } = await q;
    if (error) {
      logToFile('⚠️ student-ingress: activity lookup failed', { table, error: error.message });
      return null;
    }
    return (count || 0) > 0;
  } catch (err) {
    logToFile('⚠️ student-ingress: activity lookup threw', { table, error: err.message });
    return null;
  }
}

/** Teacher activity on this user id. true / false / null (a read failed). */
async function activity(userId) {
  if (!userId) return false;
  const checks = [
    ['quizzes', 'teacher_id', null],
    ['coaching_sessions', 'user_id', null],
    ['lesson_plans', 'user_id', 'gamma_url.not.is.null,pdf_url.not.is.null'],
    ['student_lists', 'user_id', null],
    ['training_assessment_attempts', 'user_id', null],
    ['assessment_requests', 'user_id', null],
  ];
  for (const [table, column, orFilter] of checks) {
    const r = await hasAnyRow(table, column, userId, orFilter);
    if (r === null) return null;
    if (r) return true;
  }
  // family phone binding: a class teacher's own phone is a teacher's even with none of the signs above
  if (await phoneBindOn()) {
    const r = await hasAnyRow('class_teachers', 'teacher_user_id', userId, null, { is_active: true });
    if (r === null) return null;
    if (r) return true;
  }
  return false;
}

/**
 * The users row from getOrCreateUser may not carry every identity column; if
 * one is missing, read them once rather than guess "no identity".
 */
async function withIdentityFields(user) {
  if (!user || !user.id) return user;
  const missing = IDENTITY_FIELDS.some((f) => !(f in user));
  if (!missing) return user;
  try {
    const { data, error } = await supabase.from('users').select(IDENTITY_FIELDS.join(','))
      .eq('id', user.id).maybeSingle();
    if (error || !data) return null;            // unknown, towards teacher
    return { ...user, ...data };
  } catch (err) {
    logToFile('⚠️ student-ingress: identity read threw', { error: err.message });
    return null;
  }
}

module.exports = { IDENTITY_FIELDS, identity, hasAnyRow, activity, withIdentityFields };
