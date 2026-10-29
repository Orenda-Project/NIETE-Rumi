/**
 * The coach School Card's switch and routes.
 *
 * ONE app_settings key, portal_coach_school_card (true, or a list of users.id; absent = off), read by
 * isFlagEnabledForUser for the SESSION user. Every School Card route sits behind the coach app v2 chain
 * (auth, leader role, portal_coach_v2) and then requireSchoolCard: off for her, the route is a 404, the same
 * as a route that does not exist, and nothing is read. /config carries it as features.schoolCard, which is
 * true only when the coach app v2 is on for her too (the routes need both).
 */
const { PORTAL_COACH_SCHOOL_CARD_KEY, isFlagEnabledForUser } = require('../../dashboard/lib/feature-flags');

let settings;
let poolQuery;
let settingsThrow;

function makeChain(table) {
  let key = null;
  const chain = {
    select: () => chain,
    eq: (_col, val) => { key = val; return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') {
        if (settingsThrow) throw new Error('settings down');
        return { data: Object.prototype.hasOwnProperty.call(settings, key) ? { value: settings[key] } : null, error: null };
      }
      return { data: null, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function loadRoutes() {
  jest.resetModules();
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/config/database', () => ({ query: (...a) => poolQuery(...a) }));
  jest.doMock('../../dashboard/services/portal-coaching.client', () => ({}));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
  return require('../../dashboard/routes/portal.routes');
}

/** The handlers of `method path`, looking inside mounted routers too. */
function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
    if (!layer.route && layer.handle && Array.isArray(layer.handle.stack)) {
      try { return findRoute(layer.handle, method, path); } catch (_) { /* not in this one */ }
    }
  }
  throw new Error(`no ${method} ${path}`);
}

async function run(stack, req) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { payload = b; return this; },
    set() { return this; },
  };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const logs = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    for (const h of stack) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
  } finally {
    errors.mockRestore();
    logs.mockRestore();
  }
  return { statusCode, payload };
}

// A synthetic number, built at runtime (the repo holds no phone-shaped literal).
const EXT = '92' + '000' + '0000001';

const ROUTES = [
  ['/coach/school/:emis/card', { emis: '901' }],
  ['/coach/school/:emis/feature/:feature', { emis: '901', feature: 'lp' }],
  ['/coach/teacher/:ext/card', { ext: EXT }],
  ['/coach/teacher/:ext/items/:feature', { ext: EXT, feature: 'lp' }],
  ['/coach/teacher/:ext/coaching', { ext: EXT }],
  ['/coach/session/:id', { id: '00000000-0000-4000-8000-000000000001' }],
];

/** From the coach v2 gate onward (auth and the leader role are shared, tested middlewares). */
async function call(path, { params = {}, query = {}, userId = 'coach-1' } = {}) {
  const stack = findRoute(loadRoutes(), 'get', path);
  const gateAt = stack.findIndex((h) => h.name === 'requireCoachV2');
  if (gateAt < 0) throw new Error(`${path} has no requireCoachV2`);
  return run(stack.slice(gateAt), { params, query, body: {}, session: { portalUserId: userId }, portalUser: { role: 'coach' }, headers: {}, get: () => undefined });
}

beforeEach(() => {
  settings = {};
  settingsThrow = false;
  poolQuery = jest.fn(async () => ({ rows: [] }));
});
afterAll(() => jest.resetModules());

describe('the switch', () => {
  test('the key is portal_coach_school_card', () => {
    expect(PORTAL_COACH_SCHOOL_CARD_KEY).toBe('portal_coach_school_card');
  });

  test.each([
    ['true (everyone)', true, true],
    ['a pilot list that names her', ['coach-1'], true],
    ['a pilot list that leaves her out', ['coach-2'], false],
    ['false', false, false],
    ['an object', { users: ['coach-1'] }, false],
  ])('%s', async (_l, value, expected) => {
    settings.portal_coach_school_card = value;
    expect(await isFlagEnabledForUser({ from: (t) => makeChain(t) }, PORTAL_COACH_SCHOOL_CARD_KEY, 'coach-1')).toBe(expected);
  });
});

describe('every School Card route', () => {
  test.each(ROUTES)('%s: auth, leader role, coach v2, then the School Card switch', (path) => {
    const stack = findRoute(loadRoutes(), 'get', path);
    expect(stack.map((h) => h.name).slice(0, 4)).toEqual(['requirePortalAuth', 'requireLeaderRole', 'requireCoachV2', 'requireSchoolCard']);
  });

  test.each(ROUTES)('%s: signed out is 401', async (path, params) => {
    const stack = findRoute(loadRoutes(), 'get', path);
    const out = await run(stack, { params, query: {}, body: {}, session: {}, headers: {}, get: () => undefined, method: 'GET', path });
    expect(out.statusCode).toBe(401);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test.each(ROUTES)('%s: the switch off is 404 and reads nothing', async (path, params) => {
    settings.portal_coach_v2 = ['coach-1'];
    const out = await call(path, { params });
    expect(out.statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test.each(ROUTES)('%s: the switch on but coach v2 off is 404', async (path, params) => {
    settings.portal_coach_school_card = ['coach-1'];
    const out = await call(path, { params });
    expect(out.statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test.each(ROUTES)('%s: a pilot list naming another coach is 404', async (path, params) => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_school_card = ['coach-2'];
    expect((await call(path, { params })).statusCode).toBe(404);
  });

  test.each(ROUTES)('%s: on, but nothing of hers matches (another coach\'s school / teacher / session) is 404', async (path, params) => {
    settings.portal_coach_v2 = ['coach-1'];
    settings.portal_coach_school_card = ['coach-1'];
    const out = await call(path, { params });
    expect(out.statusCode).toBe(404);
    expect(poolQuery).toHaveBeenCalled();
    // The coach the reads ask about is the SESSION user, never a parameter (a session is read by its id first).
    const first = poolQuery.mock.calls[0][1][0];
    expect(first).toBe(path === '/coach/session/:id' ? params.id : 'coach-1');
  });

  test.each(ROUTES)('%s: a failed read is a 500, not a crash', async (path, params) => {
    settings.portal_coach_v2 = ['coach-1'];
    settings.portal_coach_school_card = ['coach-1'];
    poolQuery = jest.fn(async () => { throw new Error('pool down'); });
    expect((await call(path, { params })).statusCode).toBe(500);
  });
});

describe('inputs are checked before any read', () => {
  beforeEach(() => {
    settings.portal_coach_v2 = ['coach-1'];
    settings.portal_coach_school_card = ['coach-1'];
  });

  test.each([
    ['/coach/school/:emis/card', { emis: '9 01' }],
    ['/coach/school/:emis/feature/:feature', { emis: '901', feature: 'transcript' }],
    ['/coach/teacher/:ext/card', { ext: 'abc' }],
    ['/coach/teacher/:ext/items/:feature', { ext: EXT, feature: 'transcript' }],
    // DC observations and coach visits are the Coaching page now: their old lists are gone
    ['/coach/teacher/:ext/items/:feature', { ext: EXT, feature: 'dc' }],
    ['/coach/teacher/:ext/items/:feature', { ext: EXT, feature: 'coach' }],
    ['/coach/teacher/:ext/coaching', { ext: 'abc' }],
    ['/coach/session/:id', { id: 'not-a-uuid' }],
  ])('%s %o is 404', async (path, params) => {
    expect((await call(path, { params })).statusCode).toBe(404);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('her coaching reports route is gone (the Coaching page replaced it)', () => {
    expect(() => findRoute(loadRoutes(), 'get', '/coach/teacher/:ext/reports')).toThrow(/no get/);
  });

  test('an unknown period on the Coaching page is 400', async () => {
    const out = await call('/coach/teacher/:ext/coaching', { params: { ext: EXT }, query: { period: 'year' } });
    expect(out.statusCode).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });

  test('an unknown period is 400', async () => {
    const out = await call('/coach/school/:emis/card', { params: { emis: '901' }, query: { period: 'year' } });
    expect(out.statusCode).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('a real answer through the route', () => {
  test('the school card for her own school answers 200 with the period it was asked for', async () => {
    settings.portal_coach_v2 = ['coach-1'];
    settings.portal_coach_school_card = ['coach-1'];
    poolQuery = jest.fn(async (sql) => {
      if (/sc:school/.test(sql)) return { rows: [{ id: 's1', name: 'School One', emis: '901', school_name: 'School One' }] };
      return { rows: [] };
    });
    const out = await call('/coach/school/:emis/card', { params: { emis: '901' }, query: { period: 'month' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({ success: true, school: { emis: '901', teachers: 0 }, period: { key: 'month' } });
    expect(out.payload.tiles).toHaveLength(4);
  });

  test('the Coaching page for a teacher in her patch answers 200: summary, chart and one list', async () => {
    settings.portal_coach_v2 = ['coach-1'];
    settings.portal_coach_school_card = ['coach-1'];
    poolQuery = jest.fn(async (sql) => {
      if (/sc:teacher \*/.test(sql)) return { rows: [{ id: 'u1', phone_number: EXT, name: 'Teacher One', role: 'teacher', school_id: 's1', school_name: 'School One', emis: '901' }] };
      return { rows: [] };
    });
    const out = await call('/coach/teacher/:ext/coaching', { params: { ext: EXT }, query: { period: 'month' } });
    expect(out.statusCode).toBe(200);
    expect(out.payload).toMatchObject({
      success: true,
      teacher: { teacherExtId: EXT, name: 'Teacher One' },
      period: { key: 'month' },
      summary: { dc: { count: 0, avg: null, prevAvg: null }, coach: { count: 0, avg: null, prevAvg: null } },
      chart: [],
      items: [],
    });
    // the coach the read asks about is the session user
    expect(poolQuery.mock.calls[0][1][0]).toBe('coach-1');
  });
});

/* ── GET /config ────────────────────────────────────────────────────────── */

async function getConfig({ userId = 'coach-1' } = {}) {
  const stack = findRoute(loadRoutes(), 'get', '/config');
  const req = { params: {}, body: {}, query: {}, method: 'GET', path: '/config', headers: {}, get: () => undefined };
  req.session = userId ? { portalUserId: userId, id: 's' } : {};
  return run(stack, req);
}

describe('GET /config — features.schoolCard', () => {
  test('on for the coach it names, with coach v2 on', async () => {
    settings.portal_coach_v2 = true;
    settings.portal_coach_school_card = ['coach-1'];
    expect((await getConfig()).payload.features.schoolCard).toBe(true);
    expect((await getConfig({ userId: 'coach-2' })).payload.features.schoolCard).toBe(false);
  });

  test('false when coach v2 is off for her: the routes would 404', async () => {
    settings.portal_coach_school_card = true;
    expect((await getConfig()).payload.features.schoolCard).toBe(false);
  });

  test('absent is a real false; logged out is false', async () => {
    settings.portal_coach_v2 = true;
    expect((await getConfig()).payload.features).toHaveProperty('schoolCard', false);
    settings.portal_coach_school_card = true;
    expect((await getConfig({ userId: null })).payload.features.schoolCard).toBe(false);
  });
});
