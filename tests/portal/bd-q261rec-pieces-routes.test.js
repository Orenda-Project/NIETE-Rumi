/**
 * bd-q261rec (queue #261) — the portal routes a recording is sent through IN PIECES (resumes after a drop).
 *
 *   teacher             POST /coaching-upload/pieces/{begin,sign,join}        (requireSelfObservation)
 *   coach / principal   POST /leader/observe-upload/pieces/{begin,sign,join}  (the observe gate, as /observe-upload/presign)
 *
 * They hold no logic: the bot signs and joins (portal-upload-pieces.service). Pinned here: the user is always the
 * SESSION's (a userId in the body is ignored), only the named fields ride along, and the bot's answer — a 400 that
 * names the missing pieces included — is relayed as it is, so the phone can send just those again.
 */

require('../fixtures/portal-auth-live').installLivePortalAccounts();

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

async function invoke(path, { userId, body = {} }) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, 'post', path);
  const req = {
    session: userId ? { portalUserId: userId, id: 'sess-1' } : null,
    params: {}, body, query: {}, method: 'POST', path, ip: '127.0.0.1', headers: {}, get: () => undefined,
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
    app_settings: [
      { key: 'portal_self_observation', value: true },
      { key: 'portal_coach_observation', value: ['coach-1'] },
    ],
    users: [{ id: 'coach-1', role: 'coach' }, { id: 'teacher-1', role: 'teacher' }],
  };
  client = {
    presignUpload: ok(),
    piecesBegin: ok({ key: 'k', pieces: 3, have: [] }),
    piecesSign: ok({ urls: [{ n: 0, url: 'u' }] }),
    piecesJoin: ok({ key: 'k', sizeBytes: 9 }),
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

const CASES = [
  ['begin', 'piecesBegin', { filename: 'a.webm', sizeBytes: 9, pieceBytes: 65536, key: 'k' },
    { filename: 'a.webm', sizeBytes: 9, pieceBytes: 65536, key: 'k' }],
  ['sign', 'piecesSign', { key: 'k', pieces: [0, 1], attempt: 2 }, { key: 'k', pieces: [0, 1], attempt: 2 }],
  ['join', 'piecesJoin', { key: 'k', sizeBytes: 9, pieceBytes: 65536, digests: ['d'] },
    { key: 'k', sizeBytes: 9, pieceBytes: 65536, digests: ['d'] }],
];

describe.each([
  ['teacher', '/coaching-upload/pieces', 'teacher-1'],
  ['coach', '/leader/observe-upload/pieces', 'coach-1'],
])('%s: %s/*', (_who, base, uid) => {
  test.each(CASES)('%s relays for the SESSION user, named fields only', async (step, fn, body, sent) => {
    const { statusCode } = await invoke(`${base}/${step}`, { userId: uid, body: { ...body, userId: 'someone-else', junk: 1 } });
    expect(statusCode).toBe(200);
    expect(client[fn]).toHaveBeenCalledWith({ userId: uid, ...sent });
  });

  test('a join refused for missing pieces is relayed with the list', async () => {
    client.piecesJoin.mockResolvedValue({ httpStatus: 400, body: { success: false, status: 'invalid', reason: 'pieces_missing', missing: [1] } });
    const { statusCode, payload } = await invoke(`${base}/join`, { userId: uid, body: { key: 'k', sizeBytes: 9, pieceBytes: 65536 } });
    expect(statusCode).toBe(400);
    expect(payload).toMatchObject({ reason: 'pieces_missing', missing: [1] });
  });

  test('no session: 401 and the bot is never asked', async () => {
    const { statusCode } = await invoke(`${base}/begin`, { userId: null, body: {} });
    expect(statusCode).toBe(401);
    expect(client.piecesBegin).not.toHaveBeenCalled();
  });
});

test('the coach routes stay closed to a teacher (the observe gate)', async () => {
  const { statusCode } = await invoke('/leader/observe-upload/pieces/begin', { userId: 'teacher-1', body: {} });
  expect([403, 404]).toContain(statusCode);
  expect(client.piecesBegin).not.toHaveBeenCalled();
});

test('the client posts to the bot\'s pieces-* routes', () => {
  jest.resetModules();
  jest.dontMock('../../dashboard/services/portal-coaching.client');
  const axios = { post: jest.fn().mockResolvedValue({ status: 200, data: { status: 'ok' } }) };
  jest.doMock('axios', () => axios);
  process.env.MAIN_BOT_URL = process.env.MAIN_BOT_URL || 'http://bot.test';
  process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'secret';
  const real = require('../../dashboard/services/portal-coaching.client');
  return Promise.all([
    real.piecesBegin({ userId: 'u', filename: 'a.webm', sizeBytes: 1, pieceBytes: 65536 }),
    real.piecesSign({ userId: 'u', key: 'k', pieces: [0] }),
    real.piecesJoin({ userId: 'u', key: 'k', sizeBytes: 1, pieceBytes: 65536 }),
  ]).then(() => {
    const paths = axios.post.mock.calls.map((c) => c[0].replace(/^.*\/api\/internal\/coaching\//, ''));
    expect(paths).toEqual(['pieces-begin', 'pieces-sign', 'pieces-join']);
  });
});
