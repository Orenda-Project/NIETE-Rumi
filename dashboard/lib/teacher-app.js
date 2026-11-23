'use strict';
/**
 * bd-33wxxi.1 — "is the teacher app on for this user?", asked in ONE place.
 *
 * The teacher app rides three app_settings switches (lib/feature-flags.js): portal_teacher_v2 (the app),
 * portal_teacher_home_card (its Home card) and portal_teacher_home_look (the Home's look). Each is read per user with
 * isFlagEnabledForUser, and on every tier they hold "teachers": every users.role teacher, never a principal.
 *
 * bd-33wxxi.11 (queue #236, option B; the operator, 23 Nov: "principals should get the new portal without the HITL
 * because that is not ready yet") — a principal has two answers, asked here and nowhere else:
 *
 *   isPrincipalHomeUser     users.role principal, no switch: the principal Home. teacherAppOnFor is the teacher switch's
 *                           own answer OR this, so /config and every route a teacher-app switch gates give one answer.
 *   isPrincipalObserveUser  portal_principal_app names her AND users.role principal: observing in the app (the observe
 *                           API, the coach observation reads, /config principalObserve, observeOnPortal,
 *                           principalFlowV2). The bot reads the same switch for WhatsApp "observe" and the rubric
 *                           (bot/shared/services/observe/principal-app-switch.js), so those are unchanged.
 *
 * Order matters for cost: the teacher switch first (a teacher it covers never reads more), then her users row.
 *
 * Fail-closed, like every flag: no user, no row, a malformed value or a failed read is OFF (`strict`: a failed read
 * throws, for lp-reader's caller, whose safe answer to "unknown" is not "off").
 *
 * Keys are matched by name: the root test pins TEACHER_APP_KEYS to feature-flags' constants. A key that is not one of
 * the three throws, so the principal Home can never open anything else (the Home order, the coach app, …).
 */
const flags = require('./feature-flags');
const { principalSchoolOf } = require('./leader-role');

const TEACHER_APP_KEYS = Object.freeze(['portal_teacher_v2', 'portal_teacher_home_card', 'portal_teacher_home_look']);

/**
 * bd-33wxxi.11 — the principal Home: is this user a principal (users.role principal)? Every principal, no switch.
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function isPrincipalHomeUser(supabase, userId, { strict = false } = {}) {
  if (!userId) return false;
  return (await principalSchoolOf(supabase, userId, { strict })) !== null;
}

/**
 * Observing in the app, for a principal: the principal app's switch on for her (a list naming her, or true) AND
 * users.role principal. (Until bd-33wxxi.11 this one answer also opened her Home, as isPrincipalAppUser.)
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function isPrincipalObserveUser(supabase, userId, { strict = false } = {}) {
  const key = flags.PORTAL_PRINCIPAL_APP_KEY;
  if (!userId || !key) return false;
  if (!(await flags.isFlagEnabledForUser(supabase, key, userId, { strict }))) return false;
  return isPrincipalHomeUser(supabase, userId, { strict });
}

/**
 * The teacher-app switch `key` for this user: its own answer, or ON for a principal (bd-33wxxi.11: every principal).
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
  return isPrincipalHomeUser(supabase, userId, { strict });
}

module.exports = { TEACHER_APP_KEYS, isPrincipalHomeUser, isPrincipalObserveUser, teacherAppOnFor };
