'use strict';
/**
 * POST /api/portal/funnel/sa-offline — what "Get ready for offline" and the class list did on the coach's phone.
 * Both ran only on the phone: a Get ready that never finished, or a class list that never came, left no trace on our
 * side. The page says what happened (counts, known words, the two service workers' state); the server keeps only known
 * fields as flat top-level columns, takes the user from the SESSION, and classes the phone from the request.
 */
const http = require('http');
const express = require('express');

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
let emitted;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
});
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ session = { id: 'sess-1', portalUserId: USER } } = {}) {
  const a = express();
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').createAppFunnelRouter({}));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const post = (srv, body, { ua = '' } = {}) => new Promise((resolve, reject) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/portal/funnel/sa-offline', method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Content-Length': Buffer.byteLength(data), ...(ua ? { 'User-Agent': ua } : {}) } }, (res) => {
    let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
  });
  req.on('error', reject); req.write(data); req.end();
});
const ANDROID10 = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36';
const workers = {
  pageSwControlled: true, pageSwScript: '/assess-sw.js', saSwScript: '/sa/sw.js', saSwActive: 'activated', saSwWaiting: false,
  saSwInstalling: true, saSwUpdateFound: true,
};
const prep = {
  k: 'prep', outcome: 'updating', ok: false, why: 'worker_update_pending', total: 412, cached: 400, missing: 12,
  missingPaths: ['/sa/v4/ur/g3/line_07.mp3', '/api/portal/leader/child-test/sa/list?schoolId=abc&visitId=v'],
  missingForms: ['sa.coach.G3.A.ur'], bytes: 17500000, forms: 2, schools: 1, listed: 1, grades: 1, elapsedMs: 75000, pageKept: true,
  ...workers,
};
const rows = (e) => emitted.filter((x) => x.e === e);

test('a Get ready result is one flat sa_prep.result row: the user from the session, the phone from the request', async () => {
  const res = await post(await app(), { ...prep, userId: 'someone-else', schoolName: 'Ali School' }, { ua: ANDROID10 });
  expect(res.status).toBe(204);
  expect(rows('sa_prep.result')).toHaveLength(1);
  const d = rows('sa_prep.result')[0].d;
  expect(d).toEqual(expect.objectContaining({
    userId: USER, feature: 'learning_assessment', os: 'android', osMajor: 10, engine: 'chrome', browserMajor: 156,
    outcome: 'updating', ok: false, why: 'worker_update_pending', total: 412, cached: 400, missing: 12, missingForms: ['sa.coach.G3.A.ur'],
    bytes: 17500000, forms: 2, schools: 1, listed: 1, grades: 1, elapsedMs: 75000, pageKept: true, ...workers,
  }));
  // a path is kept without its query (a school or visit id never reaches the log)
  expect(d.missingPaths).toEqual(['/sa/v4/ur/g3/line_07.mp3', '/api/portal/leader/child-test/sa/list']);
  expect(JSON.stringify(d)).not.toMatch(/someone-else|Ali School|schoolId=|Mozilla/);
  // flat: nothing nested for Axiom to bury
  for (const v of Object.values(d)) expect(v === null || typeof v !== 'object' || Array.isArray(v)).toBe(true);
});

test('still waiting after 120 s is its own row, with where Get ready is and how far', async () => {
  await post(await app(), { k: 'prep_waiting', phase: 'lists', done: 0, total: 0, elapsedMs: 120000, ...workers });
  expect(rows('sa_prep.still_waiting')[0].d).toEqual(expect.objectContaining({ phase: 'lists', done: 0, total: 0, elapsedMs: 120000, ...workers }));
});

test('the class list: a failure, a list still not on screen at 15 s, and one that came late', async () => {
  const srv = await app();
  await post(srv, { k: 'list_failed', reason: 'no_class_list', shown: 'problem', network: false, status: 409, elapsedMs: 820, grade: 3 });
  await post(srv, { k: 'list_failed', reason: null, shown: 'failed', network: true, status: null, elapsedMs: 30000, grade: null });
  await post(srv, { k: 'list_slow', elapsedMs: 15000, pending: true, grade: 4, ...workers });
  await post(srv, { k: 'list_late', elapsedMs: 61000, grade: 4 });
  expect(rows('sa_list.failed').map((r) => r.d)).toEqual([
    expect.objectContaining({ reason: 'no_class_list', shown: 'problem', network: false, status: 409, elapsedMs: 820, grade: 3 }),
    expect.objectContaining({ reason: 'none', shown: 'failed', network: true, status: null, elapsedMs: 30000, grade: null }),
  ]);
  expect(rows('sa_list.slow')[0].d).toEqual(expect.objectContaining({ elapsedMs: 15000, pending: true, grade: 4, ...workers }));
  expect(rows('sa_list.late')[0].d).toEqual(expect.objectContaining({ elapsedMs: 61000, grade: 4 }));
});

test('unknown values become safe ones; at most 5 paths; a bad body or kind is 400; no session is 401', async () => {
  await post(await app(), {
    ...prep, outcome: 'boom', why: '<script>', missingPaths: ['https://evil.example/x', '/a b', ...Array.from({ length: 9 }, (_, i) => `/sa/f${i}.mp3`)],
    missingForms: ['sa.coach.G3.A.ur', 'Ali'], total: -4, pageSwScript: 'javascript:alert(1)', saSwActive: 'weird', pageSwControlled: 'yes',
  });
  const d = rows('sa_prep.result')[0].d;
  expect(d).toEqual(expect.objectContaining({ outcome: 'unknown', why: 'other', total: 0, pageSwScript: 'unknown', saSwActive: 'unknown', pageSwControlled: null }));
  expect(d.missingPaths).toEqual(['/sa/f0.mp3', '/sa/f1.mp3', '/sa/f2.mp3', '/sa/f3.mp3', '/sa/f4.mp3']);
  expect(d.missingForms).toEqual(['sa.coach.G3.A.ur']);
  expect((await post(await app(), 'not json')).status).toBe(400);
  expect((await post(await app(), { k: 'nope' })).status).toBe(400);
  expect((await post(await app({ session: null }), prep)).status).toBe(401);
  expect(emitted).toHaveLength(1);
});
