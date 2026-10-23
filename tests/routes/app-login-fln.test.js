'use strict';
/**
 * PR-E (m-links) — Send to teacher: a teacher's OWN /go token with target `fln:<id>` round-trips
 * sign (bot/shared/services/app-login-link.js) → verify (same module, called by the route) → 303 to the
 * FLN plan page, signed in. Real Express over HTTP and the real token module; only telemetry and the
 * user lookup are stubbed (the DB boundary). Style copied from tests/app-redirect/app-login-route.test.js.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted; let sessions; let v2Calls;
beforeEach(() => {
  jest.resetModules();
  emitted = []; sessions = []; v2Calls = 0;
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://envone.supabase.co' };
});
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ v2 = true } = {}) {
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { Object.keys(s).filter((k) => typeof s[k] !== 'function').forEach((k) => delete s[k]); cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => (id === USER ? { id: USER, name: 'Test Teacher' } : null),
    isTeacherV2: async () => { v2Calls += 1; return v2; },
    isCoachApp: async () => false,
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
const link = () => require('../../bot/shared/services/app-login-link');

test('sign fln:11156 → GET /go/<token> → 303 /portal/fln/p/11156?src=send, signed in, no-store', async () => {
  const token = link().signAppLink(USER, 'fln:11156');
  expect(typeof token).toBe('string');
  expect(link().verifyAppLink(token)).toEqual(expect.objectContaining({ u: USER, f: 'fln:11156' }));
  const res = await get(await app(), `/go/${token}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/fln/p/11156?src=send');
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true }));
});

test('an FLN target bypasses the teacher-app (v2) decision: off the app it still lands on the plan', async () => {
  const token = link().signAppLink(USER, 'fln:11156');
  const res = await get(await app({ v2: false }), `/go/${token}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/fln/p/11156?src=send');
  // :178 is unchanged — the v2 question is still asked (and its answer ignored for an FLN target).
  expect(v2Calls).toBe(1);
});

test('a tampered FLN token → the new-link page, no session', async () => {
  const token = link().signAppLink(USER, 'fln:11156');
  const bad = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');
  const res = await get(await app(), `/go/${bad}`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/html/);
  expect(sessions[0].portalUserId).toBeUndefined();
});

test.each([['fln:'], ['fln:abc'], ['fln:1234567890'], ['fln:1/x']])('%p cannot be signed', (f) => {
  expect(link().signAppLink(USER, f)).toBeNull();
});

test('the token never reaches telemetry', async () => {
  const token = link().signAppLink(USER, 'fln:11156');
  await get(await app(), `/go/${token}`);
  expect(JSON.stringify(emitted)).not.toContain(token);
});

// Golden: every existing feature lands exactly where it did before the hook (values copied from the route
// file's LANDINGS / COACH_LANDINGS / LEGACY_LANDING on origin/sandbox 67e22b0ef, not read from the module).
describe('existing landings unchanged', () => {
  const TEACHER = [
    ['menu', '/portal/teacher'], ['lesson_plan', '/portal/teacher/lessons'], ['assessment_generator', '/portal/teacher/assessment'],
    ['ai_coaching', '/portal/teacher/coaching'], ['teacher_training', '/portal/teacher/training'],
    ['attendance', '/portal/teacher/attendance'], ['classes', '/portal/teacher/classes'],
  ];
  test.each(TEACHER)('%s on the app → %s; off the app → /portal/dashboard', async (f, path) => {
    const on = await get(await app({ v2: true }), `/go/${link().signAppLink(USER, f)}`);
    expect(on.headers.location).toBe(path);
    const off = await get(await app({ v2: false }), `/go/${link().signAppLink(USER, f)}`);
    expect(off.headers.location).toBe('/portal/dashboard');
  });
  test('coach landings are untouched (off the coach app → /portal/dashboard)', async () => {
    for (const f of ['coach_menu', 'coach_observe', 'coach_training']) {
      const res = await get(await app(), `/go/${link().signAppLink(USER, f)}`);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/portal/dashboard'); // isCoachApp stubbed false
    }
  });
});

/**
 * bd-zcgpkx — Send a lesson plan (the FLN builder): the fixed target `fln:send`; like a plan target it lands whether
 * or not the user is on the teacher app. bd-a73p5m: the bot no longer mints it (a leader's "lesson plan" lands on the
 * Lesson Plans tab, tests/app-redirect/app-link-leader-lesson-plan.test.js); a link already sent still lands here.
 */
test('sign fln:send → GET /go/<token> → 303 /portal/fln/send, signed in, no-store, even off the teacher app', async () => {
  const token = link().signAppLink(USER, 'fln:send');
  expect(typeof token).toBe('string');
  expect(link().verifyAppLink(token)).toEqual(expect.objectContaining({ u: USER, f: 'fln:send' }));
  const res = await get(await app({ v2: false }), `/go/${token}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/fln/send');
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(sessions[0]).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true }));
});

test.each([['fln:sendx'], ['fln:send/x'], ['fln:send?x=1'], ['fln:SEND'], [' fln:send']])('%p cannot be signed', (f) => {
  expect(link().signAppLink(USER, f)).toBeNull();
});
