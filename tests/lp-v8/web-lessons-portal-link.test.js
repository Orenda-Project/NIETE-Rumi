'use strict';
/**
 * Lesson plans on the web — the portal end of the link.
 *
 * One /t/<token> route serves every area. The token says which: a lesson-plans
 * link starts a session scoped to lesson plans and lands on /portal/curriculum;
 * a training link (including one sent before areas existed, with no area in it)
 * still lands on training.
 *
 * The scope guard keeps each area to its own API: a lesson-plans session reaches
 * the catalogue (/curriculum/*), the grade 6-12 renders (/lp612/*) and her own
 * lesson plans (/lesson-plans), plus the reads the portal's frame needs; it
 * cannot reach training, coaching or anything else, and a training session
 * cannot reach lesson plans.
 *
 * Real Express over HTTP; the session store, Supabase and the telemetry sink are
 * the stand-ins; the token is signed by the bot's real signer.
 */
const http = require('http');
const express = require('express');

jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));
const { logEvent } = require('../../dashboard/services/telemetry.service');

const TEACHER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Ayesha' };
const routes = () => require('../../dashboard/routes/portal-link.routes');
const token = () => require('../../bot/shared/services/portal-link-token');

function start(app) {
  return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
}
function request(srv, method, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });
}
function sessionStandIn(initial, issued) {
  return (req, _res, next) => {
    const make = (data) => Object.assign({
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

async function linkApp() {
  const issued = [];
  const app = express();
  app.use(sessionStandIn({}, issued));
  app.use(routes().createPortalLinkRouter({ findUser: async (id) => (id === TEACHER.id ? TEACHER : null) }));
  const srv = await start(app);
  servers.push(srv);
  return { srv, issued };
}

describe('GET /t/<token> lands each area on its own page', () => {
  test('a lesson-plans link: a lesson-plans session, on /portal/curriculum', async () => {
    const { srv, issued } = await linkApp();

    const res = await request(srv, 'GET', `/t/${token().signPortalLink(TEACHER.id, 'lessons')}`);

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/curriculum');
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'lessons' });
    expect(logEvent).toHaveBeenCalledWith('web_link.open', expect.objectContaining({ outcome: 'ok', area: 'lessons', userId: TEACHER.id }));
  });

  test('a training link still lands on training', async () => {
    const { srv, issued } = await linkApp();

    const res = await request(srv, 'GET', `/t/${token().signPortalLink(TEACHER.id, 'training')}`);

    expect(res.headers.location).toBe('/portal/training');
    expect(issued[0]).toMatchObject({ portalScope: 'training' });
  });

  test('a link for an area the portal does not define opens nothing', async () => {
    const { srv, issued } = await linkApp();
    const crypto = require('crypto');
    // Signed with the real key, so only the area makes it invalid.
    const key = crypto.createHmac('sha256', 'test-internal-key').update('web-training-token-v1').digest();
    const body = Buffer.from(JSON.stringify({ k: 't', u: TEACHER.id, a: 'coaching', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    const sig = crypto.createHmac('sha256', key).update(body).digest('base64url').slice(0, 22);

    const res = await request(srv, 'GET', `/t/${body}.${sig}`);

    expect(res.status).toBe(200);
    expect(issued).toHaveLength(0);
    expect(res.body).toContain('This link has expired');
  });
});

describe('each area reaches its own API and nothing else', () => {
  async function apiApp(session) {
    const app = express();
    app.use(sessionStandIn(session, []));
    app.use('/api/portal', routes().portalLinkScope, (req, res) => res.json({ reached: req.path }));
    const srv = await start(app);
    servers.push(srv);
    return srv;
  }
  const LESSONS = { portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'lessons' };
  const TRAINING = { portalUserId: TEACHER.id, isPortalAuth: true, portalScope: 'training' };

  test.each([
    ['GET', '/curriculum/grades'],
    ['GET', '/curriculum/lps'],
    ['GET', '/curriculum/lp/l-1/file'],
    ['GET', '/lp612/lessons'],
    ['POST', '/lp612/request'],
    ['GET', '/lp612/file/r-1'],
    ['GET', '/lesson-plans'],
    ['GET', '/lesson-plans/recent'],
    ['GET', '/dashboard'],
    ['GET', '/config'],
  ])('a lesson-plans session reaches %s %s', async (method, path) => {
    const srv = await apiApp(LESSONS);
    expect((await request(srv, method, `/api/portal${path}`)).status).toBe(200);
  });

  test.each([
    ['GET', '/training/levels'],
    ['GET', '/coaching-sessions'],
    ['GET', '/attendance/today'],
    ['GET', '/curriculumx'],
    ['DELETE', '/lesson-plans/1'],
  ])('a lesson-plans session is refused %s %s', async (method, path) => {
    const srv = await apiApp(LESSONS);
    const res = await request(srv, method, `/api/portal${path}`);
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'link_area_only' });
  });

  test.each(['/curriculum/grades', '/lp612/lessons', '/lesson-plans'])('a training session is refused %s', async (path) => {
    const srv = await apiApp(TRAINING);
    expect((await request(srv, 'GET', `/api/portal${path}`)).status).toBe(403);
  });

  test('a session with a scope nobody defined reaches nothing', async () => {
    const srv = await apiApp({ portalUserId: TEACHER.id, portalScope: 'coaching' });
    expect((await request(srv, 'GET', '/api/portal/dashboard')).status).toBe(403);
  });
});
