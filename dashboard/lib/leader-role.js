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
 *
 * `analyticsOnly` is always present as a boolean: true only for an account on the
 * portal_analytics_only list (the caller looks that up — this shaper stays pure), so the
 * client can send that account straight to the schools analytics page without asking
 * again.
 * @param {object} user users row
 * @param {{includeContact?: boolean, analyticsOnly?: boolean}} [opts]
 */
function publicUserPayload(user, opts = {}) {
  const payload = {
    firstName: user.name,
    country: user.country || null,
    role: user.role || null,
    analyticsOnly: opts.analyticsOnly === true,
  };
  if (opts.includeContact) {
    // No surname column since V1.4.4 dropped it: `firstName` already carries
    // the whole of `users.name`, and the portal joins first + last — echoing
    // `name` here rendered "Welcome back, Hataf Atif Hataf Atif!".
    payload.lastName = null;
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

/**
 * bd-33wxxi.1 — is this role a PRINCIPAL? The one place a "principal" decision reads the role (trim + lowercase, as
 * isLeaderRole). "Principal" is something a person is at a school, so every principal check goes through here (and
 * the portal's principalOf, lib/leaderRole.ts): when roles move to their own table, only these change.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
function isPrincipalRole(role) {
  return typeof role === 'string' && role.trim().toLowerCase() === 'principal';
}

/**
 * bd-33wxxi.1 — the principal's school: `{ schoolId }` for a users.role principal (schoolId null when her row names no
 * school: 192 principals on prod), or null for anyone else, no row, or no user. The school is ALWAYS read from her
 * own users row (the dashboard's rule for a principal, services/leader-patch.service.js entry point 2), never taken
 * from a request. A failed read is null (not a principal); with `strict` it throws.
 *
 * @param {object} supabase
 * @param {string|null} userId the SESSION user
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<{ schoolId: string|null }|null>}
 */
async function principalSchoolOf(supabase, userId, { strict = false } = {}) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.from('users').select('role, school_id').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message || 'users read failed');
    if (!data || !isPrincipalRole(data.role)) return null;
    return { schoolId: data.school_id || null };
  } catch (err) {
    if (strict) throw err;
    return null;
  }
}

module.exports = {
  LEADER_ROLES,
  isLeaderRole,
  isPrincipalRole,
  principalSchoolOf,
  publicUserPayload,
  makeRequireLeaderRole,
};
