/**
 * bd-2434 — Leader Portal (school-leader family) role gate for the portal API.
 * NIETE port of the upstream bd-2385 work.
 *
 * The portal reveals a leader-only surface ("My Patch" + the teachers roster)
 * exclusively to the school-leader family. That decision is driven by the
 * user's `role` column. Two responsibilities live here:
 *
 *   1. `publicUserPayload` — the ONE shaper for the user object we hand back to
 *      the frontend on /login and /dashboard. It always includes `role` (so the
 *      client can gate the nav) and never leaks sensitive columns.
 *   2. `makeRequireLeaderRole` — an Express middleware factory that protects the
 *      leader-only endpoints server-side. Client gating is UX; this is the real
 *      access control.
 *
 * CANONICAL SOURCE OF TRUTH: the leader family is defined in this repo's bot
 * code at bot/shared/services/observe/observe-gate.js (LEADER_ROLES). This list
 * MUST stay identical — the drift-guard test (tests/leader-role.middleware.test.js)
 * requires that file directly and fails loudly if they diverge. When
 * registration adds a new leader role, update BOTH.
 */

// Mirror of bot/shared/services/observe/observe-gate.js LEADER_ROLES.
// NIETE's family is FIVE roles — no cluster_coordinator here (that role is
// upstream-only). Keep in lock-step with the bot file.
const LEADER_ROLES = Object.freeze([
  'school_leader', 'supervisor', 'coach', 'principal', 'aeo',
]);

/**
 * Is this role in the leader family? Registration stores the raw string, so
 * trim + lowercase before comparing (mirrors the frontend leaderRole.ts).
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
function isLeaderRole(role) {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return normalized !== '' && LEADER_ROLES.includes(normalized);
}

/**
 * Shape a users row into the safe payload the portal frontend receives.
 * Always carries `role` (defaulting to null) — that is the field the client
 * gates the leader nav on. Contact fields are opt-in (the /dashboard response
 * includes them; /login does not).
 * @param {object} user users row
 * @param {{includeContact?: boolean}} [opts]
 */
function publicUserPayload(user, opts = {}) {
  const payload = {
    firstName: user.name,
    country: user.country || null,
    role: user.role || null,
  };
  if (opts.includeContact) {
    payload.lastName = user.name;
    payload.phoneNumber = user.phone_number;
  }
  return payload;
}

/**
 * Build the leader-only Express gate. Runs AFTER requirePortalAuth (so the
 * session user id is present). Looks up the user, allows the school-leader
 * family through, 403s everyone else, 500s on lookup failure.
 * @param {{getUser: (userId: string) => Promise<object|null>}} deps
 */
function makeRequireLeaderRole({ getUser }) {
  return async function requireLeaderRole(req, res, next) {
    const userId = req.session && req.session.portalUserId;
    try {
      const user = await getUser(userId);
      if (!user || !isLeaderRole(user.role)) {
        return res.status(403).json({
          success: false,
          error: 'This area is for school leaders only.',
        });
      }
      req.portalUser = user;   // hand the loaded row downstream to save a round-trip
      return next();
    } catch (err) {
      console.error('requireLeaderRole lookup failed:', err);
      return res.status(500).json({
        success: false,
        error: 'Could not verify access. Please try again.',
      });
    }
  };
}

module.exports = {
  LEADER_ROLES,
  isLeaderRole,
  publicUserPayload,
  makeRequireLeaderRole,
};
