/**
 * bd-2434 — Leader Portal backend role gate (TDD, red-first). NIETE port of the
 * upstream bd-2385 work.
 *
 * The portal must (a) tell the frontend WHICH role the logged-in user has, so
 * the leader nav + "My Patch" only render for the school-leader family, and
 * (b) protect the leader-only read endpoints server-side with a gate.
 *
 * The canonical leader family is defined ONCE in this repo's bot code
 * (bot/shared/services/observe/observe-gate.js LEADER_ROLES — five roles on
 * NIETE, no cluster_coordinator). The drift guard below reads that file
 * directly and fails loudly if the two lists ever diverge.
 */

const {
  LEADER_ROLES,
  isLeaderRole,
  publicUserPayload,
  makeRequireLeaderRole,
} = require('../lib/leader-role');

describe('LEADER_ROLES (canonical leader family)', () => {
  it('matches the bot observe-gate.js list exactly (drift guard, NIETE source of truth)', () => {
    // Same repo → require the canonical list straight from the bot code.
    // If this fails, the two lists have drifted — reconcile before shipping.
    const botGate = require('../../bot/shared/services/observe/observe-gate');
    expect([...LEADER_ROLES].sort()).toEqual([...botGate.LEADER_ROLES].sort());
  });

  it('is the NIETE five-role family (no cluster_coordinator here)', () => {
    expect([...LEADER_ROLES].sort()).toEqual(
      ['aeo', 'coach', 'principal', 'school_leader', 'supervisor'].sort(),
    );
    expect(LEADER_ROLES).not.toContain('cluster_coordinator');
  });
});

describe('isLeaderRole', () => {
  it('is true for every leader-family role', () => {
    for (const role of LEADER_ROLES) {
      expect(isLeaderRole(role)).toBe(true);
    }
  });

  it('is false for a teacher / parent / unknown / missing role', () => {
    expect(isLeaderRole('teacher')).toBe(false);
    expect(isLeaderRole('parent')).toBe(false);
    expect(isLeaderRole('other')).toBe(false);
    expect(isLeaderRole(null)).toBe(false);
    expect(isLeaderRole(undefined)).toBe(false);
    expect(isLeaderRole('')).toBe(false);
  });

  it('trims + lowercases before comparing (registration stores raw strings)', () => {
    expect(isLeaderRole(' AEO ')).toBe(true);
    expect(isLeaderRole('School_Leader')).toBe(true);
  });
});

describe('publicUserPayload', () => {
  // The real row shape: `users.name` is the only name column — first_name and
  // last_name were dropped in V1.4.4 (bd-60092). A fixture carrying the dead
  // columns is what let the doubled name below ship unnoticed.
  const user = {
    name: 'Noor Fatima',
    phone_number: '923001234567',
    country: 'PK',
    role: 'aeo',
    portal_password_hash: 'SECRET',   // must never leak
  };

  // How the portal frontend renders the pair (PortalDashboard greeting,
  // PortalSetup "Name:" line): join the non-empty parts with a space.
  const rendered = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ');

  it('echoes role (the field the frontend gates on) and never leaks the password hash', () => {
    const out = publicUserPayload(user);
    expect(out.role).toBe('aeo');
    expect(out.firstName).toBe('Noor Fatima');
    expect(out.country).toBe('PK');
    expect(out).not.toHaveProperty('portal_password_hash');
  });

  it('role defaults to null when absent (a teacher without a role)', () => {
    expect(publicUserPayload({ name: 'Ayesha' }).role).toBeNull();
  });

  it('includes contact fields (lastName/phoneNumber) only when asked (dashboard shape)', () => {
    const login = publicUserPayload(user);
    expect(login).not.toHaveProperty('lastName');
    expect(login).not.toHaveProperty('phoneNumber');

    const dash = publicUserPayload(user, { includeContact: true });
    expect(dash).toHaveProperty('lastName');
    expect(dash.phoneNumber).toBe('923001234567');
    expect(dash.role).toBe('aeo');
  });

  it('the dashboard shape renders the name ONCE, not "Noor Fatima Noor Fatima"', () => {
    // There is no surname column any more, so lastName must not echo `name`
    // a second time — the greeting joins first + last.
    const dash = publicUserPayload(user, { includeContact: true });
    expect(rendered(dash)).toBe('Noor Fatima');
    expect(dash.lastName).toBeNull();
  });
});

describe('makeRequireLeaderRole (server-side gate)', () => {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  }

  it('calls next() for a leader and does NOT respond', async () => {
    const getUser = jest.fn().mockResolvedValue({ id: 'u1', role: 'aeo' });
    const mw = makeRequireLeaderRole({ getUser });
    const req = { session: { portalUserId: 'u1' } };
    const res = mockRes();
    const next = jest.fn();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
    expect(getUser).toHaveBeenCalledWith('u1');
  });

  it('403s a non-leader (teacher) and does NOT call next()', async () => {
    const getUser = jest.fn().mockResolvedValue({ id: 'u2', role: 'teacher' });
    const mw = makeRequireLeaderRole({ getUser });
    const req = { session: { portalUserId: 'u2' } };
    const res = mockRes();
    const next = jest.fn();

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('403s when the user has no role at all', async () => {
    const getUser = jest.fn().mockResolvedValue({ id: 'u3' });
    const mw = makeRequireLeaderRole({ getUser });
    const res = mockRes();
    const next = jest.fn();
    await mw({ session: { portalUserId: 'u3' } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('500s (not a crash) if the user lookup throws', async () => {
    const getUser = jest.fn().mockRejectedValue(new Error('db down'));
    const mw = makeRequireLeaderRole({ getUser });
    const res = mockRes();
    const next = jest.fn();
    await mw({ session: { portalUserId: 'u4' } }, res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});
