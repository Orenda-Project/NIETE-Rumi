'use strict';
/**
 * The principal app's switch, read on the bot: app_settings portal_principal_app (dashboard/lib/feature-flags.js
 * PORTAL_PRINCIPAL_APP_KEY; the portal's own reader is dashboard/lib/teacher-app.js isPrincipalObserveUser).
 *
 * The portal's rule: true, "true", or a list of users.id naming her. Anything else ("teachers", an object, a malformed
 * value), no row, no user or a failed read is OFF. Fail-closed, never throws. Whether she is a principal is the
 * caller's question (her users.role): this answers only "does the switch name her".
 *
 * Readers: patch-resolver (her own school's roster on the app) and portal-observe (a principal on the app gets the
 * coach HITL rubric on the portal, as on WhatsApp).
 */

const PRINCIPAL_APP_KEY = 'portal_principal_app';

/** Does this stored value turn the switch on for userId? Pure. */
function namesUser(value, userId) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* the raw string */ } }
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  if (Array.isArray(v)) return v.some((id) => typeof id === 'string' && id === userId);
  return false;
}

/**
 * @param {object} supabase
 * @param {string|null} userId
 * @returns {Promise<boolean>}
 */
async function isOnPrincipalApp(supabase, userId) {
  if (!userId) return false;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', PRINCIPAL_APP_KEY).maybeSingle();
    if (error || !data) return false;
    return namesUser(data.value, userId);
  } catch (_) {
    return false;
  }
}

module.exports = { PRINCIPAL_APP_KEY, isOnPrincipalApp, namesUser };
