'use strict';
/**
 * Coach reports in the app: landing targets for a /go token (the ONE WhatsApp message about a report she did not open).
 *
 *   coach_report:<coaching session uuid>  her debrief report → /portal/coach/report/<uuid>
 *   coach_week:<YYYY-MM-DD>               her weekly report  → /portal/coach/week/<the week's Monday>
 *
 * Modelled on coach-school-target.js. Pure: no env, no I/O. Three readers: `linkable` in app-login-link.js (so the token
 * can be signed and verified), the landing line in dashboard/routes/app-login.routes.js (it asks the coach-app question
 * first, as for any coach page), and observe/coach-report-whatsapp.service.js (which mints them).
 *
 * Staging (bd-enec2e.6): sandbox opens these reports through its /t/ door (portal-link-token.js, area 'coachreport'),
 * which staging and production do not have; there the coach links (/menu, /observe, /training, the School card) all go
 * through /go, so the report link does too. Both are anchored, lowercase uuid and ISO date only, so no path, query or
 * fragment can ride along. Nothing here checks that the report is hers: the page's own read does (GET /coach/report/:id
 * answers 403 to any other coach; a week is always the signed-in coach's own).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const COACH_REPORT_TARGET = new RegExp(`^coach_report:(${UUID})$`);
const COACH_WEEK_TARGET = /^coach_week:(\d{4}-\d{2}-\d{2})$/;

/** True when `f` is a coach report landing target. */
function isCoachReportTarget(f) {
  return typeof f === 'string' && (COACH_REPORT_TARGET.test(f) || COACH_WEEK_TARGET.test(f));
}

/** The page for a coach report target, or null for anything else. */
function coachReportPathFor(f) {
  if (typeof f !== 'string') return null;
  const r = COACH_REPORT_TARGET.exec(f);
  if (r) return `/portal/coach/report/${r[1]}`;
  const w = COACH_WEEK_TARGET.exec(f);
  return w ? `/portal/coach/week/${w[1]}` : null;
}

/** The target for one debrief report, or null when the id is not a lowercase uuid. */
function coachReportTarget(sessionId) {
  if (typeof sessionId !== 'string') return null;
  const t = `coach_report:${sessionId}`;
  return COACH_REPORT_TARGET.test(t) ? t : null;
}

/** The target for one weekly report (its Monday, YYYY-MM-DD), or null for anything else. */
function coachWeekTarget(monday) {
  if (typeof monday !== 'string') return null;
  const t = `coach_week:${monday}`;
  return COACH_WEEK_TARGET.test(t) ? t : null;
}

module.exports = { COACH_REPORT_TARGET, COACH_WEEK_TARGET, isCoachReportTarget, coachReportPathFor, coachReportTarget, coachWeekTarget };
