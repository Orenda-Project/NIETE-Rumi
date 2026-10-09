'use strict';
/**
 * bd-fmf24g.35 — GET /go/:token: the link signs her into the WHOLE teacher app and lands on the feature.
 * Real Express over HTTP; the session is a plain stand-in that records what was written.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted; let sessions;
beforeEach(() => {
  jest.resetModules();
  emitted = []; sessions = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  delete process.env.WEB_TRAINING_TOKEN_SECRET;
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-10T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ users = { [USER]: { id: USER, name: 'Ayesha' } }, v2 = true } = {}) {
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { Object.keys(s).filter((k) => typeof s[k] !== 'function').forEach((k) => delete s[k]); cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => users[id] || null,
    isTeacherV2: async () => v2,
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
const tok = (u = USER, f = 'lesson_plan') => require('../../bot/shared/services/app-login-link').signAppLink(u, f);

test('a good link: full-app session (no scope), 303 to the feature\'s v2 page, no-store', async () => {
  const srv = await app();
  const res = await get(srv, `/go/${tok(USER, 'lesson_plan')}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/teacher/lessons');
  expect(res.headers['cache-control']).toMatch(/no-store/);
  const s = sessions[0];
  expect(s).toEqual(expect.objectContaining({ portalUserId: USER, isPortalAuth: true, portalUserName: 'Ayesha' }));
  expect(s.portalScope).toBeUndefined();
});

test.each([
  ['menu', '/portal/teacher'], ['assessment_generator', '/portal/teacher/assessment'], ['ai_coaching', '/portal/teacher/coaching'],
  ['teacher_training', '/portal/teacher/training'], ['attendance', '/portal/teacher/attendance'], ['classes', '/portal/teacher/classes'],
])('%s lands on %s', async (f, path) => {
  const res = await get(await app(), `/go/${tok(USER, f)}`);
  expect(res.headers.location).toBe(path);
});

test('re-tap within 24 h works every time', async () => {
  const srv = await app();
  const t = tok();
  jest.setSystemTime(new Date('2026-10-11T09:00:00Z'));
  expect((await get(srv, `/go/${t}`)).status).toBe(303);
  expect((await get(srv, `/go/${t}`)).status).toBe(303);
});

test('an expired token: the en+ur get-a-new-link page, no session', async () => {
  const srv = await app();
  const t = tok();
  jest.setSystemTime(new Date('2026-10-11T10:00:01Z'));
  const res = await get(srv, `/go/${t}`);
  expect(res.status).toBe(200);
  expect(res.body).toContain('/menu');
  expect(res.body).toMatch(/lang="ur"/);
  expect(res.body).toMatch(/[؀-ۿ]/);
  expect(sessions[0].portalUserId).toBeUndefined();
});

test('a tampered token and a bare /go get the same page, no session', async () => {
  const srv = await app();
  const t = tok();
  for (const p of [`/go/${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, '/go/nope', '/go']) {
    const res = await get(srv, p);
    expect(res.status).toBe(200);
    expect(res.body).toContain('/menu');
  }
  expect(sessions.every((s) => s.portalUserId === undefined)).toBe(true);
});

test('a token for a user who no longer exists signs nobody in', async () => {
  const srv = await app({ users: {} });
  const res = await get(srv, `/go/${tok()}`);
  expect(res.status).toBe(200);
  expect(sessions[0].portalUserId).toBeUndefined();
});

test('another user\'s token signs in ITS user, never the user of a different token', async () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const srv = await app({ users: { [USER]: { id: USER, name: 'A' }, [other]: { id: other, name: 'B' } } });
  await get(srv, `/go/${tok(other, 'menu')}`);
  expect(sessions[0].portalUserId).toBe(other);
});

test('not on the teacher app any more: she still gets in, to today\'s dashboard', async () => {
  const res = await get(await app({ v2: false }), `/go/${tok()}`);
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/portal/dashboard');
});

test('the token never reaches the telemetry; the outcome does', async () => {
  const srv = await app();
  const t = tok();
  await get(srv, `/go/${t}`);
  expect(JSON.stringify(emitted)).not.toContain(t);
  expect(emitted.some((x) => x.d && x.d.outcome === 'ok')).toBe(true);
});

test('rate limited per IP', async () => {
  const srv = await app();
  let last;
  for (let i = 0; i < 70; i += 1) last = await get(srv, '/go/nope');
  expect(last.status).toBe(429);
});
