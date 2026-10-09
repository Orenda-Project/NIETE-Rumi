'use strict';
/**
 * bd-fmf24g.15 — the "Open in app" button on the WhatsApp fallback: a signed link that opens THIS item for THIS
 * teacher. One more area on the portal's existing /t/<token> door ("ready"):
 *
 *   - the token names the item — `paper:<request uuid>` or `lesson:<segment id>:<en|ur>` — and nothing else:
 *     a "ready" token without a well-formed item is refused when it is signed AND when it is read;
 *   - /t/<token> starts a session scoped to the "ready" area and lands on the item's own page: a paper on its
 *     request page (where Download and Answer key are), a lesson plan on the page that opens it by key;
 *   - the scope guard lets that session read what those pages read and report what she did with the item, and
 *     NOTHING else: no training, no coaching, no starting a new paper, and no other area's session reaches it;
 *   - the areas that already existed are untouched (training links carry no area, lessons land where they did).
 * Real Express over HTTP; the session store and telemetry are stand-ins; the token is signed by the bot's real signer.
 */
const http = require('http');
const express = require('express');

jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));

const TEACHER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Ayesha' };
const REQ = '11111111-1111-4111-8111-111111111111';
const routes = () => require('../../dashboard/routes/portal-link.routes');
const tokens = () => require('../../bot/shared/services/portal-link-token');

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const request = (srv, method, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject);
  r.end();
});
const sessionStandIn = (initial, issued) => (req, _res, next) => {
  const make = (data) => Object.assign({
    regenerate(cb) { req.session = make({}); issued.push(req.session); cb(null); },
    save(cb) { if (cb) cb(null); },
  }, data);
  req.session = make({ ...initial });
  next();
};

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

describe('the token names the item', () => {
  it('a paper and a lesson plan round-trip, with the teacher, the area and the item', () => {
    const { signPortalLink, verifyPortalLink } = tokens();
    expect(verifyPortalLink(signPortalLink(TEACHER.id, 'ready', { i: `paper:${REQ}` }))).toMatchObject({ u: TEACHER.id, area: 'ready', i: `paper:${REQ}` });
    expect(verifyPortalLink(signPortalLink(TEACHER.id, 'ready', { i: 'lesson:phy9.c02.p010:ur' }))).toMatchObject({ area: 'ready', i: 'lesson:phy9.c02.p010:ur' });
  });

  it('is signed only for a well-formed item: a "ready" link with none, or a stranger\'s shape, is null', () => {
    const { signPortalLink } = tokens();
    for (const extra of [undefined, {}, { i: '' }, { i: 'paper:nope' }, { i: `thing:${REQ}` }, { i: `paper:${REQ}/../x` }, { i: 'lesson:x:fr' }, { i: 'lesson::en' }, { i: 7 }]) {
      expect(signPortalLink(TEACHER.id, 'ready', extra)).toBeNull();
    }
  });

  it('a tampered or forged item is not read', () => {
    const { signPortalLink, verifyPortalLink } = tokens();
    const good = signPortalLink(TEACHER.id, 'ready', { i: `paper:${REQ}` });
    const [body, sig] = good.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), i: 'paper:22222222-2222-4222-8222-222222222222' })).toString('base64url');
    expect(verifyPortalLink(`${forged}.${sig}`)).toBeNull();
  });

  it('the extra item is only for the "ready" area: other areas ignore it, so old links are exactly as they were', () => {
    const { signPortalLink, verifyPortalLink } = tokens();
    expect(verifyPortalLink(signPortalLink(TEACHER.id, 'training'))).not.toHaveProperty('i');
    expect(verifyPortalLink(signPortalLink(TEACHER.id, 'lessons', { i: `paper:${REQ}` }))).not.toHaveProperty('i');
    expect(JSON.parse(Buffer.from(signPortalLink(TEACHER.id, 'training').split('.')[0], 'base64url').toString())).not.toHaveProperty('a');
  });

  it('lasts 24 hours', () => {
    const { signPortalLink, verifyPortalLink } = tokens();
    const p = verifyPortalLink(signPortalLink(TEACHER.id, 'ready', { i: `paper:${REQ}` }));
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(24 * 3600 - 10);
    expect(p.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(24 * 3600);
  });
});

describe('GET /t/<token> lands on the item', () => {
  async function linkApp() {
    const issued = [];
    const app = express();
    app.use(sessionStandIn({}, issued));
    app.use(routes().createPortalLinkRouter({ findUser: async (id) => (id === TEACHER.id ? TEACHER : null) }));
    const srv = await start(app);
    servers.push(srv);
    return { srv, issued };
  }

  it('a paper: a "ready"-scoped session, on that paper\'s request page', async () => {
    const { srv, issued } = await linkApp();
    const res = await request(srv, 'GET', `/t/${tokens().signPortalLink(TEACHER.id, 'ready', { i: `paper:${REQ}` })}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/portal/teacher/assessment/request/${REQ}`);
    expect(issued[0]).toMatchObject({ portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'ready' });
  });

  it('a lesson plan: on the page that opens it by key, in the language it was made in', async () => {
    const { srv } = await linkApp();
    const res = await request(srv, 'GET', `/t/${tokens().signPortalLink(TEACHER.id, 'ready', { i: 'lesson:phy9.c02.p010:ur' })}`);
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.location, 'https://x');
    expect(loc.pathname).toBe('/portal/teacher/lessons/open');
    expect(Object.fromEntries(loc.searchParams)).toEqual({ plan: 'g612:phy9.c02.p010', lang: 'ur' });
  });

  it('the existing areas land exactly where they did', async () => {
    const { srv } = await linkApp();
    expect((await request(srv, 'GET', `/t/${tokens().signPortalLink(TEACHER.id, 'lessons')}`)).headers.location).toBe('/portal/curriculum');
    expect((await request(srv, 'GET', `/t/${tokens().signPortalLink(TEACHER.id, 'training')}`)).headers.location).toBe('/portal/training');
  });

  it('a teacher who no longer exists, or an expired link, opens nothing', async () => {
    const { srv, issued } = await linkApp();
    const res = await request(srv, 'GET', `/t/${tokens().signPortalLink('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ready', { i: `paper:${REQ}` })}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('This link has expired');
    expect(issued).toHaveLength(0);
  });
});

describe('the "ready" session reaches what the item pages read, and nothing else', () => {
  async function apiApp(session) {
    const app = express();
    app.use(sessionStandIn(session, []));
    app.use('/api/portal', routes().portalLinkScope, (req, res) => res.json({ reached: req.path }));
    const srv = await start(app);
    servers.push(srv);
    return srv;
  }
  const READY = { portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'ready' };

  test.each([
    ['GET', '/me/notices'],
    ['POST', '/me/notices/paper%3Aabc/seen'],
    ['POST', '/me/notices/lesson%3Aabc/opened'],
    ['GET', '/assessment/status/r-1'],
    ['GET', '/assessment/paper/p-1/download'],
    ['GET', '/assessment/papers'],
    ['GET', '/lp612/status/r-1'],
    ['GET', '/lp612/file/r-1'],
    ['POST', '/lp612/request'],
    ['GET', '/lesson-plans/recent'],
    ['GET', '/me/grade-subjects'],
    ['GET', '/dashboard'],
    ['GET', '/config'],
    ['GET', '/me/language'],
  ])('reaches %s %s', async (method, path) => {
    const srv = await apiApp(READY);
    expect((await request(srv, method, `/api/portal${path}`)).status).toBe(200);
  });

  test.each([
    ['GET', '/training/levels'],
    ['GET', '/coaching-sessions'],
    ['GET', '/attendance/today'],
    ['POST', '/assessment/generate'],
    ['POST', '/assessment/edit/p-1/save'],
    ['DELETE', '/lesson-plans/1'],
    ['POST', '/me/notices'],
    ['POST', '/me/notices/paper%3Aabc/deleted'],
    ['GET', '/me/noticesx'],
    ['POST', '/lp612/requestx'],
  ])('is refused %s %s', async (method, path) => {
    const srv = await apiApp(READY);
    const res = await request(srv, method, `/api/portal${path}`);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'link_area_only' });
  });

  test.each(['training', 'lessons'])('a %s session does not reach her notices', async (scope) => {
    const srv = await apiApp({ portalUserId: TEACHER.id, portalScope: scope });
    expect((await request(srv, 'GET', '/api/portal/me/notices')).status).toBe(403);
    expect((await request(srv, 'POST', '/api/portal/me/notices/paper%3Aabc/opened')).status).toBe(403);
  });
});

describe('the portal app knows the area', () => {
  it('linkSession.ts lists "ready" with the teacher app as its home, so the app shows its pages instead of the link page', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../portal/src/portal/lib/linkSession.ts'), 'utf8');
    expect(src).toMatch(/ready:\s*\{\s*home:\s*'\/portal\/teacher'\s*\}/);
  });
});
