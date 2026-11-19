'use strict';
/**
 * Switches for the lesson plan in the teacher app and the activity Home. Each is a row in app_settings, read through
 * lib/feature-flags.js (same 30 s cache, same fail-closed rules). Every one starts OFF: no row, a malformed value, a
 * failed read or no signed-in user is off, and off is exactly today's app.
 *
 * Per user (isFlagEnabledForUser): true / "true" = everyone; a JSON list of users.id = those users; "teachers" = every
 * users.role teacher; anything else = off.
 *   portal_lp_feedback_bar        on: the "Was this useful?" bar at the end of her own grades 1-5 plan, and
 *                                 POST /api/portal/lp/feedback answers. Off: no bar, the route is 404.
 *   portal_teacher_home_activity  on: the "Last 30 days" block on Home (GET /me/home `activity`, read from Redis only).
 *                                 Off: Home as today, no `activity` key.
 *   portal_teacher_journey        on: the My journey row and page (GET /me/journey), and the team view in Analytics
 *                                 for an analytics account the value names. Off: no row, no page, both routes 404.
 *
 * Per programme (a JSON list from {"ict","gb"}; rules and parser shared with the bot in
 * bot/shared/config/lp-whatsapp-programmes.js; no row or anything else = today):
 *   lp_whatsapp_pdf_off           a listed programme's teachers get no lesson-plan PDF on WhatsApp.
 *   lp_whatsapp_survey_off        a listed programme's teachers get no "Was this useful?" survey on WhatsApp.
 */
const { readFlagRow, isFlagEnabledForUser } = require('./feature-flags');
const { isGbTeacher } = require('../../bot/shared/services/lp-own-gb');
const {
  LP_WHATSAPP_PDF_OFF_KEY, LP_WHATSAPP_SURVEY_OFF_KEY, parseProgrammeList,
} = require('../../bot/shared/config/lp-whatsapp-programmes');

const PORTAL_LP_FEEDBACK_BAR_KEY = 'portal_lp_feedback_bar';
const PORTAL_TEACHER_HOME_ACTIVITY_KEY = 'portal_teacher_home_activity';
const PORTAL_TEACHER_JOURNEY_KEY = 'portal_teacher_journey';

const isLpFeedbackBarOn = (supabase, userId) => isFlagEnabledForUser(supabase, PORTAL_LP_FEEDBACK_BAR_KEY, userId);
const isTeacherHomeActivityOn = (supabase, userId) => isFlagEnabledForUser(supabase, PORTAL_TEACHER_HOME_ACTIVITY_KEY, userId);
const isTeacherJourneyOn = (supabase, userId) => isFlagEnabledForUser(supabase, PORTAL_TEACHER_JOURNEY_KEY, userId);

/** The programmes a programme switch lists; [] (today) for no row, a malformed value or a failed read. */
async function lpWhatsappOffProgrammes(supabase, key) {
  try {
    const { data, error } = await readFlagRow(supabase, key);
    if (error || !data) return [];
    return parseProgrammeList(data.value);
  } catch (_) {
    return [];
  }
}

/** Is her programme on this switch's list? false (today) for no user, an empty list or a failed programme read. */
async function isOffFor(supabase, key, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  const list = await lpWhatsappOffProgrammes(supabase, key);
  if (!list.length) return false;
  try {
    return list.includes((await isGbTeacher(supabase, userId)) ? 'gb' : 'ict');
  } catch (_) {
    return false;
  }
}

const isLpWhatsappPdfOffFor = (supabase, userId) => isOffFor(supabase, LP_WHATSAPP_PDF_OFF_KEY, userId);
const isLpWhatsappSurveyOffFor = (supabase, userId) => isOffFor(supabase, LP_WHATSAPP_SURVEY_OFF_KEY, userId);

module.exports = {
  PORTAL_LP_FEEDBACK_BAR_KEY,
  PORTAL_TEACHER_HOME_ACTIVITY_KEY,
  PORTAL_TEACHER_JOURNEY_KEY,
  LP_WHATSAPP_PDF_OFF_KEY,
  LP_WHATSAPP_SURVEY_OFF_KEY,
  isLpFeedbackBarOn,
  isTeacherHomeActivityOn,
  isTeacherJourneyOn,
  lpWhatsappOffProgrammes,
  isLpWhatsappPdfOffFor,
  isLpWhatsappSurveyOffFor,
};
