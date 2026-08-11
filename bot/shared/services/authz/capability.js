/**
 * bd-2531 — capability gating for `users`-table roles (teachers, principals).
 *
 * The ONE question this module answers: "may this user do X?" — where X is a
 * named capability, and the answer comes from DATA (feature_permissions), not
 * from a conditional in whichever route happens to be asking.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Four gating patterns already live in this repo:
 *   1. rbac.js         requireRole([...])        → dashboard_users
 *   2. feature-access.js requireFeatureAccess()  → dashboard_users, TABLE-DRIVEN
 *   3. leader-role.js  makeRequireLeaderRole()   → users, ONE hardcoded family
 *   4. attendance.routes.js  `role !== 'principal'` INLINE, four times
 *
 * (2) is the right shape and already reads feature_permissions(role,
 * feature_key, can_access) — real permission_classes. Its only limit is that it
 * resolves the role from `dashboard_users`, so anything operating on `users`
 * (attendance, /remark) could not use it and hand-rolled a check instead. That
 * is how (4) happened: a bespoke `requirePrincipal`, then four more inline
 * comparisons that bypassed even that.
 *
 * This module is the `users`-side twin of (2): SAME table, SAME semantics,
 * different role source. New surfaces should use this rather than minting a
 * fifth pattern.
 *
 * ── Design rules ───────────────────────────────────────────────────────────
 * DEFAULT-DENY. A missing row is a denial. A `can_access = false` row is a
 * denial. A DB error is a denial. There is no path where an unknown state
 * becomes an allow — a lookup blip must never silently open /remark.
 *
 * FAIL-CLOSED, NOT FAIL-LOUD, on read. `hasCapability` returns false rather
 * than throwing, so a caller that forgets a try/catch denies instead of 500ing
 * mid-conversation. The express middleware DOES distinguish: 401 unauthenticated,
 * 403 not permitted, 500 user-lookup failure.
 *
 * SAY NO WITHOUT SAYING WHY. The 403 body names neither the user's role nor the
 * required one. (rbac.js echoes `userRole` back, which tells a prober exactly
 * which role to acquire.)
 */

// NOT required at module load: config/supabase calls process.exit(78) when
// SUPABASE_URL/KEY are absent, which would kill any test process that merely
// imports this file for its pure helpers. Resolved lazily, so only a caller
// that actually hits the live matrix needs the env.
function getClient() {
  return require('../../config/supabase');
}

const TABLE = 'feature_permissions';

/**
 * Declared capabilities. A capability is a VERB the product supports, not a
 * screen and not a role — so `remark.author` rather than `principal` or
 * `remark_screen`. Namespaced so `remark.export` / `remark.admin` can arrive
 * later without colliding.
 *
 * Adding a key here does NOT grant it to anyone: the grant is a
 * feature_permissions row. This object exists so capability names are typo-proof
 * and greppable, not as an access list.
 */
const CAPABILITIES = Object.freeze({
  // Author a Supervisor Remark: run /remark, score a teacher, submit.
  REMARK_AUTHOR: 'remark.author',
});

/**
 * Default lookup — one row from the permission matrix.
 * Returns `{ can_access }` or null when no row exists (i.e. not granted).
 * @param {string} role normalised role string
 * @param {string} featureKey capability key
 */
async function defaultLookup(role, featureKey) {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('can_access')
    .eq('role', role)
    .eq('feature_key', featureKey)
    .maybeSingle();
  if (error) throw new Error(`capability: lookup failed — ${error.message}`);
  return data || null;
}

/**
 * Registration stores the raw role string, so normalise before comparing —
 * mirrors dashboard/lib/leader-role.js :: isLeaderRole.
 */
function normaliseRole(user) {
  const role = user && user.role;
  if (typeof role !== 'string') return null;
  const n = role.trim().toLowerCase();
  return n === '' ? null : n;
}

/**
 * Build the capability checker.
 * @param {{lookup?: Function}} [deps] inject a lookup in tests
 * @returns {(user: object|null, featureKey: string) => Promise<boolean>}
 */
function makeHasCapability({ lookup = defaultLookup } = {}) {
  return async function hasCapability(user, featureKey) {
    const role = normaliseRole(user);
    if (!role) return false;          // no user / no role → denied, no DB hit
    try {
      const row = await lookup(role, featureKey);
      return !!(row && row.can_access === true);
    } catch (_err) {
      // Fail CLOSED. A DB blip denies; it never grants.
      return false;
    }
  };
}

/** Ready-to-use checker against the live matrix. */
const hasCapability = makeHasCapability();

/**
 * Express middleware factory — the `permission_classes` equivalent.
 *
 *   router.post('/api/portal/remarks/:id/submit',
 *     requirePortalAuth,
 *     requireCapability(CAPABILITIES.REMARK_AUTHOR),
 *     submitRemark);
 *
 * Runs AFTER auth (needs `req.session.portalUserId`). Attaches the loaded row
 * as `req.portalUser` so the handler does not re-fetch.
 *
 * @param {string} featureKey capability key
 * @param {{lookup?: Function, getUser: (id: string) => Promise<object|null>}} deps
 */
function makeRequireCapability(featureKey, { lookup = defaultLookup, getUser } = {}) {
  if (typeof getUser !== 'function') {
    throw new Error('capability: makeRequireCapability requires a getUser dependency');
  }
  const has = makeHasCapability({ lookup });

  return async function requireCapability(req, res, next) {
    const userId = req && req.session && req.session.portalUserId;
    let user;
    try {
      user = userId ? await getUser(userId) : null;
    } catch (err) {
      // Distinct from a denial: we could not establish WHO is asking.
      console.error(`[capability] getUser failed for ${featureKey}:`, err.message);
      return res.status(500).json({ success: false, error: 'Could not verify access.' });
    }
    if (!user) {
      return res.status(401).json({ success: false, error: 'Sign in to continue.' });
    }
    if (!(await has(user, featureKey))) {
      // Deliberately generic: naming the required role tells a prober what to
      // acquire, and naming theirs confirms the account exists.
      return res.status(403).json({ success: false, error: 'You do not have access to this.' });
    }
    req.portalUser = user;
    return next();
  };
}

module.exports = {
  TABLE,
  CAPABILITIES,
  defaultLookup,
  makeHasCapability,
  hasCapability,
  makeRequireCapability,
};
