'use strict';

/**
 * The bound teacher's users.id, for an observation owned by the teacher. A leaf on purpose: the
 * capture (observe-capture.service) and the /observe2 link (observe2/capture-link, reached from the
 * "who did you observe?" answer) both need it, and observe-capture already requires observe-who, so
 * the rule lives here rather than in either of them (tests/setup/circular-deps.test.js).
 */

const supabase = require('../../config/supabase');
const { DEFAULT_LANGUAGE } = require('../../config/languages');

/**
 * Resolve the visit-picker's bound teacher to a users.id so the session row is
 * owned by the TEACHER (the teacher's trend keys correctly from day one) while
 * the coach stays observer_user_id.
 * Prefer the bound user_id; else look up by phone; else create a minimal
 * teacher row. ANY failure → null (observer stays owner — never dead-end).
 */
async function resolveBoundTeacherUserId(boundTeacher) {
  try {
    if (!boundTeacher) return null;
    if (boundTeacher.user_id) return boundTeacher.user_id;
    const phone = boundTeacher.phone_e164;
    if (!phone) return null;
    const { data: existing } = await supabase
      .from('users').select('id').eq('phone_number', phone).limit(1);
    if (existing && existing[0]) return existing[0].id;
    const name = (boundTeacher.teacher_name || '').trim();
    const { data: created, error } = await supabase
      .from('users')
      .insert({
        phone_number: phone,
        name: name ? name.split(/\s+/)[0] : null,
        name: name || null,
        role: 'teacher',
        preferred_language: boundTeacher.preferred_language || DEFAULT_LANGUAGE,
        source: 'observe_visit_bind',
      })
      .select()
      .single();
    if (error || !created) return null;
    return created.id;
  } catch (_) {
    return null;
  }
}

module.exports = { resolveBoundTeacherUserId };
