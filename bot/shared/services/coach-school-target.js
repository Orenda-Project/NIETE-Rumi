'use strict';
/**
 * School card landing targets for a /go token (a coach's `/school card` on WhatsApp).
 *
 *   coach_school:<EMIS>  one of her schools  → /portal/coach/school/<EMIS> (that school's page, where its card lives)
 *   coach_schools        no single school     → /portal/coach/people         (My schools)
 *
 * Modelled on fln-go-target.js. Pure: no env, no I/O. Three readers: `linkable` in app-login-link.js (so the token can
 * be signed and verified), the landing line in dashboard/routes/app-login.routes.js (it asks the coach-app question
 * first, as for any coach page), and app-redirect.service.js openSchoolCard (which mints them).
 *
 * The EMIS charset and length are the portal route's own (portal.routes.js GET /coach/school/:emis), anchored, so no
 * path, query or fragment can ride along. Nothing here checks that the school is hers: the page's own 404 is the
 * access check, which also covers a coach who lost the school after the link was sent.
 */

/** `coach_school:` + the EMIS, nothing else. */
const COACH_SCHOOL_TARGET = /^coach_school:([A-Za-z0-9-]{1,32})$/;

/** My schools. One fixed string, compared whole. */
const COACH_SCHOOLS = 'coach_schools';
const COACH_SCHOOLS_PATH = '/portal/coach/people';

/** True when `f` is a School card landing target. */
function isCoachSchoolTarget(f) {
  return typeof f === 'string' && (f === COACH_SCHOOLS || COACH_SCHOOL_TARGET.test(f));
}

/** The page for a School card target, or null for anything else. */
function coachSchoolPathFor(f) {
  if (typeof f !== 'string') return null;
  if (f === COACH_SCHOOLS) return COACH_SCHOOLS_PATH;
  const m = COACH_SCHOOL_TARGET.exec(f);
  return m ? `/portal/coach/school/${m[1]}` : null;
}

/** The target for one school's EMIS, or null when the EMIS is not a safe page key. */
function coachSchoolTarget(emis) {
  if (emis === null || emis === undefined) return null;
  const t = `coach_school:${String(emis).trim()}`;
  return COACH_SCHOOL_TARGET.test(t) ? t : null;
}

module.exports = { COACH_SCHOOL_TARGET, COACH_SCHOOLS, isCoachSchoolTarget, coachSchoolPathFor, coachSchoolTarget };
