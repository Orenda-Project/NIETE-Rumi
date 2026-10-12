'use strict';
/**
 * bd-fmf24g.52 — the coach app link's token and its landing.
 *
 *   - The token can carry two coach features, coach_menu and coach_observe (app-login-link.js COACH_LANDINGS). The
 *     seven teacher features (LANDINGS) are untouched, and anything else still cannot be signed or verified.
 *   - GET /go/:token with a coach token signs the coach in and lands on the coach app — /portal/coach (coach_menu) or
 *     /portal/coach/observe (coach_observe) — when they are on the coach app; otherwise today's /portal/dashboard,
 *     never a page they cannot open. A teacher token lands exactly where it does today.
 * Real Express over HTTP; the session is a plain stand-in that records what was written.
 */
const http = require('http');
const crypto = require('crypto');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const SUPA = 'https://abcdefgh.supabase.co';
let emitted; let sessions;
beforeEach(() => {
  jest.resetModules();
  emitted = []; sessions = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: SUPA };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-12T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

const load = () => require('../../bot/shared/services/app-login-link');

/** A token for ANY feature name under this environment's real key — what a forger with the key could not do anyway. */
function forge(f, u = USER) {
  const host = new URL(SUPA).host;
  const k = crypto.createHmac('sha256', process.env.INTERNAL_API_KEY).update(`app-login-link-v2\u0000${host}`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const plain = Buffer.from(JSON.stringify({ k: 'app', u, f, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]).toString('base64url');
}

describe('the token', () => {
  test('the coach pages: coach_menu → /portal/coach, coach_observe → /portal/coach/observe', () => {
    expect(load().COACH_LANDINGS).toEqual({ coach_menu: '/portal/coach', coach_observe: '/portal/coach/observe' });
  });

  test.each(['coach_menu', 'coach_observe'])('%s signs and verifies', (f) => {
    const { signAppLink, verifyAppLink } = load();
    const t = signAppLink(USER, f);
    expect(t).toBeTruthy();
    expect(verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f }));
  });

  test('the forge helper matches the real key (positive control for the rejections below)', () => {
    expect(load().verifyAppLink(forge('coach_observe'))).toEqual(expect.objectContaining({ f: 'coach_observe' }));
    expect(load().verifyAppLink(forge('menu'))).toEqual(expect.objectContaining({ f: 'menu' }));
  });

  test.each(['observe', 'coach_lesson_plan', 'coach', 'quiz', '__proto__', 'constructor', '', 'COACH_MENU'])(
    'an unknown feature (%s) is still refused, signed or verified', (f) => {
      const { signAppLink, verifyAppLink } = load();
      expect(signAppLink(USER, f)).toBeNull();
      expect(verifyAppLink(forge(f))).toBeNull();
    });

  test('the seven teacher landings are unchanged', () => {
    expect(load().LANDINGS).toEqual({
      menu: '/portal/teacher',
      lesson_plan: '/portal/teacher/lessons',
      assessment_generator: '/portal/teacher/assessment',
      ai_coaching: '/portal/teacher/coaching',
      teacher_training: '/portal/teacher/training',
      attendance: '/portal/teacher/attendance',
      classes: '/portal/teacher/classes',
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
      findUser: async (id) => (id === USER ? { id: USER, name: 'Hataf' } : null),
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
  const tok = (f) => load().signAppLink(USER, f);

  test.each([['coach_menu', '/portal/coach'], ['coach_observe', '/portal/coach/observe']])(
    'a coach on the coach app: %s → full-app session, 303 to %s, no-store', async (f, page) => {
      const calls = {};
      const res = await get(await app({ coachApp: true, calls }), `/go/${tok(f)}`);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(page);
      expect(res.headers['cache-control']).toMatch(/no-store/);
      expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true, portalUserName: 'Hataf' }));
      expect(sessions[0].portalScope).toBeUndefined();
      expect(calls.coach).toBe(1);
      expect(calls.teacher).toBeUndefined(); // a coach token never asks the teacher-app question
    });

  test.each(['coach_menu', 'coach_observe'])('%s for someone NOT on the coach app → today\'s dashboard, even if on the teacher app', async (f) => {
    const res = await get(await app({ coachApp: false, teacherV2: true }), `/go/${tok(f)}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
  });

  test('the coach-app check throws → today\'s dashboard (fail closed), still signed in', async () => {
    const res = await get(await app({ coachApp: new Error('db down') }), `/go/${tok('coach_observe')}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/dashboard');
  });

  test('a teacher token lands exactly where it does today and never asks the coach-app question', async () => {
    const calls = {};
    const srv = await app({ teacherV2: true, coachApp: true, calls });
    expect((await get(srv, `/go/${tok('menu')}`)).headers.location).toBe('/portal/teacher');
    expect((await get(srv, `/go/${tok('lesson_plan')}`)).headers.location).toBe('/portal/teacher/lessons');
    expect(calls.coach).toBeUndefined();
    const off = await get(await app({ teacherV2: false, coachApp: true }), `/go/${tok('menu')}`);
    expect(off.headers.location).toBe('/portal/dashboard');
  });

  test('an unknown feature under the real key: the get-a-new-link page, no session', async () => {
    const srv = await app({ coachApp: true, teacherV2: true });
    for (const f of ['observe', 'coach_lesson_plan']) {
      const res = await get(srv, `/go/${forge(f)}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('/menu');
    }
    expect(sessions.every((s) => s.portalUserId === undefined)).toBe(true);
  });

  test('telemetry records the coach feature and never the token', async () => {
    const srv = await app({ coachApp: true });
    const t = tok('coach_observe');
    await get(srv, `/go/${t}`);
    expect(JSON.stringify(emitted)).not.toContain(t);
    expect(emitted).toContainEqual(expect.objectContaining({ e: 'app_link.open', d: expect.objectContaining({ outcome: 'ok', feature: 'coach_observe' }) }));
  });
});

/*
 * pre-merge class O — the tests above inject isCoachApp, so the DEFAULT wiring (the route's own read of portal_coach_v2
 * and users.role through dashboard/lib/feature-flags.js isCoachAppUser) is driven here with only Supabase mocked.
 */
describe('GET /go/:token — the default coach-app check, end to end', () => {
  let servers = [];
  afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

  async function realApp({ flag, role }) {
    jest.doMock('../../dashboard/config/supabase', () => ({
      from: (table) => {
        const f = {};
        const c = {
          select: () => c,
          eq: (k, v) => { f[k] = v; return c; },
          maybeSingle: async () => {
            if (table === 'users') return { data: f.id === USER ? { id: USER, name: 'Hataf', role } : null, error: null };
            if (table === 'app_settings' && f.key === 'portal_coach_v2') return { data: flag === undefined ? null : { value: flag }, error: null };
            return { data: null, error: null };
          },
        };
        return c;
      },
    }));
    const a = express();
    a.use((req, _res, next) => {
      const s = { regenerate(cb) { cb(); }, save(cb) { cb(); } };
      req.session = s; sessions.push(s); next();
    });
    a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter());
    const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
    servers.push(srv);
    return srv;
  }
  const go = (srv, f) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/go/${load().signAppLink(USER, f)}` }, (res) => {
      res.resume(); res.on('end', () => resolve(res.headers.location));
    }).on('error', reject);
  });

  test.each([
    [[USER], 'coach', '/portal/coach/observe'],
    [true, 'coach', '/portal/coach/observe'],
    [[USER], 'teacher', '/portal/dashboard'],
    [['someone-else'], 'coach', '/portal/dashboard'],
    ['teachers', 'coach', '/portal/dashboard'],
    [undefined, 'coach', '/portal/dashboard'],
  ])('portal_coach_v2 %j, role %s → %s', async (flag, role, where) => {
    expect(await go(await realApp({ flag, role }), 'coach_observe')).toBe(where);
  });
});
