'use strict';
/**
 * bd-33wxxi.1 — "is the teacher app on for this user?", asked in ONE place.
 *
 * The teacher app rides three app_settings switches (lib/feature-flags.js): portal_teacher_v2 (the app),
 * portal_teacher_home_card (its Home card) and portal_teacher_home_look (the Home's look). Each is read per user with
 * isFlagEnabledForUser, and on every tier they hold "teachers": every users.role teacher, never a principal.
 *
 * The principal app (portal_principal_app) puts a principal on that same app. teacherAppOnFor is the switch's own
 * answer OR "she is a principal the principal app is on for", so /config and every route a switch gates give one
 * answer. Order matters for cost: the teacher switch first (a teacher it covers never reads more), then the principal
 * switch (no row = off, no users read), and her users row only when the principal switch names her.
 *
 * Fail-closed, like every flag: no user, no row, a malformed value or a failed read is OFF (`strict`: a failed read
 * throws, for lp-reader's caller, whose safe answer to "unknown" is not "off").
 *
 * Keys are matched by name: the root test pins TEACHER_APP_KEYS to feature-flags' constants. A key that is not one of
 * the three throws, so the principal switch can never open anything else (the Home order, the coach app, …).
 */
const flags = require('./feature-flags');
const { principalSchoolOf } = require('./leader-role');

const TEACHER_APP_KEYS = Object.freeze(['portal_teacher_v2', 'portal_teacher_home_card', 'portal_teacher_home_look']);

/**
 * Is this user a principal the principal app is on for? Its switch on for her (a list naming her, or true) AND
 * users.role principal.
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function isPrincipalAppUser(supabase, userId, { strict = false } = {}) {
  const key = flags.PORTAL_PRINCIPAL_APP_KEY;
  if (!userId || !key) return false;
  if (!(await flags.isFlagEnabledForUser(supabase, key, userId, { strict }))) return false;
  return (await principalSchoolOf(supabase, userId, { strict })) !== null;
}

/**
 * The teacher-app switch `key` for this user: its own answer, or ON for a principal on the principal app.
 *
 * @param {object} supabase
 * @param {'portal_teacher_v2'|'portal_teacher_home_card'|'portal_teacher_home_look'} key
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function teacherAppOnFor(supabase, key, userId, { strict = false } = {}) {
  if (!TEACHER_APP_KEYS.includes(key)) throw new TypeError(`teacher-app: ${key} is not a teacher-app switch`);
  if (await flags.isFlagEnabledForUser(supabase, key, userId, { strict })) return true;
  return isPrincipalAppUser(supabase, userId, { strict });
}

module.exports = { TEACHER_APP_KEYS, isPrincipalAppUser, teacherAppOnFor };
