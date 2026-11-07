/**
 * bd-33wxxi.2 — GET /api/portal/principal/school/card (dashboard/routes/portal-principal.routes.js): the principal's
 * OWN school's card, the coach School Card read through her users.school_id (services/coach-school-card.service.js
 * getPrincipalSchoolCard), counts only.
 *
 *   signed out                         401 (requirePortalAuth, the guard it is mounted with)
 *   not on the principal app           404, nothing read (portal_principal_app off for her, or she is not a principal)
 *   on, her row names no school        200 { school: null } — the card says "No school"
 *   on                                 200 { success, school, period, overview, tiles, teachers, scores (counts) }
 *   period                             today | week | month (default week); anything else 400
 *
 * The school is never taken from the request: only the session user is read.
 */
process.env.FLAG_CACHE_TTL_MS = '0';

const PRINCIPAL = 'p-1';
let settings;
let users;

function fakeSupabase() {
  return {
    from(table) {
      let key = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { key = v; return chain; },
        maybeSingle: async () => {
          if (table === 'app_settings') return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
          if (table === 'users') return { data: users[key] || null, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

function findRoute(router, method, p) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === p && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${p}`);
}

async function call(router, { userId = PRINCIPAL, query = {} } = {}) {
  const req = { session: userId ? { portalUserId: userId } : null, query, params: {}, body: {}, headers: {}, get: () => undefined };
  let statusCode = 200; let payload = null; const headers = {};
  const res = {
    status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; }, set(k, v) { headers[k] = v; return this; },
  };
  for (const h of findRoute(router, 'get', '/principal/school/card')) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload, headers };
}

let getPrincipalSchoolCard;
function makeRouter() {
  const { createPrincipalRouter } = require('../../dashboard/routes/portal-principal.routes');
  const auth = (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({ success: false }));
  return createPrincipalRouter({ guards: [auth], supabase: fakeSupabase(), query: jest.fn(), card: { getPrincipalSchoolCard } });
}

beforeEach(() => {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  settings = { portal_principal_app: [PRINCIPAL] };
  users = { [PRINCIPAL]: { role: 'principal', school_id: 's-1' }, 't-1': { role: 'teacher', school_id: 's-1' } };
  getPrincipalSchoolCard = jest.fn(async () => ({
    school: { emis: '1126', name: 'Sample School', teachers: 7 }, period: { key: 'week' },
    overview: { teachers: 7, active: { now: 3, prev: 2 } }, tiles: [], teachers: [], scores: { dc: { count: 4, makers: 2 }, coach: { count: 1, makers: 1 } },
  }));
});
afterEach(() => jest.restoreAllMocks());

test('signed out: 401', async () => {
  expect((await call(makeRouter(), { userId: null })).statusCode).toBe(401);
});

test('not on the principal app: 404 and nothing is read (switch absent, unlisted, or not a principal)', async () => {
  settings = {};
  expect((await call(makeRouter())).statusCode).toBe(404);
  settings = { portal_principal_app: ['someone-else'] };
  expect((await call(makeRouter())).statusCode).toBe(404);
  settings = { portal_principal_app: ['t-1'] };
  expect((await call(makeRouter(), { userId: 't-1' })).statusCode).toBe(404);
  expect(getPrincipalSchoolCard).not.toHaveBeenCalled();
});

test('on, her row names no school: 200 { school: null }, the card is not read', async () => {
  users[PRINCIPAL].school_id = null;
  const { statusCode, payload } = await call(makeRouter());
  expect(statusCode).toBe(200);
  expect(payload).toEqual({ success: true, school: null });
  expect(getPrincipalSchoolCard).not.toHaveBeenCalled();
});

test('on: her card for the SESSION user, This week by default, private', async () => {
  const { statusCode, payload, headers } = await call(makeRouter(), { query: { schoolId: 'other', userId: 'other' } });
  expect(statusCode).toBe(200);
  expect(payload).toMatchObject({ success: true, school: { emis: '1126' }, scores: { dc: { count: 4, makers: 2 } } });
  const [, who, opts] = getPrincipalSchoolCard.mock.calls[0];
  expect(who).toBe(PRINCIPAL);
  expect(opts.period).toBe('week');
  expect(headers['Cache-Control']).toBe('private, no-store');
});

test('period month and a level pass through; a bad period is 400', async () => {
  await call(makeRouter(), { query: { period: 'month', level: 'primary' } });
  const [, , opts] = getPrincipalSchoolCard.mock.calls[0];
  expect(opts.period).toBe('month');
  expect(opts.level).toBe('primary');
  expect((await call(makeRouter(), { query: { period: 'year' } })).statusCode).toBe(400);
});

test('the card gone (null): 404; a failed read: 500, never an empty card', async () => {
  getPrincipalSchoolCard.mockResolvedValueOnce(null);
  expect((await call(makeRouter())).statusCode).toBe(404);
  getPrincipalSchoolCard.mockRejectedValueOnce(new Error('db down'));
  expect((await call(makeRouter())).statusCode).toBe(500);
});

test('it is mounted on the portal API behind requirePortalAuth', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  expect(src).toMatch(/require\('\.\/portal-principal\.routes'\)\.createPrincipalRouter\(\{\s*guards: \[requirePortalAuth\]/);
});
