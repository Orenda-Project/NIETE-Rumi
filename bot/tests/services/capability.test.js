/**
 * bd-2531 — capability gating (the `permission_classes` layer).
 *
 * WHY: this repo currently has FOUR ways to answer "may this person do X":
 *   1. dashboard/middleware/rbac/rbac.js       requireRole([...])       — dashboard_users
 *   2. dashboard/middleware/rbac/feature-access.js requireFeatureAccess() — dashboard_users
 *   3. dashboard/lib/leader-role.js            makeRequireLeaderRole()  — users, one family
 *   4. dashboard/routes/attendance.routes.js   req.portalUser.role !== 'principal', INLINE ×4
 * …and remark-gate.js was quietly becoming a fifth.
 *
 * #2 is the right shape — permission as DATA in feature_permissions(role,
 * feature_key, can_access), so granting a role is an INSERT, not a deploy. Its
 * only limitation is that it resolves roles from `dashboard_users` (portal
 * staff), while /remark and attendance operate on `users` (teachers,
 * principals). That mismatch is exactly why attendance hand-rolled its own
 * check and then leaked four inline comparisons past it.
 *
 * This module is the `users`-side twin: same table, same semantics, different
 * role source. Default-deny — a missing row is a denial, never an allow.
 */
const {
  CAPABILITIES,
  makeRequireCapability,
  makeHasCapability,
} = require('../../shared/services/authz/capability');

const PRINCIPAL = { id: 'u-p', role: 'principal' };
const TEACHER = { id: 'u-t', role: 'teacher' };

// Stub the permission matrix: a row exists only where explicitly granted.
function makeLookup(matrix) {
  const calls = [];
  return {
    calls,
    lookup: async (role, featureKey) => {
      calls.push([role, featureKey]);
      const row = matrix.find((m) => m.role === role && m.feature_key === featureKey);
      return row ? { can_access: row.can_access } : null;
    },
  };
}

describe('bd-2531 — the capability registry', () => {
  test('remark.author is a declared capability', () => {
    expect(CAPABILITIES.REMARK_AUTHOR).toBe('remark.author');
  });

  test('capability keys are namespaced dotted strings, not bare words', () => {
    // 'remark' would collide with a future 'remark.export' / 'remark.admin'.
    for (const key of Object.values(CAPABILITIES)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });
});

describe('bd-2531 — hasCapability resolves from DATA, not a hardcoded list', () => {
  test('granted role + granted feature → true', async () => {
    const { lookup } = makeLookup([
      { role: 'principal', feature_key: 'remark.author', can_access: true },
    ]);
    const has = makeHasCapability({ lookup });
    await expect(has(PRINCIPAL, 'remark.author')).resolves.toBe(true);
  });

  test('a role with NO row is denied (default-deny)', async () => {
    // The single most important property: adding a capability must not
    // accidentally grant it to every role that lacks a row.
    const { lookup } = makeLookup([
      { role: 'principal', feature_key: 'remark.author', can_access: true },
    ]);
    const has = makeHasCapability({ lookup });
    await expect(has(TEACHER, 'remark.author')).resolves.toBe(false);
  });

  test('an explicit can_access=false row is denied', async () => {
    const { lookup } = makeLookup([
      { role: 'coach', feature_key: 'remark.author', can_access: false },
    ]);
    const has = makeHasCapability({ lookup });
    await expect(has({ id: 'u-c', role: 'coach' }, 'remark.author')).resolves.toBe(false);
  });

  test('a null user or a user with no role is denied without hitting the DB', async () => {
    const { lookup, calls } = makeLookup([]);
    const has = makeHasCapability({ lookup });
    await expect(has(null, 'remark.author')).resolves.toBe(false);
    await expect(has({ id: 'x' }, 'remark.author')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('a lookup failure DENIES rather than throwing open', async () => {
    // Fail-closed: a DB blip must not become a permission grant.
    const has = makeHasCapability({ lookup: async () => { throw new Error('db down'); } });
    await expect(has(PRINCIPAL, 'remark.author')).resolves.toBe(false);
  });

  test('roles are normalised (trim + lowercase) like isLeaderRole does', async () => {
    const { lookup } = makeLookup([
      { role: 'principal', feature_key: 'remark.author', can_access: true },
    ]);
    const has = makeHasCapability({ lookup });
    await expect(has({ id: 'u', role: '  Principal ' }, 'remark.author')).resolves.toBe(true);
  });

  test('GRANTING A NEW ROLE IS DATA, NOT A DEPLOY', async () => {
    // The whole point. An AEO gains /remark by one row appearing — no code
    // change, no new branch in a conditional.
    const matrix = [{ role: 'principal', feature_key: 'remark.author', can_access: true }];
    const { lookup } = makeLookup(matrix);
    const has = makeHasCapability({ lookup });
    const aeo = { id: 'u-a', role: 'aeo' };

    await expect(has(aeo, 'remark.author')).resolves.toBe(false);
    matrix.push({ role: 'aeo', feature_key: 'remark.author', can_access: true });
    await expect(has(aeo, 'remark.author')).resolves.toBe(true);
  });
});

describe('bd-2531 — requireCapability express middleware', () => {
  function runMw(mw, req) {
    return new Promise((resolve) => {
      const res = {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; resolve({ res: this, nextCalled: false }); return this; },
      };
      mw(req, res, () => resolve({ res, nextCalled: true }));
    });
  }

  const granted = () => makeLookup([
    { role: 'principal', feature_key: 'remark.author', can_access: true },
  ]).lookup;

  test('a permitted user passes through to next()', async () => {
    const mw = makeRequireCapability('remark.author', { lookup: granted(), getUser: async () => PRINCIPAL });
    const { nextCalled } = await runMw(mw, { session: { portalUserId: 'u-p' } });
    expect(nextCalled).toBe(true);
  });

  test('the loaded user is attached so downstream saves a round-trip', async () => {
    const mw = makeRequireCapability('remark.author', { lookup: granted(), getUser: async () => PRINCIPAL });
    const req = { session: { portalUserId: 'u-p' } };
    await runMw(mw, req);
    expect(req.portalUser).toEqual(PRINCIPAL);
  });

  test('a user lacking the capability gets 403, not 500', async () => {
    const mw = makeRequireCapability('remark.author', { lookup: granted(), getUser: async () => TEACHER });
    const { res, nextCalled } = await runMw(mw, { session: { portalUserId: 'u-t' } });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('an unauthenticated request gets 401, distinct from 403', async () => {
    const mw = makeRequireCapability('remark.author', { lookup: granted(), getUser: async () => null });
    const { res } = await runMw(mw, { session: {} });
    expect(res.statusCode).toBe(401);
  });

  test('the 403 body never leaks the role or the matrix', async () => {
    // rbac.js echoes `userRole` back to the caller; that tells an attacker
    // which role they'd need. Say no without saying why.
    const mw = makeRequireCapability('remark.author', { lookup: granted(), getUser: async () => TEACHER });
    const { res } = await runMw(mw, { session: { portalUserId: 'u-t' } });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/teacher/i);
    expect(body).not.toMatch(/principal/i);
  });

  test('a getUser failure denies with 500 and does NOT call next()', async () => {
    const mw = makeRequireCapability('remark.author', {
      lookup: granted(),
      getUser: async () => { throw new Error('lookup exploded'); },
    });
    const { res, nextCalled } = await runMw(mw, { session: { portalUserId: 'u-p' } });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(500);
  });
});
