'use strict';
/**
 * Coach reports in the app, on staging (bd-enec2e.6): the "Open my report" / "Open my week" button on the ONE WhatsApp
 * message about a report the coach did not open goes through staging's one-tap app door, /go/<token>
 * (app-login-link.js), with a landing target of its own (bot/shared/services/coach-report-target.js):
 *
 *   coach_report:<coaching session uuid>  → /portal/coach/report/<uuid>   her debrief report
 *   coach_week:<YYYY-MM-DD>               → /portal/coach/week/<date>     her weekly report (its Monday)
 *
 * Sandbox opens these through its /t/ door (portal-link-token.js), which staging does not have. Like the School card's
 * targets, both are anchored (no path, query or fragment rides along), `linkable` learns them so they sign and verify,
 * and /go asks the COACH-app question first: off the coach app, today's dashboard. Whether the report is hers is the
 * page's own check (GET /coach/report/:id answers 403 to anyone else). Real Express over HTTP.
 */
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const SID = '11111111-1111-4111-8111-111111111111';
const SUPA = 'https://abcdefgh.supabase.co';
let sessions; let emitted;
beforeEach(() => {
  jest.resetModules();
  sessions = []; emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: SUPA };
});
afterAll(() => { process.env = ENV; });

const link = () => require('../../bot/shared/services/app-login-link');
const target = () => require('../../bot/shared/services/coach-report-target');

/** A token for ANY feature name under this environment's real key (what /go would see if the bot minted it). */
function forge(f, u = USER) {
  const host = new URL(SUPA).host;
  const k = crypto.createHmac('sha256', process.env.INTERNAL_API_KEY).update(`app-login-link-v2\u0000${host}`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const plain = Buffer.from(JSON.stringify({ k: 'app', u, f, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
}

describe('the target', () => {
  test.each([
    [`coach_report:${SID}`, `/portal/coach/report/${SID}`],
    ['coach_week:2026-11-02', '/portal/coach/week/2026-11-02'],
  ])('%s → %s', (f, page) => {
    expect(target().isCoachReportTarget(f)).toBe(true);
    expect(target().coachReportPathFor(f)).toBe(page);
  });

  test.each([
    'coach_report:', 'coach_report', `coach_report:${SID}/x`, `coach_report:${SID}?x=1`, `coach_report:${SID}#x`,
    `coach_report:${SID}\n`, 'coach_report:not-a-uuid', `COACH_REPORT:${SID}`, 'coach_report:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    `xcoach_report:${SID}`, 'coach_week:2026-11-2', 'coach_week:2026-11-02/x', 'coach_week:', 'coach_week:20261102',
    `coach_week:${SID}`, '', null, undefined, 1, {},
  ])('%p is not a target: no page', (f) => {
    expect(target().isCoachReportTarget(f)).toBe(false);
    expect(target().coachReportPathFor(f)).toBeNull();
  });

  test('the builders make a target from a safe id or Monday and refuse anything else', () => {
    expect(target().coachReportTarget(SID)).toBe(`coach_report:${SID}`);
    expect(target().coachWeekTarget('2026-11-02')).toBe('coach_week:2026-11-02');
    for (const bad of ['', null, undefined, 'x', `${SID}/x`, `${SID} `]) expect(target().coachReportTarget(bad)).toBeNull();
    for (const bad of ['', null, '2026-11-2', '2026-11-02/x', SID]) expect(target().coachWeekTarget(bad)).toBeNull();
  });
});

describe('the token', () => {
  test.each([`coach_report:${SID}`, 'coach_week:2026-11-02'])('%s signs and verifies', (f) => {
    const t = link().signAppLink(USER, f);
    expect(t).toBeTruthy();
    expect(link().verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f }));
  });

  test('the forge helper matches the real key (positive control for the refusals below)', () => {
    expect(link().verifyAppLink(forge(`coach_report:${SID}`))).toEqual(expect.objectContaining({ f: `coach_report:${SID}` }));
  });

  test.each([`coach_report:${SID}/x`, 'coach_report:x', 'coach_week:2026-11-02?x=1', 'coach_week:x'])('%s cannot be signed or verified', (f) => {
    expect(link().signAppLink(USER, f)).toBeNull();
    expect(link().verifyAppLink(forge(f))).toBeNull();
  });

  test('the existing landings are unchanged', () => {
    expect(link().COACH_LANDINGS).toEqual({
      coach_menu: '/portal/coach', coach_observe: '/portal/coach/observe', coach_training: '/portal/coach/training',
    });
  });
});

describe('GET /go/:token', () => {
  let servers = [];
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function app({ teacherV2 = false, coachApp = false, calls = {} } = {}) {
    const a = express();
    a.use((req, _res, next) => {
      const s = { regenerate(cb) { Object.keys(s).filter((k) => typeof s[k] !== 'function').forEach((k) => delete s[k]); cb(); }, save(cb) { cb(); } };
      req.session = s; sessions.push(s); next();
    });
    a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
      findUser: async (id) => (id === USER ? { id: USER, name: 'Nadia' } : null),
      isTeacherV2: async () => { calls.teacher = (calls.teacher || 0) + 1; return teacherV2; },
      isCoachApp: async () => { calls.coach = (calls.coach || 0) + 1; if (coachApp instanceof Error) throw coachApp; return coachApp; },
    }));
    a.use((_q, res) => res.status(418).send('fell through'));
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const get = (srv, path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
  const tok = (f) => link().signAppLink(USER, f);

  test.each([[`coach_report:${SID}`, `/portal/coach/report/${SID}`], ['coach_week:2026-11-02', '/portal/coach/week/2026-11-02']])(
    'a coach on the coach app: %s → signed in, 303 to %s, no-store, asks only the coach-app question', async (f, page) => {
      const calls = {};
      const res = await get(await app({ coachApp: true, teacherV2: true, calls }), `/go/${tok(f)}`);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(page);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true }));
      expect(calls.coach).toBe(1);
      expect(calls.teacher).toBeUndefined();
    });

  test('someone NOT on the coach app → today\'s dashboard', async () => {
    const res = await get(await app({ coachApp: false, teacherV2: true }), `/go/${tok(`coach_report:${SID}`)}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
  });

  test('the coach-app check throws → today\'s dashboard (fail closed)', async () => {
    const res = await get(await app({ coachApp: new Error('db down') }), `/go/${tok('coach_week:2026-11-02')}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
  });

  test('a forged target that is not anchored opens nothing: the new-link page, no session', async () => {
    const res = await get(await app({ coachApp: true }), `/go/${forge(`coach_report:${SID}/../../teacher`)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/This link has expired/);
    expect(sessions[0].portalUserId).toBeUndefined();
  });

  test('the School card and the other coach tokens land where they did', async () => {
    const srv = await app({ coachApp: true, teacherV2: true });
    expect((await get(srv, `/go/${tok('coach_school:947')}`)).headers.location).toBe('/portal/coach/school/947');
    expect((await get(srv, `/go/${tok('coach_training')}`)).headers.location).toBe('/portal/coach/training');
    expect((await get(srv, `/go/${tok('menu')}`)).headers.location).toBe('/portal/teacher');
  });
});
