'use strict';
/**
 * Coach reports in the app — the "Open my report" button on the ONE WhatsApp message about a report the coach did not
 * open. One more area on the portal's /t/<token> door, 'coachreport':
 *   - the token names ONE report: `debrief:<session uuid>` or `week:<YYYY-MM-DD>`; anything else is no token;
 *   - /t/<token> lands on that report's page in the coach app;
 *   - the session it starts reads her reports and says she opened (or closed) them, and nothing else: not her
 *     observations, schedule, teachers, schools, nor any teacher area.
 * The bot's real signer; the portal's real router and scope guard.
 */
const http = require('http');
const express = require('express');

jest.mock('../../dashboard/services/telemetry.service', () => ({ logEvent: jest.fn(), flush: jest.fn(), isEnabled: () => true }));

const COACH = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Coach' };
const SID = '11111111-1111-4111-8111-111111111111';
const routes = () => require('../../dashboard/routes/portal-link.routes');
const tokens = () => require('../../bot/shared/services/portal-link-token');

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
const get = (srv, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  r.on('error', reject);
  r.end();
});

const ENV = { ...process.env };
let servers = [];
beforeEach(() => { process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' }; delete process.env.WEB_TRAINING_TOKEN_SECRET; });
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

test('the token names one report, and only a well-formed one', () => {
  const { signPortalLink, verifyPortalLink } = tokens();
  expect(verifyPortalLink(signPortalLink(COACH.id, 'coachreport', { i: `debrief:${SID}` }))).toMatchObject({ u: COACH.id, area: 'coachreport', i: `debrief:${SID}` });
  expect(verifyPortalLink(signPortalLink(COACH.id, 'coachreport', { i: 'week:2026-11-02' }))).toMatchObject({ i: 'week:2026-11-02' });
  for (const extra of [undefined, {}, { i: `paper:${SID}` }, { i: 'debrief:nope' }, { i: 'week:2-11-2026' }, { i: `debrief:${SID}/x` }]) {
    expect(signPortalLink(COACH.id, 'coachreport', extra)).toBeNull();
  }
  // the 'ready' area's own items are not a coach report, and the other way round
  expect(signPortalLink(COACH.id, 'ready', { i: `debrief:${SID}` })).toBeNull();
});

describe('GET /t/<token>', () => {
  async function linkApp() {
    const issued = [];
    const app = express();
    app.use((req, _res, next) => {
      const make = (data) => Object.assign({ regenerate(cb) { req.session = make({}); issued.push(req.session); cb(null); }, save(cb) { if (cb) cb(null); } }, data);
      req.session = make({});
      next();
    });
    app.use(routes().createPortalLinkRouter({ findUser: async (id) => (id === COACH.id ? COACH : null) }));
    const srv = await start(app);
    servers.push(srv);
    return { srv, issued };
  }

  test('a debrief report: a coachreport-scoped session, on that report\'s page', async () => {
    const { srv, issued } = await linkApp();
    const res = await get(srv, `/t/${tokens().signPortalLink(COACH.id, 'coachreport', { i: `debrief:${SID}` })}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/portal/coach/report/${SID}`);
    expect(issued[0]).toMatchObject({ portalUserId: COACH.id, portalScope: 'coachreport' });
  });

  test('a weekly report: on that week\'s page', async () => {
    const { srv } = await linkApp();
    const res = await get(srv, `/t/${tokens().signPortalLink(COACH.id, 'coachreport', { i: 'week:2026-11-02' })}`);
    expect(res.headers.location).toBe('/portal/coach/week/2026-11-02');
  });
});

describe('the coachreport session reaches her reports, and nothing else', () => {
  const allowed = (method, path) => {
    let passed = false;
    let status = null;
    const req = { method, path, session: { portalScope: 'coachreport' } };
    const res = { status(c) { status = c; return this; }, json() { return this; } };
    routes().portalLinkScope(req, res, () => { passed = true; });
    return passed && status === null;
  };

  test('her report, its opened / seen, her week, the Home card list, the frame', () => {
    expect(allowed('GET', `/coach/report/${SID}`)).toBe(true);
    expect(allowed('POST', `/coach/report/${SID}/opened`)).toBe(true);
    expect(allowed('POST', `/coach/report/${SID}/seen`)).toBe(true);
    expect(allowed('GET', '/coach/week/2026-11-02')).toBe(true);
    expect(allowed('POST', '/coach/week/2026-11-02/opened')).toBe(true);
    expect(allowed('GET', '/coach/reports/ready')).toBe(true);
    expect(allowed('GET', '/config')).toBe(true);
  });

  test('not her observations, schedule, people, Home, nor a teacher area; no writes beyond opened/seen', () => {
    for (const [m, p] of [['GET', '/coach/home'], ['GET', '/coach/people'], ['GET', '/coach/schedule'], ['GET', `/leader/observe/${SID}`],
      ['GET', '/training/modules'], ['GET', '/assessment/requests'], ['POST', `/coach/report/${SID}`], ['POST', `/coach/report/${SID}/delete`],
      ['GET', '/coach/school/901/card']]) {
      expect(allowed(m, p)).toBe(false);
    }
  });
});
