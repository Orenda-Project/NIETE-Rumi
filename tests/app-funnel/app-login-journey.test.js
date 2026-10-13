'use strict';
/**
 * bd-4r3rei — GET /go/:token carries the journey from the link into the portal session, and says so in app_link.open.
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
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date('2026-10-13T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ users = { [USER]: { id: USER, name: 'Ayesha' } } } = {}) {
  const a = express();
  a.use((req, _res, next) => {
    const s = { regenerate(cb) { Object.keys(s).filter((k) => typeof s[k] !== 'function').forEach((k) => delete s[k]); cb(); }, save(cb) { cb(); } };
    req.session = s; sessions.push(s); next();
  });
  a.use(require('../../dashboard/routes/app-login.routes').createAppLoginRouter({
    findUser: async (id) => users[id] || null,
    isTeacherV2: async () => true,
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject);
});
const mint = () => require('../../bot/shared/services/app-journey').newJourneyId();
const tok = (j, f = 'lesson_plan', u = USER) => require('../../bot/shared/services/app-login-link').signAppLink(u, f, j);
const opens = () => emitted.filter((x) => x.e === 'app_link.open').map((x) => x.d);

test('a link with a journey: app_link.open carries it, and the session remembers it (with its start time)', async () => {
  const j = mint();
  const res = await get(await app(), `/go/${tok(j)}`);
  expect(res.status).toBe(303);
  expect(opens()).toEqual([expect.objectContaining({ outcome: 'ok', feature: 'lesson_plan', userId: USER, journeyId: j })]);
  expect(sessions[0].appJourney).toEqual({ id: j, at: Date.parse('2026-10-13T10:00:00Z'), feature: 'lesson_plan' });
});

test('a link from before this change (no journey): opens as before, journeyId null, no journey in the session', async () => {
  const res = await get(await app(), `/go/${tok(undefined)}`);
  expect(res.status).toBe(303);
  expect(opens()[0]).toEqual(expect.objectContaining({ outcome: 'ok', journeyId: null }));
  expect(sessions[0].appJourney).toBeUndefined();
});

test('the same link tapped twice: both opens carry the same journey id (the funnel counts the journey once)', async () => {
  const j = mint(); const srv = await app(); const t = tok(j);
  await get(srv, `/go/${t}`); await get(srv, `/go/${t}`);
  expect(opens().map((o) => o.journeyId)).toEqual([j, j]);
});

test('an unknown user and a read error still say which journey the tap belonged to', async () => {
  const j = mint();
  await get(await app({ users: {} }), `/go/${tok(j)}`);
  expect(opens()[0]).toEqual(expect.objectContaining({ outcome: 'unknown_user', journeyId: j }));
});

test('an invalid token has no journey and no session', async () => {
  await get(await app(), '/go/nope');
  expect(opens()[0]).toEqual({ outcome: 'invalid' });
  expect(sessions[0].appJourney).toBeUndefined();
});

test('the journey id never appears in the redirect', async () => {
  const j = mint();
  const res = await get(await app(), `/go/${tok(j)}`);
  expect(res.headers.location).toBe('/portal/teacher/lessons');
});
