/**
 * bd-5rz1v.6 — the portal routes behind a coach's /observe observation.
 *
 * Every route: the coach is ALWAYS the session's user (a userId in the body is
 * ignored), the route is leader-only, and it is dark behind
 * app_settings.portal_coach_observation (isFlagEnabledForUser — fail closed,
 * 404 when off, and the bot is never called). The routes relay the bot's answer.
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

const ROUTES = [
  ['post', '/leader/observe-upload/presign', {}, { filename: 'a.webm', sizeBytes: 10, kind: 'audio' }, 'presignUpload',
    { userId: 'coach-1', filename: 'a.webm', sizeBytes: 10, kind: 'audio' }],
  ['post', '/leader/observe/start', {}, { teacherExtId: 't1', schoolExtId: 's1', key: 'k', photoKeys: [], lessonPlan: { assetId: 'a', userId: 'x' } }, 'startObservation',
    { userId: 'coach-1', teacherExtId: 't1', schoolExtId: 's1', key: 'k', lessonPlanKey: undefined, photoKeys: [], lessonPlan: { assetId: 'a' } }],
  ['get', '/leader/observe/active', {}, {}, 'listObservations', { userId: 'coach-1' }],
  ['get', '/leader/observe/:id', { id: 'cs-1' }, {}, 'observationView', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
  ['get', '/leader/observe/:id/draft', { id: 'cs-1' }, {}, 'getObservationDraft', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
  ['post', '/leader/observe/:id/draft', { id: 'cs-1' }, { edits: { r_C1: '2' } }, 'saveObservationDraft', { userId: 'coach-1', coachingSessionId: 'cs-1', edits: { r_C1: '2' } }],
  ['post', '/leader/observe/:id/talk/guide', { id: 'cs-1' }, {}, 'observationTalkGuide', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
  ['post', '/leader/observe/:id/talk', { id: 'cs-1' }, { key: 'k' }, 'startObservationTalk', { userId: 'coach-1', coachingSessionId: 'cs-1', key: 'k' }],
  ['post', '/leader/observe/:id/talk/retry', { id: 'cs-1' }, {}, 'retryObservationTalk', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
  ['post', '/leader/observe/:id/report/preview', { id: 'cs-1' }, {}, 'previewObservationReport', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
  ['post', '/leader/observe/:id/report/send', { id: 'cs-1' }, {}, 'sendObservationReport', { userId: 'coach-1', coachingSessionId: 'cs-1' }],
];

describe('coach observation routes', () => {
  test.each(ROUTES)('%s %s relays for the SESSION coach', async (method, path, params, body, fn, expected) => {
    const { statusCode } = await invoke(method, path, { params, body: { ...body, userId: 'someone-else' } });
    expect(statusCode).toBe(200);
    expect(client[fn]).toHaveBeenCalledWith(expected);
  });

  test('recent plans take the teacher from the query', async () => {
    await invoke('get', '/leader/observe/recent-plans', { query: { teacherExtId: 't1', schoolExtId: 's1', userId: 'x' } });
    expect(client.observeRecentPlans).toHaveBeenCalledWith({ userId: 'coach-1', teacherExtId: 't1', schoolExtId: 's1' });
  });

  test.each(ROUTES)('%s %s is dark (404) when the flag does not include her', async (method, path, params, body, fn) => {
    tableRows.app_settings = [{ key: 'portal_coach_observation', value: ['coach-2'] }];
    const { statusCode } = await invoke(method, path, { params, body });
    expect(statusCode).toBe(404);
    expect(client[fn]).not.toHaveBeenCalled();
  });

  test('no flag row at all is off', async () => {
    tableRows.app_settings = [];
    expect((await invoke('get', '/leader/observe/active')).statusCode).toBe(404);
  });

  test('a teacher is refused even with the flag', async () => {
    tableRows.app_settings = [{ key: 'portal_coach_observation', value: true }];
    const { statusCode } = await invoke('get', '/leader/observe/active', { userId: 'teacher-1' });
    expect(statusCode).toBe(403);
    expect(client.listObservations).not.toHaveBeenCalled();
  });

  test('the bot\'s 4xx answer is relayed; an unreachable bot is a 502', async () => {
    client.startObservation.mockResolvedValue({ httpStatus: 400, body: { success: false, status: 'invalid', reason: 'not_your_teacher' } });
    expect(await invoke('post', '/leader/observe/start', { body: { key: 'k' } }))
      .toMatchObject({ statusCode: 400, payload: { reason: 'not_your_teacher' } });
    client.observationView.mockRejectedValue(new Error('ECONNREFUSED'));
    expect((await invoke('get', '/leader/observe/:id', { params: { id: 'cs-1' } })).statusCode).toBe(502);
  });
});

describe('GET /config — features.coachObservation', () => {
  test('on for a coach in the pilot list, off for everyone else', async () => {
    const on = await invoke('get', '/config');
    expect(on.payload.features.coachObservation).toBe(true);
    const off = await invoke('get', '/config', { userId: 'coach-2' });
    expect(off.payload.features.coachObservation).toBe(false);
    expect(off.payload.features.selfObservation).toBe(false);
  });
});
