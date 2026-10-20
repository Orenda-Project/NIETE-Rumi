/**
 * bd-s1oo0.7 (L7) — /api/internal/child-test/* on the bot.
 *
 * Pinned: the internal key is required (and refused when unset), every service
 * status maps to one HTTP code, a failure is never a 2xx, and the mount lives in
 * internal-api.routes.js so the existing internal router serves it.
 * The real service runs underneath, with its network-boundary deps faked.
 */

const express = require('express');
const http = require('http');

const COACH = '11111111-1111-4111-8111-111111111111';

function fakeDeps(over = {}) {
  return {
    enabled: () => true,
    env: 'sandbox',
    now: () => new Date('2026-10-02T09:00:00Z'),
    log: () => {},
    logError: jest.fn(),
    defer: (fn) => fn(),
    itemBank: require('./fixtures/mini-bank.json'),
    supabase: {
      from: () => {
        const chain = {
          select: () => chain, eq: () => chain, gte: () => chain, order: () => chain, limit: () => chain,
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    },
    draw: { resolveVisitSchool: async () => ({ ok: false, reason: 'no_school' }) },
    store: { getSession: async () => ({ ok: true, session: null }) },
    r2: {},
    scoring: {},
    ...over,
  };
}

async function call(app, method, path, { key = 'k', body } = {}) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

function appWith(deps) {
  const { createChildTestAppRouter } = require('../../../bot/shared/routes/child-test-app.routes');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/child-test', createChildTestAppRouter({ deps }));
  return app;
}

const prevKey = process.env.INTERNAL_API_KEY;
beforeEach(() => { jest.resetModules(); process.env.INTERNAL_API_KEY = 'k'; });
afterAll(() => { if (prevKey === undefined) delete process.env.INTERNAL_API_KEY; else process.env.INTERNAL_API_KEY = prevKey; });

test('a call without the internal key is 401', async () => {
  const out = await call(appWith(fakeDeps()), 'POST', '/api/internal/child-test/visits', { key: null, body: { userId: COACH } });
  expect(out.status).toBe(401);
});

test('an unset INTERNAL_API_KEY refuses every caller', async () => {
  delete process.env.INTERNAL_API_KEY;
  const out = await call(appWith(fakeDeps()), 'POST', '/api/internal/child-test/visits', { key: 'undefined', body: { userId: COACH } });
  expect(out.status).toBe(401);
});

test('visits answers 200 with the service result', async () => {
  const out = await call(appWith(fakeDeps()), 'POST', '/api/internal/child-test/visits', { body: { userId: COACH } });
  expect(out.status).toBe(200);
  expect(out.body).toEqual({ success: true, status: 'ok', visits: [] });
});

test('the feature off is a 404, not an empty answer', async () => {
  const out = await call(appWith(fakeDeps({ enabled: () => false })), 'POST', '/api/internal/child-test/visits', { body: { userId: COACH } });
  expect(out.status).toBe(404);
  expect(out.body).toMatchObject({ success: false, status: 'disabled' });
});

test('not_found (another coach\'s session) is 404 and invalid is 400', async () => {
  const app = appWith(fakeDeps());
  const nf = await call(app, 'POST', '/api/internal/child-test/card', { body: { userId: COACH, sessionId: 's', block: 'urdu' } });
  expect(nf.status).toBe(404);
  const bad = await call(app, 'POST', '/api/internal/child-test/card', { body: { userId: COACH, sessionId: 's', block: 'x' } });
  expect(bad.status).toBe(400);
  expect(bad.body).toMatchObject({ success: false, reason: 'bad_block' });
});

test('a service error is a 500 with success false', async () => {
  const deps = fakeDeps({ store: { getSession: async () => { throw new Error('db down'); } } });
  const out = await call(appWith(deps), 'POST', '/api/internal/child-test/session', { body: { userId: COACH, sessionId: 's' } });
  expect(out.status).toBe(500);
  expect(out.body.success).toBe(false);
});

test('the media route forwards photoDeclined to the service', async () => {
  const seen = [];
  const deps = fakeDeps({ store: { getSession: async (id) => { seen.push(id); return { ok: true, session: null }; } } });
  const out = await call(appWith(deps), 'POST', '/api/internal/child-test/media', { body: { userId: COACH, sessionId: 's', block: 'urdu', photoDeclined: true } });
  // reaching the service's own maths-only rule proves the flag arrived
  expect(out.status).toBe(400);
  expect(out.body.reason).toBe('no_photo_for_block');
});

test('every route is POST and named', () => {
  const { createChildTestAppRouter } = require('../../../bot/shared/routes/child-test-app.routes');
  const r = createChildTestAppRouter({ deps: fakeDeps() });
  const paths = r.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  expect(paths.sort()).toEqual([
    'post /card', 'post /check', 'post /list', 'post /media', 'post /outcome', 'post /presign',
    'post /sa/batch', 'post /sa/battery', 'post /sa/link-mint', 'post /sa/list', 'post /sa/outcome', 'post /sa/presign', 'post /sa/register',
    'post /sa/schools', 'post /sa/status', 'post /sa/via-link', 'post /session', 'post /visits',
  ]);
});

test('internal-api.routes.js mounts the child-test router', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require.resolve('../../../bot/shared/routes/internal-api.routes.js'), 'utf8');
  expect(src).toMatch(/router\.use\('\/child-test',\s*require\('\.\/child-test-app\.routes'\)\.router\)/);
});

describe('the Learning assessment (sa/*) routes', () => {
  const SCHOOL = '44444444-4444-4444-8444-444444444444';
  const linked = (rows) => ({
    from: (table) => {
      const chain = {
        select: () => chain, eq: () => chain, gte: () => chain, order: () => chain, limit: () => chain, in: () => chain,
        then: (resolve) => resolve({ data: table === 'leader_schools' ? rows : [], error: null }),
      };
      return chain;
    },
  });

  test('sa/schools answers from the SA service', async () => {
    const deps = fakeDeps({ supabase: linked([{ school_id: SCHOOL, school_name: 'Zeta School' }]) });
    const out = await call(appWith(deps), 'POST', '/api/internal/child-test/sa/schools', { body: { userId: COACH } });
    expect(out.status).toBe(200);
    expect(out.body.schools).toEqual([expect.objectContaining({ schoolId: SCHOOL, visitToday: false })]);
  });

  test('sa/list forwards only its fields; a school that is not theirs is 404', async () => {
    const todaysList = jest.fn();
    const deps = fakeDeps({ supabase: linked([]), draw: { todaysList, resolveVisitSchool: async () => ({ ok: false }) } });
    const out = await call(appWith(deps), 'POST', '/api/internal/child-test/sa/list', { body: { userId: COACH, schoolId: SCHOOL, drawId: 'x' } });
    expect(out.status).toBe(404);
    expect(out.body.success).toBe(false);
    expect(todaysList).not.toHaveBeenCalled();
  });

  test('sa/outcome forwards the client id and the block', async () => {
    const out = await call(appWith(fakeDeps()), 'POST', '/api/internal/child-test/sa/outcome', { body: { userId: COACH, schoolId: SCHOOL, drawId: 'd', outcome: 'present', clientSessionId: 'x' } });
    expect(out.status).toBe(400);
    expect(out.body.reason).toBe('bad_client_id');
  });

  test('sa/outcome with a bad outcome is 400', async () => {
    const out = await call(appWith(fakeDeps()), 'POST', '/api/internal/child-test/sa/outcome', { body: { userId: COACH, schoolId: SCHOOL, drawId: 'd', outcome: 'gone' } });
    expect(out.status).toBe(400);
    expect(out.body.reason).toBe('bad_outcome');
  });
});
