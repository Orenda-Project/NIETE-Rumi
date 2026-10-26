'use strict';
/**
 * bd-sex15q.13 — the three COACHIP switches (SPEC v2 §2, API.md §5), fail-closed (B8).
 *
 *   portal_coachip         JSON list of users.id (or true)      → isFlagEnabledForUser
 *   portal_coachip_rm      JSON OBJECT {"<users.id>": "<sector>"} → rmSectorFor: object only, exact key, value ∈ SECTORS
 *   portal_coachip_decode  JSON list of users.id                → isFlagEnabledForUser
 *
 * And GET /api/portal/config carries features.coachip / coachipRm / coachipDecode, all false with no rows, false on
 * the route's catch fallback, and coachipDecode only with coachip on. The real flag module and the real /config
 * route run; only the supabase client (the network boundary) is faked.
 */

const COACH = '11111111-1111-4111-8111-111111111111';
const RM = 'ab222222-2222-4222-8222-2222222222cd';
let settings;
let readFails;

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain, order: () => chain, limit: () => chain, in: () => chain,
    eq: (_c, v) => { key = v; return chain; },
    maybeSingle: async () => {
      if (table !== 'app_settings') return { data: null, error: null };
      if (readFails) return { data: null, error: { message: 'boom' } };
      return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}
const supabase = { from: (t) => makeChain(t) };

beforeEach(() => { settings = {}; readFails = false; });

describe('flag constants', () => {
  test('the three keys are exported under their contract names', () => {
    const f = require('../../dashboard/lib/feature-flags');
    expect(f.PORTAL_COACHIP_KEY).toBe('portal_coachip');
    expect(f.PORTAL_COACHIP_RM_KEY).toBe('portal_coachip_rm');
    expect(f.PORTAL_COACHIP_DECODE_KEY).toBe('portal_coachip_decode');
    expect(typeof f.rmSectorFor).toBe('function');
  });
});

describe('rmSectorFor: object only, exact userId key, a real sector, anything else null', () => {
  const { rmSectorFor } = require('../../dashboard/lib/feature-flags');
  test('a JSON object with the exact key → the sector', async () => {
    settings.portal_coachip_rm = { [RM]: 'Urban-I' };
    await expect(rmSectorFor(supabase, RM)).resolves.toBe('Urban-I');
  });
  test('the object stored as a JSON string → the sector', async () => {
    settings.portal_coachip_rm = JSON.stringify({ [RM]: 'Tarnol' });
    await expect(rmSectorFor(supabase, RM)).resolves.toBe('Tarnol');
  });
  test.each([
    ['absent row', undefined],
    ['a list with the id', [RM]],
    ['true', true],
    ['a number', 7],
    ['an empty object', {}],
    ['bad JSON string', '{"oops'],
    ['another user only', { [COACH]: 'Urban-I' }],
    ['a sector that is not one of the six', { [RM]: 'Lahore' }],
    ['a non-string sector', { [RM]: ['Urban-I'] }],
    ['the key differs in case', { [RM.toUpperCase()]: 'Urban-I' }],
  ])('%s → null', async (_name, value) => {
    if (value !== undefined) settings.portal_coachip_rm = value;
    await expect(rmSectorFor(supabase, RM)).resolves.toBeNull();
  });
  test('a read error → null', async () => {
    settings.portal_coachip_rm = { [RM]: 'Urban-I' };
    readFails = true;
    await expect(rmSectorFor(supabase, RM)).resolves.toBeNull();
  });
  test('no user → null, without a read', async () => {
    const from = jest.fn(() => makeChain('app_settings'));
    await expect(rmSectorFor({ from }, null)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
  test('a client that throws → null', async () => {
    await expect(rmSectorFor({ from: () => { throw new Error('down'); } }, RM)).resolves.toBeNull();
  });
});

describe('portal_coachip / portal_coachip_decode through isFlagEnabledForUser: absent, object, number, empty list, read error are OFF', () => {
  const { isFlagEnabledForUser, PORTAL_COACHIP_KEY } = require('../../dashboard/lib/feature-flags');
  test.each([
    ['absent', undefined, false],
    ['an object', { [COACH]: true }, false],
    ['a number', 1, false],
    ['an empty list', [], false],
    ['a list with the id', [COACH], true],
  ])('%s', async (_n, value, want) => {
    if (value !== undefined) settings[PORTAL_COACHIP_KEY] = value;
    await expect(isFlagEnabledForUser(supabase, PORTAL_COACHIP_KEY, COACH)).resolves.toBe(want);
  });
  test('a read error is off', async () => {
    settings[PORTAL_COACHIP_KEY] = [COACH];
    readFails = true;
    await expect(isFlagEnabledForUser(supabase, PORTAL_COACHIP_KEY, COACH)).resolves.toBe(false);
  });
});

describe('GET /api/portal/config → features.coachip / coachipRm / coachipDecode', () => {
  function findRoute(router, method, path) {
    for (const layer of router.stack) {
      if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
    }
    throw new Error(`no ${method} ${path}`);
  }
  async function getConfig(userId, { brokenSupabase = false } = {}) {
    jest.resetModules();
    jest.doMock('../../dashboard/config/supabase', () => (brokenSupabase ? { from: () => { throw new Error('x'); } } : supabase));
    jest.doMock('../../dashboard/services/r2.service', () => ({ generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn() }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    const routes = require('../../dashboard/routes/portal.routes');
    const stack = findRoute(routes, 'get', '/config');
    const req = { session: userId ? { portalUserId: userId } : {}, params: {}, body: {}, query: {}, headers: {}, get: () => undefined };
    let payload = null;
    const res = { status() { return this; }, json(b) { payload = b; return this; } };
    const errs = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { for (const h of stack) { let nx = false; await h(req, res, () => { nx = true; }); if (!nx) break; } } finally { errs.mockRestore(); }
    return payload;
  }
  afterAll(() => jest.resetModules());

  test('no rows → all three false', async () => {
    const p = await getConfig(COACH);
    expect(p.features).toMatchObject({ coachip: false, coachipRm: false, coachipDecode: false });
  });
  test('signed out → all three false', async () => {
    settings.portal_coachip = true;
    const p = await getConfig(null);
    expect(p.features).toMatchObject({ coachip: false, coachipRm: false, coachipDecode: false });
  });
  test('the coach on the list → coachip true; decode only with coachip on too', async () => {
    settings.portal_coachip = [COACH];
    settings.portal_coachip_decode = [COACH];
    const p = await getConfig(COACH);
    expect(p.features).toMatchObject({ coachip: true, coachipRm: false, coachipDecode: true });
  });
  test('decode without coachip → coachipDecode false', async () => {
    settings.portal_coachip_decode = [COACH];
    const p = await getConfig(COACH);
    expect(p.features.coachipDecode).toBe(false);
  });
  test('an RM in the object → coachipRm true', async () => {
    settings.portal_coachip_rm = { [RM]: 'Nilore' };
    const p = await getConfig(RM);
    expect(p.features).toMatchObject({ coachip: false, coachipRm: true, coachipDecode: false });
  });
  test('the route\'s catch fallback carries the three as false', async () => {
    const p = await getConfig(COACH, { brokenSupabase: true });
    expect(p.features).toMatchObject({ coachip: false, coachipRm: false, coachipDecode: false });
  });
});
