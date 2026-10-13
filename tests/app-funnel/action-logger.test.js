'use strict';
/**
 * bd-4r3rei — app_funnel.action: the key things a teacher DOES in the app, logged from the server the moment the
 * request succeeds. No change to any feature route, no table, no ids. Real Express over HTTP with stub handlers
 * standing in for the portal's routes (they answer whatever status the test asks for).
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const JID = 'j_0123456789abcdef';
const NOW = Date.parse('2026-10-13T10:00:00Z');
let emitted;
beforeEach(() => {
  jest.resetModules();
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key' };
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(new Date(NOW));
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app({ session = { id: 'sess-1', portalUserId: USER, appJourney: { id: JID, at: NOW - 1000, feature: 'menu' } }, status = 200 } = {}) {
  const a = express();
  a.use((req, _res, next) => { if (session) req.session = { ...session }; next(); });
  a.use('/api/portal', require('../../dashboard/routes/app-funnel.routes').actionLogger);
  a.use('/api/portal', (req, res) => res.status(status).json({ ok: status < 400 }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}
const call = (srv, method, path) => new Promise((resolve, reject) => {
  // agent:false and no body on a GET: a reused keep-alive socket after a body-carrying GET resets on Node 22.
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, agent: false, headers: { 'Content-Type': 'application/json' } }, (res) => {
    res.on('data', () => {}); res.on('end', () => setImmediate(() => resolve(res.statusCode)));
  });
  req.on('error', reject); req.end(method === 'GET' ? undefined : '{}');
});
const actions = () => emitted.filter((x) => x.e === 'app_funnel.action').map((x) => x.d);

const CASES = [
  ['GET', '/api/portal/curriculum/lp/LESSON-123/file?kind=lesson', 'lesson_plan.opened', 'lesson_plan', { lane: 'k5' }],
  ['GET', '/api/portal/curriculum/lp/LESSON-123/pdf', 'lesson_plan.opened', 'lesson_plan', { lane: 'k5' }],
  ['GET', '/api/portal/lp612/file/8c1f0e3a-1111-4222-8333-944455556666', 'lesson_plan.opened', 'lesson_plan', { lane: 'g612' }],
  ['GET', '/api/portal/lp612/status/8c1f0e3a-1111-4222-8333-944455556666?open=1', 'lesson_plan.opened', 'lesson_plan', { lane: 'g612' }],
  ['POST', '/api/portal/lp612/request', 'lesson_plan.requested', 'lesson_plan', { lane: 'g612' }],
  ['POST', '/api/portal/assessment/generate', 'paper.requested', 'assessment_generator', {}],
  ['POST', '/api/portal/assessment/edit/paper-77/save', 'paper.edited', 'assessment_generator', {}],
  ['POST', '/api/portal/teacher/attendance/classes/list-9/mark', 'attendance.saved', 'attendance', {}],
  ['POST', '/api/portal/teacher/attendance/classes/list-9/register/send', 'attendance.register_sent', 'attendance', {}],
  ['POST', '/api/portal/attendance/mark', 'attendance.saved', 'attendance', {}],
  ['GET', '/api/portal/training/module/mod-5', 'training.module_opened', 'teacher_training', {}],
  ['POST', '/api/portal/training/module/mod-5/quiz-attempts/start', 'training.quiz_started', 'teacher_training', {}],
  ['POST', '/api/portal/training/module/mod-5/quiz-attempts/att-1/finish', 'training.quiz_finished', 'teacher_training', {}],
  ['POST', '/api/portal/training/module/mod-5/complete', 'training.module_completed', 'teacher_training', {}],
  ['POST', '/api/portal/training/level/lvl-2/certificate', 'training.certificate_issued', 'teacher_training', {}],
  ['POST', '/api/portal/classes', 'class.created', 'classes', {}],
  ['POST', '/api/portal/classes/cls-1/students', 'class.students_added', 'classes', {}],
  ['POST', '/api/portal/coaching-upload/start', 'coaching.recording_submitted', 'ai_coaching', {}],
  ['POST', '/api/portal/coaching-session/sess-4/reflection', 'coaching.reflection_saved', 'ai_coaching', {}],
  ['POST', '/api/portal/share/whatsapp', 'share.whatsapp', 'share', {}],
  ['POST', '/api/portal/leader/observe/start', 'observe.started', 'coach', {}],
  ['POST', '/api/portal/leader/observe/obs-3/report/send', 'observe.report_sent', 'coach', {}],
  ['POST', '/api/portal/me/notices/n-1/opened', 'notice.opened', 'notice', {}],
];

test.each(CASES)('%s %s → %s', async (method, path, action, feature, extra) => {
  expect(await call(await app(), method, path)).toBe(200);
  expect(actions()).toEqual([expect.objectContaining({ action, feature, userId: USER, journeyId: JID, status: 200, ...extra })]);
});

test('no ids, tokens or query strings in what is logged', async () => {
  const srv = await app();
  for (const [m, p] of CASES) await call(srv, m, p);
  expect(JSON.stringify(actions())).not.toMatch(/LESSON-123|8c1f0e3a|paper-77|list-9|mod-5|att-1|lvl-2|cls-1|sess-4|obs-3|n-1|kind=|open=/);
});

test.each([400, 401, 403, 404, 409, 500, 502])('a %s is not an action', async (status) => {
  await call(await app({ status }), 'POST', '/api/portal/classes');
  expect(actions()).toEqual([]);
});

test('reads and writes that are not key actions log nothing', async () => {
  const srv = await app();
  for (const [m, p] of [['GET', '/api/portal/dashboard'], ['GET', '/api/portal/me'], ['GET', '/api/portal/curriculum/grades'], ['POST', '/api/portal/logout'],
    ['PUT', '/api/portal/me/language'], ['GET', '/api/portal/classes'], ['POST', '/api/portal/lp612/status/abc']]) await call(srv, m, p);
  expect(actions()).toEqual([]);
});

test('no portal session: nothing (the request was refused anyway)', async () => {
  await call(await app({ session: null }), 'POST', '/api/portal/classes');
  expect(actions()).toEqual([]);
});

test('a direct session (no journey): journeyId null, entry session', async () => {
  await call(await app({ session: { id: 's', portalUserId: USER } }), 'POST', '/api/portal/classes');
  expect(actions()[0]).toEqual(expect.objectContaining({ journeyId: null, entry: 'session' }));
});

test('an old journey (older than the link\'s 24 h) is not attributed', async () => {
  await call(await app({ session: { id: 's', portalUserId: USER, appJourney: { id: JID, at: NOW - 30 * 3600 * 1000, feature: 'menu' } } }), 'POST', '/api/portal/classes');
  expect(actions()[0].journeyId).toBeNull();
});

test('the same appSessionId as the page events of that session', async () => {
  const srv = await app();
  await call(srv, 'POST', '/api/portal/classes');
  expect(actions()[0].appSessionId).toMatch(/^[0-9a-f]{12}$/);
});

test('a sink that throws never breaks the response', async () => {
  jest.resetModules();
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: () => { throw new Error('down'); }, flush() {}, isEnabled: () => true }));
  expect(await call(await app(), 'POST', '/api/portal/classes')).toBe(200);
});
