/**
 * FEAT-053 bd-12 — /observe trigger gate.
 *
 * Pure, side-effect-free decision helper (mirrors evaluateHomeworkTrigger in
 * text-message.handler.js) so the routing logic is unit-testable without the
 * full handler harness.
 *
 * Region rule: /observe exists ONLY on the Tanzania deployment. On any other
 * region the evaluator returns {match:false} so the message falls through to
 * normal processing — PK behaviour provably unchanged.
 */

// Matches "/observe" as a command (leading slash required, word boundary so
// "/observer" does NOT match). Handler passes the trimmed message.
const OBSERVE_TRIGGER_RX = /^\/observe\b/i;

const SCHOOL_LEADER_ROLE = 'school_leader';

// FEAT-093 bd-46 — THE single source of truth for the leader family.
// Registration stores the granular role (analytics + future per-role
// behaviour survive); every capability check goes through this list.
// 'aeo' is included: 17 live production users already carry it.
// NOTHING outside this file may compare role === 'school_leader' — a
// source-level guard test enforces that (observe-role-family.test.js).
const LEADER_ROLES = Object.freeze([
  'school_leader', 'supervisor', 'coach', 'principal', 'aeo',
]);
const ARMS = ['why_coaching', 'functional'];

/**
 * @param {object|null} user users row (carries role + preferences)
 * @returns {boolean}
 */
function isSchoolLeader(user) {
  return !!user && LEADER_ROLES.includes(user.role);
}

/**
 * A/B onboarding arm, seeded into users.preferences.observe_onboarding_arm
 * by scripts/seed-field-officers.js. Unknown/missing → 'functional' (the
 * control arm) so a mis-seeded user never accidentally receives the
 * treatment content.
 * @returns {'why_coaching'|'functional'}
 */
function getObserveArm(user) {
  const arm = user && user.preferences && user.preferences.observe_onboarding_arm;
  return ARMS.includes(arm) && arm === 'why_coaching' ? 'why_coaching' : 'functional';
}

/**
 * @param {{messageBody: string, user: object|null, region: 'PK'|'TZ'}} input
 * @returns {{match:false}
 *   | {match:true, action:'deny_no_user'|'deny_role'|'capture'}
 *   | {match:true, action:'onboard', arm:'why_coaching'|'functional'}}
 */
function evaluateObserveTrigger({ messageBody, user, region }) {
  if (!OBSERVE_TRIGGER_RX.test((messageBody || '').trim())) return { match: false };
  // FEAT-093 bd-48: capability replaces geography. A market is "on" when its
  // service carries the observe Flow config — publish the Flow + set one env
  // var and the market ships, no code change. (Framework: everyone defaults
  // to MEWAKA for now — per-market frameworks arrive with their ports.)
  if (!process.env.OBSERVE_MEWAKA_FLOW_ID) return { match: false };
  if (!user) return { match: true, action: 'deny_no_user' };
  if (!isSchoolLeader(user)) return { match: true, action: 'deny_role' };

  const prefs = user.preferences || {};
  if (!prefs.observe_onboarded) {
    return { match: true, action: 'onboard', arm: getObserveArm(user) };
  }
  return { match: true, action: 'capture' };
}

/**
 * FEAT-053 framework pin: a leader observation's analysis is ALWAYS MEWAKA —
 * the observer's editable form is MEWAKA-shaped, so the framework must never
 * depend on the OBSERVER's phone prefix or stale preferences. (Caught live
 * 2026-07-12: a PK-numbered test observer fell through country derivation to
 * OECD, producing a draft the MEWAKA flow couldn't prefill.)
 *
 * @param {object} session coaching_sessions row
 * @param {{selectFramework: Function, getFramework: Function}} deps
 */
async function pickObservationFramework(session, { selectFramework, getFramework }) {
  if (session && session.observation_type === 'leader_observation') {
    // FEAT-093 bd-52: the market's configured rubric (OBSERVE_FRAMEWORK env;
    // default mewaka). For mewaka this returns the exact module as before —
    // Tanzania byte-identical. For hots it returns the observe wrapper with
    // Urdu prompts producing the same pipeline JSON contract.
    const { getObservePack } = require('./observe-framework');
    const pack = getObservePack();
    return pack.key === 'mewaka' ? getFramework('mewaka') : pack.module;
  }
  return selectFramework(session.user_id);
}

module.exports = {
  OBSERVE_TRIGGER_RX,
  SCHOOL_LEADER_ROLE,
  LEADER_ROLES,
  evaluateObserveTrigger,
  getObserveArm,
  isSchoolLeader,
  pickObservationFramework,
};
