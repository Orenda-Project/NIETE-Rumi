/**
 * bd-2529 — STEPS "S" Supervisor Remark: the /remark trigger gate.
 *
 * Pure, side-effect-free decision helper (mirrors evaluateObserveTrigger in
 * observe/observe-gate.js) so the routing logic is unit-testable without the
 * full handler harness.
 *
 * TWO gates, both mandatory:
 *   1. role === 'principal'
 *   2. an evaluation cycle is currently open
 *
 * The principal is NEVER asked which cycle she is filling. It is resolved from
 * the clock — the cycle whose [starts_at, ends_at) contains now. That is only
 * unambiguous because overlapping cycles are impossible at the storage layer
 * (see the EXCLUDE constraint in V1.1.0__supervisor_remarks.sql). "No open
 * cycle" and "no permission" are therefore the same condition.
 */

const { CAPABILITIES } = require('../authz/capability');

// Matches "/remark" as a command (leading slash, word boundary so "/remarks"
// does NOT match). Handler passes the trimmed message.
const REMARK_TRIGGER_RX = /^\/remark\b/i;

// Deliberately NOT the observe LEADER_ROLES family. A coach or AEO may run an
// observation; only the PRINCIPAL of a school authors the Supervisor Remark
// that feeds a teacher's ACR. Widening this list is a policy change, not a
// refactor — it changes who can score a colleague's annual report.
const REMARK_ROLES = Object.freeze(['principal']);

/**
 * @param {object|null} user users row (carries role)
 * @returns {boolean}
 */
function isPrincipal(user) {
  return !!user && REMARK_ROLES.includes(user.role);
}

/**
 * The clock resolves the cycle — half-open [starts_at, ends_at).
 *
 * Start inclusive / end exclusive is what makes back-to-back cycles legal:
 * Q2 ending 2026-07-01T00:00Z and Q3 starting at the same instant do not
 * overlap, and the instant itself belongs to exactly one of them (Q3).
 * This matches the Postgres tstzrange '[)' bound used by the DB constraint,
 * so the JS resolver and the storage guarantee agree by construction.
 *
 * @param {Array<{starts_at:string,ends_at:string}>} cycles
 * @param {Date} [now]
 * @returns {object|null} the active cycle, or null when none is open
 */
function resolveActiveCycle(cycles, now = new Date()) {
  if (!Array.isArray(cycles) || cycles.length === 0) return null;
  const t = now.getTime();
  return cycles.find((c) => {
    const start = new Date(c.starts_at).getTime();
    const end = new Date(c.ends_at).getTime();
    return t >= start && t < end;
  }) || null;
}

/**
 * @param {{messageBody: string, user: object|null, activeCycle: object|null}} input
 * @returns {{match:false}
 *   | {match:true, action:'deny_no_user'|'deny_role'|'deny_no_cycle'}
 *   | {match:true, action:'proceed', cycle:object}}
 */
function evaluateRemarkTrigger({ messageBody, user, activeCycle }) {
  if (!REMARK_TRIGGER_RX.test((messageBody || '').trim())) return { match: false };
  if (!user) return { match: true, action: 'deny_no_user' };
  // Role is checked BEFORE the cycle on purpose: a teacher who types /remark
  // learns only that it isn't for them, never whether an evaluation window is
  // currently open on their school.
  if (!isPrincipal(user)) return { match: true, action: 'deny_role' };
  if (!activeCycle) return { match: true, action: 'deny_no_cycle' };
  return { match: true, action: 'proceed', cycle: activeCycle };
}

/**
 * The CAPABILITY-driven evaluator — prefer this one.
 *
 * Identical decision sequence to evaluateRemarkTrigger, except "may this user
 * author a remark?" is answered by the permission matrix
 * (feature_permissions → remark.author) instead of the REMARK_ROLES array.
 * Granting a new role becomes an INSERT rather than a deploy, and /remark stops
 * being a fifth bespoke gating pattern in this repo (see services/authz/capability.js).
 *
 * REMARK_ROLES survives only as the DEFAULT SEED for that matrix and as the
 * sync gate's pure fallback — it is no longer the authority. A principal whose
 * grant row is pulled IS denied; an AEO who is granted one IS allowed.
 *
 * @param {{messageBody: string, user: object|null, activeCycle: object|null}} input
 * @param {{hasCapability: (user: object, cap: string) => Promise<boolean>}} deps
 */
async function evaluateRemarkTriggerAsync({ messageBody, user, activeCycle }, { hasCapability }) {
  if (!REMARK_TRIGGER_RX.test((messageBody || '').trim())) return { match: false };
  if (!user) return { match: true, action: 'deny_no_user' };
  // Capability BEFORE cycle: someone who may not author a remark must not learn
  // whether an evaluation window is currently open on their school.
  if (!(await hasCapability(user, CAPABILITIES.REMARK_AUTHOR))) {
    return { match: true, action: 'deny_role' };
  }
  if (!activeCycle) return { match: true, action: 'deny_no_cycle' };
  return { match: true, action: 'proceed', cycle: activeCycle };
}

module.exports = {
  REMARK_TRIGGER_RX,
  REMARK_ROLES,
  isPrincipal,
  resolveActiveCycle,
  evaluateRemarkTrigger,
  evaluateRemarkTriggerAsync,
};
