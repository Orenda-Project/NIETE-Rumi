'use strict';
/**
 * WHO A USERS ROW IS, read from the row and its activity — the teacher signs the student ingress decides on, in a
 * leaf module (supabase, the logger and the identity switches only) so any reader can share them without a require
 * cycle. student-ingress.js re-exports them unchanged.
 *
 *   identity(user)            a real sign that an ADULT registered or was rostered on this row (pure)
 *   activity(userId)          teacher activity: true / false / null (a read failed — never "no rows")
 *   activityAll(userId)       the same verdict with every count read together (one round trip)
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

const ACTIVITY_CHECKS = Object.freeze([
  ['quizzes', 'teacher_id', null],
  ['coaching_sessions', 'user_id', null],
  ['lesson_plans', 'user_id', 'gamma_url.not.is.null,pdf_url.not.is.null'],
  ['student_lists', 'user_id', null],
  ['training_assessment_attempts', 'user_id', null],
  ['assessment_requests', 'user_id', null],
]);

/** Teacher activity on this user id. true / false / null (a read failed). */
async function activity(userId) {
  if (!userId) return false;
  for (const [table, column, orFilter] of ACTIVITY_CHECKS) {
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
 * activity() with every count started together (the self-join's fast path, quiz_join_fast): the same verdict, read in
 * the same order — the first failed read before any hit is null, the first hit is true — in one round trip instead of
 * seven. The class-teacher count is read beside the others and weighed only when the phone-binding switch is on; that
 * switch is asked only when no other count decided, as activity() asks it (a cold switch costs a hit nothing).
 */
async function activityAll(userId) {
  if (!userId) return false;
  const [counts, classTeacher] = await Promise.all([
    Promise.all(ACTIVITY_CHECKS.map(([table, column, orFilter]) => hasAnyRow(table, column, userId, orFilter))),
    hasAnyRow('class_teachers', 'teacher_user_id', userId, null, { is_active: true }),
  ]);
  for (const r of counts) {
    if (r === null) return null;
    if (r) return true;
  }
  if (await phoneBindOn()) {
    if (classTeacher === null) return null;
    if (classTeacher) return true;
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

module.exports = { IDENTITY_FIELDS, identity, hasAnyRow, activity, activityAll, withIdentityFields };
