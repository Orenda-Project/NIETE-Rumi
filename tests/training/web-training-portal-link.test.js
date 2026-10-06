'use strict';
/**
 * Training on the web — the portal end of the link on the training template.
 *
 *   GET /t/<token>   a genuine, unexpired link for a teacher who exists starts a
 *                    NEW portal session for her (regenerated, as /login does),
 *                    scoped to training, and sends her to /portal/training.
 *                    Anything else starts no session and shows the en/ur
 *                    "this link has expired" page.
 *
 *   portalLinkScope, in front of every /api/portal router: a session that came
 *   from a link reaches training (and the few calls the portal's frame needs) and
 *   nothing else — a forwarded link must not open her coaching recordings,
 *   lesson plans or school. A password session is untouched.
 *
 *   GET /api/portal/dashboard tells the portal app which kind of session it is.
 *
 * The routes run in a real Express app over HTTP. The session store and
 * Supabase are the stand-ins; the token is signed by the bot's real signer.
 */
const http = require('http');
const express = require('express');

// The portal's own telemetry sink (the bot's loggers cannot load in the portal process).
jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));
const { logEvent } = require('../../dashboard/services/telemetry.service');
const Token = require('../../bot/shared/services/portal-link-token');

const TEACHER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Ayesha' };
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Required inside the tests so the file runs before the route module exists.
const linkRoutes = () => require('../../dashboard/routes/portal-link.routes');

function start(app) {
  return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
}

function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** express-session's surface the routes use: a session object with regenerate + save. */
function sessionStandIn(initial, issued) {
  return (req, _res, next) => {
    const make = (data) => Object.assign({
      id: `s${issued.length}`,
      regenerate(cb) { req.session = make({}); issued.push(req.session); cb(null); },
      save(cb) { if (cb) cb(null); },
    }, data);
    req.session = make({ ...initial });
    next();
  };
}

const ENV = { ...process.env };
let servers = [];
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});
afterAll(() => { process.env = ENV; });

async function linkApp({ findUser = async (id) => (id === TEACHER.id ? TEACHER : null), session = {} } = {}) {
  const issued = [];
  const app = express();
  app.use(sessionStandIn(session, issued));
  app.use(linkRoutes().createPortalLinkRouter({ findUser }));
  app.use((_req, res) => res.status(418).send('fell through'));
  const srv = await start(app);
  servers.push(srv);
  return { srv, issued };
}

describe('GET /t/<token>', () => {
  test('a genuine link starts a training-only session for that teacher and opens training', async () => {
    const { srv, issued } = await linkApp({ session: { portalUserId: OTHER, isPortalAuth: true } });

    const res = await get(srv, `/t/${Token.signPortalLink(TEACHER.id)}`, {
      'user-agent': 'Mozilla/5.0 (Linux; Android 11; SM-A105F; wv) WhatsApp/2.24',
      'x-requested-with': 'com.whatsapp',
    });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/training');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    // A NEW session (never the one the browser arrived with), hers, and scoped.
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ portalUserId: TEACHER.id, isPortalAuth: true, portalUserName: 'Ayesha', portalScope: 'training' });
    // Which browser opened it is what tells us the template opened WhatsApp's own.
    expect(logEvent).toHaveBeenCalledWith('web_link.open', expect.objectContaining({
      outcome: 'ok', userId: TEACHER.id, xrw: 'com.whatsapp', iab: 1,
    }));
  });

  test.each([
    ['a forged link', () => `${Token.signPortalLink(TEACHER.id).split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAA`, 'invalid'],
    ['an expired link', () => {
      const now = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now - 25 * 60 * 60 * 1000);
      const t = Token.signPortalLink(TEACHER.id);
      spy.mockRestore();
      return t;
    }, 'invalid'],
    ['a teacher who no longer exists', () => Token.signPortalLink(OTHER), 'unknown_user'],
    ['the portal app sending her here after her session ran out', () => 'expired', 'invalid'],
  ])('%s: no session, and the en/ur expired page', async (_label, make, outcome) => {
    const { srv, issued } = await linkApp();

    const res = await get(srv, `/t/${make()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(issued).toHaveLength(0);
    expect(res.body).toContain('This link has expired');
    expect(res.body).toContain('یہ لنک ختم ہو چکا ہے');
    expect(res.body).toContain('lang="ur"');
    expect(logEvent).toHaveBeenCalledWith('web_link.open', expect.objectContaining({ outcome }));
  });

  test('a lookup that throws is the expired page, not a crash', async () => {
    const { srv, issued } = await linkApp({ findUser: async () => { throw new Error('db down'); } });

    const res = await get(srv, `/t/${Token.signPortalLink(TEACHER.id)}`);

    expect(res.status).toBe(200);
    expect(issued).toHaveLength(0);
    expect(res.body).toContain('This link has expired');
  });
});

describe('a training-only session reaches training and nothing else', () => {
  async function apiApp(session) {
    const app = express();
    app.use(sessionStandIn(session, []));
    app.use('/api/portal', linkRoutes().portalLinkScope, (req, res) => res.json({ reached: req.path }));
    const srv = await start(app);
    servers.push(srv);
    return srv;
  }
  const LINK = { portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'training' };

  test.each([
    '/training/levels',
    '/training/module/m-1/quiz-attempts',
    '/training/certificates/ABC123/download',
    '/dashboard',
    '/auth/verify',
    '/config',
    '/me/language',
  ])('reaches %s', async (path) => {
    const srv = await apiApp(LINK);
    const res = await get(srv, `/api/portal${path}`);
    expect(res.status).toBe(200);
  });

  test.each([
    '/coaching-sessions',
    '/lesson-plans',
    '/curriculum/grades',
    '/attendance/today',
    '/leader/child-test/visits',
    '/hcp/sessions',
    '/account',
    '/trainingx',
  ])('is refused %s', async (path) => {
    const srv = await apiApp(LINK);
    const res = await get(srv, `/api/portal${path}`);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ success: false, error: 'link_area_only' });
  });

  test('a password session is untouched', async () => {
    const srv = await apiApp({ portalUserId: TEACHER.id, isPortalAuth: true });
    expect((await get(srv, '/api/portal/coaching-sessions')).status).toBe(200);
  });

  test('no session at all is left to the routes\' own guards', async () => {
    const srv = await apiApp({});
    expect((await get(srv, '/api/portal/coaching-sessions')).status).toBe(200);
  });
});

describe('GET /api/portal/dashboard says which kind of session it is', () => {
  function chain(result) {
    const self = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res, rej) => Promise.resolve(result).then(res, rej);
        if (prop === 'single' || prop === 'maybeSingle') {
          return () => Promise.resolve({ data: Array.isArray(result.data) ? result.data[0] || null : result.data, error: null });
        }
        return () => self;
      },
    });
    return self;
  }

  async function dashboard(session) {
    jest.resetModules();
    jest.doMock('../../dashboard/config/supabase', () => ({
      from: (t) => chain(t === 'users'
        ? { data: [{ id: TEACHER.id, name: 'Ayesha', role: 'teacher' }], error: null }
        : { data: [], error: null, count: 0 }),
      rpc: jest.fn(),
    }));
    jest.doMock('bcryptjs', () => ({ hash: jest.fn(), compare: jest.fn(), genSalt: jest.fn() }), { virtual: true });
    jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client: jest.fn(), GetObjectCommand: jest.fn() }), { virtual: true });
    const routes = require('../../dashboard/routes/portal.routes');
    const layer = routes.stack.find((l) => l.route && l.route.path === '/dashboard' && l.route.methods.get);
    const req = { session, params: {}, query: {}, body: {}, method: 'GET', path: '/dashboard', headers: {}, get: () => undefined };
    let payload = null;
    const res = { status() { return this; }, json(b) { payload = b; return this; } };
    for (const h of layer.route.stack.map((s) => s.handle)) {
      let next = false;
      // eslint-disable-next-line no-await-in-loop
      await h(req, res, () => { next = true; });
      if (!next) break;
    }
    return payload;
  }

  test('a link session is "training"', async () => {
    const payload = await dashboard({ portalUserId: TEACHER.id, portalScope: 'training' });
    expect(payload.user).toMatchObject({ firstName: 'Ayesha', sessionScope: 'training' });
  });

  test('a password session has no scope', async () => {
    const payload = await dashboard({ portalUserId: TEACHER.id });
    expect(payload.user.sessionScope).toBeNull();
  });
});
