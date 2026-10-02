/**
 * bd-3bvfj — portal self-observation ships to production DARK.
 *
 * The browser upload cannot work until the R2 bucket allows it (bd-mzck5), so
 * the feature goes out behind one app_settings row, the same fail-closed
 * mechanism as the Assessment Generator (dashboard/lib/feature-flags.js):
 *
 *   portal_self_observation = true                     → every teacher
 *   portal_self_observation = ["<user id>", "<user id>"] → only those (a pilot)
 *   no row, anything else, or a failed read            → OFF
 *
 * Off means invisible AND unusable: /config tells the portal not to show it,
 * and the four routes answer 404 without reaching the bot, so a hidden button
 * cannot be bypassed by calling the API.
 */

const { isFlagEnabledForUser, PORTAL_SELF_OBSERVATION_KEY } = require('../../dashboard/lib/feature-flags');

function settingsClient(value, { error = null, throws = false } = {}) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (throws) throw new Error('db down');
            return { data: value === undefined ? null : { value }, error };
          },
        }),
      }),
    }),
  };
}

describe('isFlagEnabledForUser', () => {
  test('the key is portal_self_observation', () => {
    expect(PORTAL_SELF_OBSERVATION_KEY).toBe('portal_self_observation');
  });

  test.each([
    ['true (everyone)', true, 'u1', true],
    ['"true" as a string', 'true', 'u1', true],
    ['a pilot list that includes her', ['u1', 'u2'], 'u1', true],
    ['a pilot list as a JSON string', '["u1"]', 'u1', true],
    ['a pilot list that does not include her', ['u2'], 'u1', false],
    ['false', false, 'u1', false],
    ['an empty list', [], 'u1', false],
    ['a number', 1, 'u1', false],
    ['an object', { users: ['u1'] }, 'u1', false],
  ])('%s', async (_label, value, userId, expected) => {
    expect(await isFlagEnabledForUser(settingsClient(value), PORTAL_SELF_OBSERVATION_KEY, userId)).toBe(expected);
  });

  test('no row is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsClient(undefined), PORTAL_SELF_OBSERVATION_KEY, 'u1')).toBe(false);
  });

  test('a failed read is OFF', async () => {
    expect(await isFlagEnabledForUser(settingsClient(true, { error: { message: 'x' } }), PORTAL_SELF_OBSERVATION_KEY, 'u1')).toBe(false);
    expect(await isFlagEnabledForUser(settingsClient(true, { throws: true }), PORTAL_SELF_OBSERVATION_KEY, 'u1')).toBe(false);
  });

  test('a pilot list never matches a missing user', async () => {
    expect(await isFlagEnabledForUser(settingsClient(['u1']), PORTAL_SELF_OBSERVATION_KEY, null)).toBe(false);
    expect(await isFlagEnabledForUser(settingsClient(true), PORTAL_SELF_OBSERVATION_KEY, null)).toBe(false);
  });
});

/* ── the routes ─────────────────────────────────────────────────────────── */

let flagValue;
let client;

function makeChain(table) {
  const chain = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => {
      if (table === 'app_settings') return { data: flagValue === undefined ? null : { value: flagValue }, error: null };
      return { data: { id: 'cs-1', user_id: 'teacher-1', status: 'transcribing', audio_url: null, conversation_state: {} }, error: null };
    },
  };
  chain.single = chain.maybeSingle;
  return chain;
}

function findRoute(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) return layer.route.stack.map((s) => s.handle);
  }
  throw new Error(`no ${method} ${path}`);
}

async function invoke(method, path, { userId = 'teacher-1', params = {}, body = {} } = {}) {
  const routes = require('../../dashboard/routes/portal.routes');
  const stack = findRoute(routes, method, path);
  const req = {
    session: userId ? { portalUserId: userId, id: 's' } : {},
    params, body, query: {}, method: method.toUpperCase(), path, ip: '127.0.0.1', headers: {}, get: () => undefined,
  };
  let statusCode = 200;
  let payload = null;
  const res = { status(c) { statusCode = c; return this; }, json(b) { payload = b; return this; } };
  for (const h of stack) {
    let next = false;
    // eslint-disable-next-line no-await-in-loop
    await h(req, res, () => { next = true; });
    if (!next) break;
  }
  return { statusCode, payload };
}

beforeEach(() => {
  jest.resetModules();
  flagValue = undefined;
  client = {
    presignUpload: jest.fn().mockResolvedValue({ httpStatus: 200, body: { status: 'ok' } }),
    startSession: jest.fn().mockResolvedValue({ httpStatus: 200, body: { status: 'ok' } }),
    submitReflection: jest.fn().mockResolvedValue({ httpStatus: 200, body: { status: 'ok' } }),
  };
  jest.doMock('../../dashboard/services/portal-coaching.client', () => client);
  jest.doMock('../../dashboard/config/supabase', () => ({ from: (t) => makeChain(t), rpc: jest.fn() }));
  jest.doMock('../../dashboard/services/r2.service', () => ({
    generatePresignedUrl: jest.fn(), generatePresignedUrls: jest.fn(), isValidR2Url: jest.fn(),
  }));
  jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
  jest.doMock('express-rate-limit', () => jest.fn(() => (_q, _s, n) => n()), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
});
afterEach(() => jest.resetModules());

const ROUTES = [
  ['post', '/coaching-upload/presign', {}],
  ['post', '/coaching-upload/start', {}],
  ['get', '/coaching-session/:id/progress', { id: 'cs-1' }],
  ['post', '/coaching-session/:id/reflection', { id: 'cs-1' }],
];

describe('the four routes are dark while the flag is off', () => {
  test.each(ROUTES)('%s %s → 404, bot never called', async (method, path, params) => {
    flagValue = undefined;
    const { statusCode } = await invoke(method, path, { params, body: { filename: 'a.m4a', key: 'k', answer: 'x' } });
    expect(statusCode).toBe(404);
    expect(client.presignUpload).not.toHaveBeenCalled();
    expect(client.startSession).not.toHaveBeenCalled();
    expect(client.submitReflection).not.toHaveBeenCalled();
  });

  test('a pilot list that leaves her out is off for her', async () => {
    flagValue = ['someone-else'];
    const { statusCode } = await invoke('post', '/coaching-upload/presign', { body: { filename: 'a.m4a' } });
    expect(statusCode).toBe(404);
  });

  test('on for her, the route works', async () => {
    flagValue = ['teacher-1'];
    const { statusCode } = await invoke('post', '/coaching-upload/presign', { body: { filename: 'a.m4a' } });
    expect(statusCode).toBe(200);
    expect(client.presignUpload).toHaveBeenCalled();
  });
});

describe('GET /config', () => {
  test('selfObservation is true only for a user the flag includes', async () => {
    flagValue = ['teacher-1'];
    expect((await invoke('get', '/config')).payload.features.selfObservation).toBe(true);
    expect((await invoke('get', '/config', { userId: 'teacher-2' })).payload.features.selfObservation).toBe(false);
  });

  test('logged out, it is false', async () => {
    flagValue = true;
    expect((await invoke('get', '/config', { userId: null })).payload.features.selfObservation).toBe(false);
  });

  test('the assessment generator field is still there, unchanged in shape', async () => {
    const { payload } = await invoke('get', '/config');
    expect(payload.features).toHaveProperty('assessmentGenerator');
    expect(payload.features).toHaveProperty('assessmentGeneratorMessage');
  });
});
