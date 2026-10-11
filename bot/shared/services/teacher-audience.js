'use strict';
/**
 * "EVERY TEACHER" AS A SWITCH VALUE — bd-fmf24g.46.
 *
 * A per-user switch in `app_settings` (the teacher app `portal_teacher_v2`, the WhatsApp app link
 * `app_redirect_<feature>`) has been `true` (every user) or a JSON list of users.id (a pilot). This adds a third,
 * deliberate value: the string "teachers" — every user whose `users.role` is 'teacher'.
 *
 *   - Not the leader family (principal, coach, aeo, supervisor, school_leader): their portal is the leader views
 *     (My Patch, their teachers, observe, schedules), and the teacher app has none of them.
 *   - Not role 'unregistered'.
 *
 * WHY A STRING AND NOT `true`. Code from before this value existed reads "teachers" as OFF, on both flags. So
 * rolling the code back can never switch anything on for everyone — whereas `app_redirect_*` = true is the Play
 * Store notice to EVERY user, and `portal_teacher_v2` = true puts principals on the teacher app.
 *
 * ONE ANSWER. The bot (app-redirect.service.js: who gets the link) and the portal (dashboard/lib/feature-flags.js
 * isFlagEnabledForUser: who sees the teacher app) both read the value and the role through this module, so a link
 * is never sent to a page its teacher cannot open. Pure: no I/O here; each caller reads `users.role` itself.
 */

const TEACHERS = 'teachers';

/** Is this app_settings value "teachers"? Takes the raw value: a string, or the same written as JSON text. */
function isTeachersValue(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* a bare string — keep it */ }
  }
  return typeof v === 'string' && v.trim().toLowerCase() === TEACHERS;
}

/** Is this users.role a teacher? Registration stores the raw string, so trim + lowercase (as leader-role.js does). */
function isTeacherRole(role) {
  return typeof role === 'string' && role.trim().toLowerCase() === 'teacher';
}

module.exports = { isTeachersValue, isTeacherRole };
