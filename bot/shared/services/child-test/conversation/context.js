'use strict';

/**
 * Where the child test happens, worked out so the coach is asked for nothing that can be inferred.
 *
 *   visit (observe2 field form) → school (L3 draw.resolveVisitSchool) and the observed teacher
 *   observed teacher → class_teachers → classes.grade_code: a Grade 3 or 5 class is the observed
 *   grade (and class); otherwise null and the draw alternates Grade 3 / Grade 5.
 *   no visit → today's observe2 visit by this coach, else the coach's assigned schools.
 */

const supabase = require('../../../config/supabase');
const ports = require('./ports');
const { logError } = require('../../../utils/logger');

const GRADE_OF = { grade_3: 3, grade_5: 5 };
const PKT_OFFSET_MS = 5 * 3600 * 1000;   // Asia/Karachi, no DST

function startOfTodayPkt(now = new Date()) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  return new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS).toISOString();
}

/** The observed teacher's Grade 3 / Grade 5 class at this school, if any. */
async function observedClass(teacherUserId, schoolId) {
  if (!teacherUserId) return { observedGrade: null, observedClassId: null };
  const { data: links, error } = await supabase.from('class_teachers').select('class_id')
    .eq('teacher_user_id', teacherUserId).eq('is_active', true);
  if (error) { logError('child_test.context_class_teachers_failed', { teacherUserId, error: error.message }); return { observedGrade: null, observedClassId: null }; }
  for (const { class_id: classId } of links || []) {
    const { data: cls } = await supabase.from('classes').select('id, grade_code, school_id, is_active')
      .eq('id', classId).maybeSingle();
    if (!cls || cls.is_active === false || !GRADE_OF[cls.grade_code]) continue;
    if (schoolId && cls.school_id && cls.school_id !== schoolId) continue;
    return { observedGrade: GRADE_OF[cls.grade_code], observedClassId: cls.id };
  }
  return { observedGrade: null, observedClassId: null };
}

async function teacherSchool(teacherUserId) {
  if (!teacherUserId) return null;
  const { data } = await supabase.from('users').select('school_id').eq('id', teacherUserId).maybeSingle();
  return (data && data.school_id) || null;
}

/** An observe2 visit (field form) of this coach → { ok, ctx } | { ok:false, reason }. */
async function fromVisit({ coachUserId, visitId }) {
  const { data: form, error } = await supabase.from('observation_field_forms')
    .select('id, observer_user_id, teacher_user_id, visit_context').eq('id', visitId).maybeSingle();
  if (error) { logError('child_test.context_visit_failed', { visitId, error: error.message }); return { ok: false, reason: 'error' }; }
  if (!form) return { ok: false, reason: 'not_found' };
  if (form.observer_user_id !== coachUserId) return { ok: false, reason: 'not_yours' };
  let schoolId = null;
  const r = await ports.draw.resolveVisitSchool({ coachUserId, visitId });
  if (r && r.ok) schoolId = r.schoolId;
  if (!schoolId) schoolId = await teacherSchool(form.teacher_user_id);
  if (!schoolId) return { ok: false, reason: 'no_school' };
  const cls = await observedClass(form.teacher_user_id, schoolId);
  return { ok: true, ctx: { visitId, schoolId, ...cls } };
}

/** A classic /observe coaching session of this coach (prod ICT still runs /observe). No field form → visitId null. */
async function fromCoachingSession({ coachUserId, sessionId }) {
  const { data: s, error } = await supabase.from('coaching_sessions')
    .select('id, user_id, observer_user_id').eq('id', sessionId).maybeSingle();
  if (error) { logError('child_test.context_session_failed', { sessionId, error: error.message }); return { ok: false, reason: 'error' }; }
  if (!s) return { ok: false, reason: 'not_found' };
  if (s.observer_user_id !== coachUserId) return { ok: false, reason: 'not_yours' };
  const schoolId = await teacherSchool(s.user_id);
  if (!schoolId) return { ok: false, reason: 'no_school' };
  const cls = await observedClass(s.user_id, schoolId);
  return { ok: true, ctx: { visitId: null, coachingSessionId: sessionId, schoolId, ...cls } };
}

/** This coach's latest observe2 visit today (Pakistan time), or null. */
async function todaysVisitId(coachUserId) {
  const { data, error } = await supabase.from('observation_field_forms').select('id, created_at')
    .eq('observer_user_id', coachUserId).gte('created_at', startOfTodayPkt())
    .order('created_at', { ascending: false }).limit(1);
  if (error) { logError('child_test.context_today_failed', { coachUserId, error: error.message }); return null; }
  return (data && data[0] && data[0].id) || null;
}

/** The coach's assigned schools: [{ schoolId, name, emis }], one per school. */
async function coachSchools(coachUserId) {
  const { data, error } = await supabase.from('leader_schools').select('school_id, school_name, emis')
    .eq('leader_user_id', coachUserId);
  if (error) { logError('child_test.context_schools_failed', { coachUserId, error: error.message }); return []; }
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    if (!r.school_id || seen.has(r.school_id)) continue;
    seen.add(r.school_id);
    out.push({ schoolId: r.school_id, name: r.school_name || String(r.emis || ''), emis: r.emis ? String(r.emis) : null });
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** A school picked outside a visit: no visit, so no observed class; the draw alternates the grade. */
async function fromSchool({ coachUserId, schoolId }) {
  return { ok: true, ctx: { visitId: null, schoolId, observedGrade: null, observedClassId: null } };
}

module.exports = { fromVisit, fromCoachingSession, fromSchool, todaysVisitId, coachSchools, observedClass, startOfTodayPkt };
