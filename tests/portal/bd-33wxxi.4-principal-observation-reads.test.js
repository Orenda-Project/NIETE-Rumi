/**
 * bd-33wxxi.4 — the two coach-app reads the observation screens need, for a PRINCIPAL on the principal app (#55 P3):
 *   GET /coach/observation/:id   one of her observations (the service scopes it to her own school: role principal)
 *   GET /coach/reports           her observations as observer
 * A principal on portal_principal_app gets them for HER school (getPatchTeachers role 'principal'); a principal it does
 * not name is 404 even with portal_coach_v2 = true; a coach is exactly as before (role 'coach').
 * Harness from bd-5rz1v.6-coach-observation-routes.test.js.
 */
/*
 * (The observe API and a PRINCIPAL (#55 P3).
 *
 * The observe routes are leader-only and open with portal_coach_observation (or portal_coach_v2) on for the user. A
 * principal is a leader role, so with portal_coach_observation = true (production today) any principal could drive
 * the whole pipeline through the API with no page of hers in the app. From P3 a principal needs the principal app
 * (portal_principal_app names her) instead; coaches and everyone else are exactly as before.
 */

let tableRows;
let client;

function makeChain(table) {
  const tests = [];
  const run = () => (tableRows[table] || []).filter((r) => tests.every((t) => t(r)));
  const chain = {
    select: () => chain,
    eq: (c, v) => { tests.push((r) => r[c] === v); return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: run()[0] || null, error: null }),
    single: async () => {
      const r = run()[0] || null;
      return { data: r, error: r ? null : { code: 'PGRST116', message: 'no rows' } };
    },
    then: (res, rej) => Promise.resolve({ data: run(), error: null }).then(res, rej),
  };
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.map((s) => s.handle);
    }
  }
  throw new Error(`no ${method.toUpperCase()} ${path}`);
}

async function invoke(method, path, { userId = 'coach-1', params = {}, body = {}, query = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params, body, query, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const handler of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

const ok = (body = {}) => jest.fn().mockResolvedValue({ httpStatus: 200, body: { success: true, status: 'ok', ...body } });

beforeEach(() => {
  jest.resetModules();
  tableRows = {
    app_settings: [{ key: 'portal_coach_observation', value: ['coach-1'] }],
    users: [{ id: 'coach-1', role: 'coach' }, { id: 'teacher-1', role: 'teacher' }, { id: 'coach-2', role: 'coach' }],
  };
  client = {
    presignUpload: ok({ key: 'k', uploadUrl: 'u', contentType: 'audio/webm' }),
    startSession: jest.fn(),
    submitReflection: jest.fn(),
    recentPlans: jest.fn(),
    startObservation: ok({ coachingSessionId: 'cs-1' }),
    observeRecentPlans: ok({ plans: [] }),
    listObservations: ok({ observations: [] }),
    observationView: ok({ id: 'cs-1', step: 'draft' }),
    getObservationDraft: ok({ sections: [] }),
    saveObservationDraft: ok({ summary: {} }),
    observationTalkGuide: ok({ guide: {} }),
    startObservationTalk: ok(),
    retryObservationTalk: ok(),
    previewObservationReport: ok(),
    sendObservationReport: ok(),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn().mockResolvedValue(null),
    generatePresignedUrls: jest.fn().mockResolvedValue([]),
    isValidR2Url: jest.fn().mockReturnValue(true),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());



process.env.FLAG_CACHE_TTL_MS = '0';
const OBS = '11111111-2222-4333-8444-555555555555';
let CoachV2;
const setFlag = (key, value) => {
  tableRows.app_settings = tableRows.app_settings.filter((r) => r.key !== key);
  if (value !== undefined) tableRows.app_settings.push({ key, value });
};
beforeEach(() => {
  tableRows.users.push({ id: 'principal-1', role: 'principal', school_id: 's-1' }, { id: 'principal-2', role: 'principal', school_id: 's-1' });
  CoachV2 = {
    getCoachObservation: jest.fn(async () => ({ id: OBS, step: 'draft', teacher: { name: 'T' }, reportKey: null, audioKey: null })),
    getCoachReports: jest.fn(async () => ({ waiting: [], inProgress: [], all: { total: 0, page: 1, pageSize: 30, items: [] } })),
  };
  jest.doMock('../../dashboard/services/coach-v2.service', () => new Proxy(CoachV2, {
    get: (t, k) => (k in t ? t[k] : jest.fn(async () => null)),
  }));
});

describe('GET /coach/observation/:id and /coach/reports — a principal on the principal app', () => {
  test('listed principal: both answer, scoped to her school (role principal)', async () => {
    setFlag('portal_principal_app', ['principal-1']);
    const one = await invoke('get', '/coach/observation/:id', { userId: 'principal-1', params: { id: OBS } });
    expect(one.statusCode).toBe(200);
    expect(CoachV2.getCoachObservation).toHaveBeenCalledWith(expect.anything(), 'principal-1', OBS, expect.objectContaining({ role: 'principal' }));
    const list = await invoke('get', '/coach/reports', { userId: 'principal-1' });
    expect(list.statusCode).toBe(200);
    expect(CoachV2.getCoachReports).toHaveBeenCalledWith(expect.anything(), 'principal-1', expect.objectContaining({ role: 'principal' }));
  });

  test('an unlisted principal is 404 even with portal_coach_v2 = true, and nothing is read', async () => {
    setFlag('portal_coach_v2', true);
    setFlag('portal_principal_app', ['principal-1']);
    expect((await invoke('get', '/coach/observation/:id', { userId: 'principal-2', params: { id: OBS } })).statusCode).toBe(404);
    expect((await invoke('get', '/coach/reports', { userId: 'principal-2' })).statusCode).toBe(404);
    expect(CoachV2.getCoachObservation).not.toHaveBeenCalled();
    expect(CoachV2.getCoachReports).not.toHaveBeenCalled();
  });

  test('a coach is unchanged: portal_coach_v2 opens them, role coach', async () => {
    setFlag('portal_coach_v2', ['coach-1']);
    expect((await invoke('get', '/coach/observation/:id', { userId: 'coach-1', params: { id: OBS } })).statusCode).toBe(200);
    expect(CoachV2.getCoachObservation).toHaveBeenCalledWith(expect.anything(), 'coach-1', OBS, expect.objectContaining({ role: 'coach' }));
    expect((await invoke('get', '/coach/reports', { userId: 'coach-2' })).statusCode).toBe(404);
  });
});
