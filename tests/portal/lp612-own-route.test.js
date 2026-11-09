'use strict';
/**
 * bd-snkn32 — POST /api/portal/lp612/own (dashboard/routes/portal-lp612-own.routes.js): "Make my own" from the
 * teacher app. Dark unless BOTH portal_teacher_v2 and portal_lp_make_own are on for her (404, the bot never asked).
 * The user is ALWAYS the session's, never the body's. Real Express over HTTP; flags, auth and the bot stubbed.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
let flags;
let botCalls;
let botAnswer;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'http://bot', INTERNAL_API_KEY: 'k' };
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  botCalls = [];
  botAnswer = { status: 202, data: { success: true, state: 'authoring', renderId: 'own-1' } };
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({
    teacherAppOnFor: async (_s, key) => flags[key] === true,
  }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_LP_MAKE_OWN_KEY: 'portal_lp_make_own',
    isFlagEnabledForUser: async (_s, key) => flags[key] === true,
  }));
  jest.doMock('axios', () => ({
    post: async (url, body) => { botCalls.push({ url, body }); if (botAnswer instanceof Error) throw botAnswer; return botAnswer; },
  }));
});
afterAll(() => { process.env = ENV; });

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start(session = { portalUserId: 'u-session' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const post = (body) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path: '/api/portal/lp612/own', method: 'POST', agent: false,
    headers: { 'Content-Type': 'application/json' },
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});

const ANSWERS = { size: '51_70', resources: ['board'], level: 'mixed', way: 'tarl', note: '' };
const BODY = { segment_id: 'seg', answers: ANSWERS };

test('flag off: 404 and the bot is never asked', async () => {
  flags.portal_lp_make_own = false;
  await start();
  expect((await post(BODY)).status).toBe(404);
  expect(botCalls).toEqual([]);
});

test('teacher app off: 404 too', async () => {
  flags.portal_teacher_v2 = false;
  await start();
  expect((await post(BODY)).status).toBe(404);
  expect(botCalls).toEqual([]);
});

test('not signed in: 401', async () => {
  await start(null);
  expect((await post(BODY)).status).toBe(401);
});

test('asks the bot as the SESSION user, ignoring any user in the body', async () => {
  await start();
  const out = await post({ ...BODY, userId: 'someone-else' });
  expect(out).toEqual({ status: 202, body: { success: true, state: 'authoring', renderId: 'own-1' } });
  expect(botCalls).toEqual([{
    url: 'http://bot/api/internal/lp612/own',
    body: { userId: 'u-session', segmentId: 'seg', answers: ANSWERS },
  }]);
});

test('no segment, or no answers object: 400 before the bot', async () => {
  await start();
  expect((await post({ answers: ANSWERS })).status).toBe(400);
  expect((await post({ segment_id: 'seg' })).status).toBe(400);
  expect(botCalls).toEqual([]);
});

test.each([[400, 400], [403, 403], [404, 404], [500, 502]])('bot %i → %i', async (botStatus, status) => {
  botAnswer = { status: botStatus, data: { success: false } };
  await start();
  const out = await post(BODY);
  expect(out.status).toBe(status);
  expect(out.body.renderId).toBeUndefined();
});

test('a bot that cannot be reached is 502, never a plan', async () => {
  botAnswer = new Error('ECONNREFUSED');
  await start();
  expect((await post(BODY)).status).toBe(502);
});

// bd-snkn32.4 — a grades 1–5 day: lesson_id instead of segment_id, never both.
test('a grades 1–5 lesson_id goes to the bot as lessonId, as the session user', async () => {
  await start();
  const out = await post({ lesson_id: 'grade_3_urdu_ch1_seg2', answers: ANSWERS });
  expect(out.status).toBe(202);
  expect(botCalls).toEqual([{
    url: 'http://bot/api/internal/lp612/own',
    body: { userId: 'u-session', lessonId: 'grade_3_urdu_ch1_seg2', answers: ANSWERS },
  }]);
});

test('both a segment and a lesson: 400 before the bot', async () => {
  await start();
  expect((await post({ segment_id: 'seg', lesson_id: 'l', answers: ANSWERS })).status).toBe(400);
  expect(botCalls).toEqual([]);
});
