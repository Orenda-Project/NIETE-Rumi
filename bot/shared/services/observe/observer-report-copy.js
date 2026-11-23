'use strict';
/**
 * bd-o15qnr.39.2 (queue #204) — the observer's own copy of the report she sent to the teacher.
 *
 * The operator, 22 Nov: "when sending to the teacher it should also be sent to me as well." When a coach (or a
 * principal) taps Send in the app and the report REACHES the teacher on WhatsApp, the observer gets the same report
 * image on WhatsApp, captioned with the catalog's `report_copy_observer` ("Copy of the report sent to {name}") in HER
 * OWN language (the caller passes her observe strings: observe-language's 'coach' audience).
 *
 * THE SWITCH is the portal's v6/v7 switch, read with the portal's own rule (dashboard/routes/portal.routes.js /config):
 *   coachFlowV2      portal_coach_v2 AND portal_coach_full_app AND portal_coach_flow_v2 name her
 *   principalFlowV2  she is a principal (users.role) AND portal_principal_app AND portal_coach_flow_v2 name her
 * "Name her" is isFlagEnabledForUser's rule: true, "true", or a JSON list of users.id holding hers ("teachers" covers
 * only a users.role teacher, never an observer). No row, a malformed value or a failed read is OFF (fail-closed).
 * Not re-checked here: the principal app's "she has a school" (isPrincipalObserveUser) — a principal reaches Send only
 * through the portal's observe gate, which already asked it.
 *
 * WHEN: the caller (observe-send processTeacherReport) calls this only after the report itself went to the teacher on
 * a send started in the app (the direct send, or her tap on the invite). The invite alone, operator review, a failed
 * send and a WhatsApp-run send (the coach already had the preview in that chat) send no copy.
 *
 * BEST EFFORT: never throws, never retries, and is called after the teacher's delivery is filed as sent. Outside the
 * observer's own 24-hour window WhatsApp refuses a free-form message (131047): the copy is logged as failed
 * (reason window_closed) and dropped. Getting it to her there would need an approved template that carries an image
 * header, which this does not invent.
 *
 * TELEMETRY: observe_report.observer_copy.sent | .failed | .skipped (structured-logger logEvent, which adds the
 * job's correlation id — the worker runs every job inside runWithCorrelation).
 */

const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const StructuredLogger = require('../../utils/structured-logger');
const { metaErrorCodeOf, RE_ENGAGEMENT_ERROR_CODE } = require('../../config/meta-messaging-window');
const { isPrincipalRole } = require('../../config/role-features');
const { namesUser, PRINCIPAL_APP_KEY } = require('./principal-app-switch');

/** dashboard/lib/feature-flags.js keys, by the same names. */
const FLOW_V2_KEY = 'portal_coach_flow_v2';
const COACH_APP_KEY = 'portal_coach_v2';
const COACH_FULL_APP_KEY = 'portal_coach_full_app';
const SWITCH_KEYS = [FLOW_V2_KEY, COACH_APP_KEY, COACH_FULL_APP_KEY, PRINCIPAL_APP_KEY];

const EVENT = 'observe_report.observer_copy';

function event(result, data) {
  try { StructuredLogger.logEvent(`${EVENT}.${result}`, data); } catch (_) { /* logging never decides */ }
}

/** key → stored value for the four switches. Throws on a failed read (the caller treats that as off). */
async function switchValues(db) {
  const { data, error } = await db.from('app_settings').select('key,value').in('key', SWITCH_KEYS);
  if (error) throw new Error(error.message || 'app_settings read failed');
  const values = new Map();
  for (const row of data || []) values.set(row.key, row.value);
  return values;
}

/**
 * Is the v6/v7 switch on for this observer, as the portal's /config answers it? `observer` is her users row (role).
 * Pure over the stored values.
 */
function flowV6OnFor(values, observer) {
  const userId = observer && observer.id;
  if (!userId || !namesUser(values.get(FLOW_V2_KEY), userId)) return false;
  const coachFlow = namesUser(values.get(COACH_APP_KEY), userId) && namesUser(values.get(COACH_FULL_APP_KEY), userId);
  const principalFlow = isPrincipalRole(observer.role) && namesUser(values.get(PRINCIPAL_APP_KEY), userId);
  return coachFlow || principalFlow;
}

/**
 * Send the observer her copy of the report. Never throws.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string|null} args.observerUserId  coaching_sessions.observer_user_id (users.id)
 * @param {Buffer} args.png                  the report image exactly as the teacher got it
 * @param {string} args.teacherName
 * @param {object} args.strings              the OBSERVER's observe strings (observeStrings(languageFor('coach', …)))
 * @param {string|null} [args.teacherPhone]  the number the report went to (a copy to the same number is skipped)
 * @param {object} [args.db]                 Supabase client (tests)
 * @returns {Promise<'sent'|'failed'|'skipped'>}
 */
async function sendObserverCopy({ sessionId, observerUserId, png, teacherName, strings, teacherPhone = null, db = supabase } = {}) {
  const base = { sessionId, observerUserId: observerUserId || null };
  const skip = (reason) => { event('skipped', { ...base, reason }); return 'skipped'; };
  try {
    if (!observerUserId || !png) return skip('nothing_to_send');

    let values;
    try {
      values = await switchValues(db);
    } catch (_) {
      return skip('switch_unreadable'); // fail-closed: an unreadable switch is off
    }
    // Nobody pays a users read unless the flow switch could name her.
    if (!namesUser(values.get(FLOW_V2_KEY), observerUserId)) return skip('switch_off');

    const { data: observer, error } = await db
      .from('users')
      .select('id, role, phone_number')
      .eq('id', observerUserId)
      .maybeSingle();
    if (error || !observer) return skip('observer_unresolved');
    if (!flowV6OnFor(values, observer)) return skip('switch_off');
    const phone = String(observer.phone_number || '').trim();
    if (!phone) return skip('no_phone');
    if (teacherPhone && phone === String(teacherPhone).trim()) return skip('same_number');

    const template = strings && strings.report_copy_observer;
    if (!template) return skip('no_caption');
    const caption = String(template).replace('{name}', String(teacherName || '').trim()).replace(/[ \t]{2,}/g, ' ').trim();

    let refusal = null;
    const sent = await WhatsAppService.sendImageFromBuffer(phone, png, caption, 'image/png', { onError: (err) => { refusal = err; } });
    if (sent === false) {
      const metaErrorCode = metaErrorCodeOf(refusal);
      event('failed', {
        ...base,
        reason: metaErrorCode === RE_ENGAGEMENT_ERROR_CODE ? 'window_closed' : 'refused',
        metaErrorCode,
      });
      return 'failed';
    }
    event('sent', base);
    return 'sent';
  } catch (err) {
    event('failed', { ...base, reason: 'error', error: err && err.message });
    return 'failed';
  }
}

module.exports = { sendObserverCopy, flowV6OnFor, SWITCH_KEYS, FLOW_V2_KEY, COACH_APP_KEY, COACH_FULL_APP_KEY };
