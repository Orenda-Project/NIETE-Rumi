'use strict';

/**
 * Child test (EGRA/EGMA five-minute test) — who may start it, and whether this deployment runs it.
 *
 * Pure, like observe2/gate.js. Three conditions, all required:
 *   1. CHILD_TEST_ENABLED=true in this deployment;
 *   2. the user is a coach / school leader (observe-gate's LEADER_ROLES);
 *   3. the user's region is ICT (users.region, else DEFAULT_REGION). NIETE runs as `niete`,
 *      `niete-sandbox`, … so any region starting with one of CHILD_TEST_REGIONS counts
 *      (default `niete,ict,islamabad,federal`).
 * Flag off or region outside ICT → { match:false }: the message falls through to normal chat
 * exactly as if the command did not exist (the test proves it).
 */

const { isSchoolLeader } = require('../../observe/observe-gate');
const { getUserRegion } = require('../../../utils/region');

// "/egra", "/childtest", or the Urdu label «بچوں کا ٹیسٹ». An optional argument follows
// (/egra <EMIS> picks a school when the coach has more than ten).
const CHILD_TEST_TRIGGER_RX = /^(?:\/egra|\/childtest|\/child-test|بچوں کا ٹیسٹ)(?:\s+(.*))?$/i;

const DEFAULT_REGIONS = 'niete,ict,islamabad,federal';

function isEnabled() {
  return String(process.env.CHILD_TEST_ENABLED || '').trim().toLowerCase() === 'true';
}

function isIctRegion(user) {
  const region = getUserRegion(user);
  const allowed = String(process.env.CHILD_TEST_REGIONS || DEFAULT_REGIONS)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.some((r) => region === r || region.startsWith(`${r}-`) || region.startsWith(`${r}_`));
}

/** Whether this user may see child-test offers and buttons at all (no command text involved). */
function isChildTestAvailable(user) {
  return isEnabled() && !!user && isSchoolLeader(user) && isIctRegion(user);
}

/**
 * @param {{messageBody: string, user: object|null}} input
 * @returns {{match:false} | {match:true, action:'deny_no_user'|'deny_role'|'start', arg: string|null}}
 */
function evaluateChildTestTrigger({ messageBody, user }) {
  const m = CHILD_TEST_TRIGGER_RX.exec((messageBody || '').trim());
  if (!m) return { match: false };
  if (!isEnabled()) return { match: false };
  if (!user) return { match: true, action: 'deny_no_user', arg: null };
  if (!isIctRegion(user)) return { match: false };
  if (!isSchoolLeader(user)) return { match: true, action: 'deny_role', arg: null };
  return { match: true, action: 'start', arg: (m[1] || '').trim() || null };
}

module.exports = { CHILD_TEST_TRIGGER_RX, evaluateChildTestTrigger, isChildTestAvailable, isEnabled, isIctRegion };
