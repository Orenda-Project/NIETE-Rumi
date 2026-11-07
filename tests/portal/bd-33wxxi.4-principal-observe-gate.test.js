/**
 * bd-33wxxi.4 — the portal's /observe API and a PRINCIPAL (#55 P3).
 *
 * The observe routes are leader-only and open with portal_coach_observation (or portal_coach_v2) on for the user. A
 * principal is a leader role, so with portal_coach_observation = true (production today) any principal could drive
 * the whole pipeline through the API with no page of hers in the app. From P3 a principal needs the principal app
 * (portal_principal_app names her) instead; coaches and everyone else are exactly as before.
 * (Harness copied from bd-5rz1v.6-coach-observation-routes.test.js.)
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

const presign = ['post', '/leader/observe-upload/presign', { filename: 'a.webm', sizeBytes: 10, kind: 'audio' }];
async function call(userId) {
  const [m, p, body] = presign;
  return invoke(m, p, { userId, body });
}
const setFlag = (key, value) => {
  tableRows.app_settings = tableRows.app_settings.filter((r) => r.key !== key);
  if (value !== undefined) tableRows.app_settings.push({ key, value });
};

describe('the observe API and a principal', () => {
  beforeEach(() => {
    tableRows.users.push({ id: 'principal-1', role: 'principal', school_id: 's-1' }, { id: 'principal-2', role: 'principal', school_id: 's-1' });
  });

  test('portal_coach_observation = true (prod today): an UNLISTED principal is 404 and the bot is never called', async () => {
    setFlag('portal_coach_observation', true);
    const { statusCode } = await call('principal-1');
    expect(statusCode).toBe(404);
    expect(client.presignUpload).not.toHaveBeenCalled();
  });

  test('the same principal on a coach pilot list (portal_coach_observation names her) is still 404 without the principal app', async () => {
    setFlag('portal_coach_observation', ['principal-1']);
    expect((await call('principal-1')).statusCode).toBe(404);
  });

  test('a principal the principal app names: the API answers (with no coach flag at all)', async () => {
    setFlag('portal_coach_observation', undefined);
    setFlag('portal_principal_app', ['principal-1']);
    const { statusCode } = await call('principal-1');
    expect(statusCode).toBe(200);
    expect(client.presignUpload).toHaveBeenCalledWith(expect.objectContaining({ userId: 'principal-1' }));
    // another principal is still out
    client.presignUpload.mockClear();
    expect((await call('principal-2')).statusCode).toBe(404);
    expect(client.presignUpload).not.toHaveBeenCalled();
  });

  test('coaches are unchanged: on the coach flag they pass, the principal app is not asked of them', async () => {
    setFlag('portal_coach_observation', true);
    setFlag('portal_principal_app', undefined);
    expect((await call('coach-1')).statusCode).toBe(200);
    expect((await call('coach-2')).statusCode).toBe(200);
  });

  test('a teacher is still 403 (not a leader)', async () => {
    setFlag('portal_coach_observation', true);
    setFlag('portal_principal_app', ['teacher-1']);
    expect((await call('teacher-1')).statusCode).toBe(403);
  });
});
