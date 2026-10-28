'use strict';
/**
 * The School card's landing targets for the one-tap app link (bot/shared/services/coach-school-target.js).
 *
 *   coach_school:<EMIS>  → /portal/coach/school/<EMIS>   one of the coach's schools (its page 404s if it is not hers)
 *   coach_schools        → /portal/coach/people          My schools
 *
 * The EMIS is the portal route's own charset ([A-Za-z0-9-]{1,32}), anchored, so no path, query or fragment can ride
 * along. `linkable` (app-login-link.js) learns both, so they sign and verify; anything else near them is refused.
 * GET /go/:token asks the COACH-app question for them (isCoachApp) and lands the page; off the coach app, today's
 * dashboard. Real Express over HTTP; the session is a plain stand-in that records what was written.
 */
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
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
const target = () => require('../../bot/shared/services/coach-school-target');

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
    ['coach_school:947', '/portal/coach/school/947'],
    ['coach_school:ICT-0947', '/portal/coach/school/ICT-0947'],
    ['coach_school:a', '/portal/coach/school/a'],
    [`coach_school:${'9'.repeat(32)}`, `/portal/coach/school/${'9'.repeat(32)}`],
    ['coach_schools', '/portal/coach/people'],
  ])('%s → %s', (f, page) => {
    expect(target().isCoachSchoolTarget(f)).toBe(true);
    expect(target().coachSchoolPathFor(f)).toBe(page);
  });

  test.each([
    'coach_school:', 'coach_school', 'coach_school:947/teacher', 'coach_school:../947', 'coach_school:947?x=1',
    'coach_school:947#x', 'coach_school:947\n', 'coach_school: 947', 'coach_school:94 7', `coach_school:${'9'.repeat(33)}`,
    'COACH_SCHOOL:947', 'coach_school:947:1', 'coach_school:%39%34', 'coach_schools:947', 'coach_schools ', 'xcoach_school:947',
    'coach_school:٩٤٧', '', null, undefined, 947, {},
  ])('%p is not a target: no page', (f) => {
    expect(target().isCoachSchoolTarget(f)).toBe(false);
    expect(target().coachSchoolPathFor(f)).toBeNull();
  });

  test('coachSchoolTarget builds a target from a safe EMIS and refuses anything else', () => {
    expect(target().coachSchoolTarget('947')).toBe('coach_school:947');
    expect(target().coachSchoolTarget(' 947 ')).toBe('coach_school:947');
    for (const bad of ['', null, undefined, '9/4', '947?x', 'a b', '9'.repeat(33)]) expect(target().coachSchoolTarget(bad)).toBeNull();
  });
});

describe('the token', () => {
  test.each(['coach_school:947', 'coach_schools'])('%s signs and verifies', (f) => {
    const t = link().signAppLink(USER, f);
    expect(t).toBeTruthy();
    expect(link().verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f }));
  });

  test('the forge helper matches the real key (positive control for the refusals below)', () => {
    expect(link().verifyAppLink(forge('coach_school:947'))).toEqual(expect.objectContaining({ f: 'coach_school:947' }));
  });

  test.each(['coach_school:', 'coach_school:947/x', 'coach_school:947?x=1', 'coach_school:../x', 'COACH_SCHOOL:947', 'coach_schools:1', 'coach_school'])(
    '%s cannot be signed or verified', (f) => {
      expect(link().signAppLink(USER, f)).toBeNull();
      expect(link().verifyAppLink(forge(f))).toBeNull();
    });

  test('the existing landings are unchanged', () => {
    expect(link().COACH_LANDINGS).toEqual({
      coach_menu: '/portal/coach', coach_observe: '/portal/coach/observe', coach_training: '/portal/coach/training',
    });
    expect(link().LANDINGS.menu).toBe('/portal/teacher');
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

  test.each([['coach_school:947', '/portal/coach/school/947'], ['coach_schools', '/portal/coach/people']])(
    'a coach on the coach app: %s → full-app session, 303 to %s, no-store, asks only the coach-app question', async (f, page) => {
      const calls = {};
      const res = await get(await app({ coachApp: true, teacherV2: true, calls }), `/go/${tok(f)}`);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(page);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true, portalUserName: 'Nadia' }));
      expect(sessions[0].portalScope).toBeUndefined();
      expect(calls.coach).toBe(1);
      expect(calls.teacher).toBeUndefined();
      expect(emitted.find((x) => x.e === 'app_link.open').d).toEqual(expect.objectContaining({ outcome: 'ok', feature: f, v2: true }));
    });

  test.each(['coach_school:947', 'coach_schools'])('%s for someone NOT on the coach app → today\'s dashboard, even on the teacher app', async (f) => {
    const res = await get(await app({ coachApp: false, teacherV2: true }), `/go/${tok(f)}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
  });

  test('the coach-app check throws → today\'s dashboard (fail closed), still signed in', async () => {
    const res = await get(await app({ coachApp: new Error('db down') }), `/go/${tok('coach_school:947')}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
    expect(sessions[0].portalUserId).toBe(USER);
  });

  test('a forged target that is not anchored opens nothing: the new-link page, no session', async () => {
    const res = await get(await app({ coachApp: true }), `/go/${forge('coach_school:947/../../teacher')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/This link has expired/);
    expect(sessions[0].portalUserId).toBeUndefined();
  });

  test('the other coach and teacher tokens land where they did', async () => {
    const srv = await app({ coachApp: true, teacherV2: true });
    expect((await get(srv, `/go/${tok('coach_training')}`)).headers.location).toBe('/portal/coach/training');
    expect((await get(srv, `/go/${tok('menu')}`)).headers.location).toBe('/portal/teacher');
  });
});
