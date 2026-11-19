'use strict';
/**
 * bd-snkn32.51 (queue #134 A) — every "Make my plan" and "Change this plan" answer leaves one own_plan.make row in
 * Axiom (app-funnel logAppAction), with the reason a plan was NOT made. #120 found 28 generic "Could not make it"
 * screens with no reason saved anywhere. Ids and codes only, never her words. Real Express; bot and sink stubbed.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
let flags;
let gb; // bd-2zopnc: isGbTeacher answer (true, false, or an Error to throw)
let botCalls;
let botAnswer;
let emitted;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'http://bot', INTERNAL_API_KEY: 'k' };
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  botCalls = [];
  emitted = [];
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  botAnswer = { status: 202, data: { success: true, state: 'authoring', renderId: 'own-1' } };
  gb = false;
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../bot/shared/services/lp-own-gb', () => ({
    isGbTeacher: async () => { if (gb instanceof Error) throw gb; return gb; },
  }));
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

async function start(session = { id: 'sess-1', portalUserId: 'u-session' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const post = (body, path = '/api/portal/lp612/own') => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path, method: 'POST', agent: false,
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

const made = () => emitted.filter((x) => x.e === 'app_funnel.action' && x.d.action === 'own_plan.make').map((x) => x.d);

test('a plan queued: one row, outcome queued, the lane and the lesson id, as the session user', async () => {
  await start();
  await post(BODY);
  expect(made()).toEqual([expect.objectContaining({
    userId: 'u-session', feature: 'lesson_plan', kind: 'make', lane: 'g612', lesson: 'seg', outcome: 'queued', httpStatus: 202, ownId: 'own-1',
  })]);
});

test('a grades 1-5 day is lane k5', async () => {
  await start();
  await post({ lesson_id: 'grade_3_urdu_ch1_seg2', answers: ANSWERS });
  expect(made()[0]).toEqual(expect.objectContaining({ lane: 'k5', lesson: 'grade_3_urdu_ch1_seg2', outcome: 'queued' }));
});

test('a refusal is logged with its reason', async () => {
  botAnswer = { status: 409, data: { success: false, outcome: 'daily_limit' } };
  await start();
  await post(BODY);
  expect(made()).toEqual([expect.objectContaining({ outcome: 'daily_limit', httpStatus: 409 })]);
});

test.each([[400, 'bot_400'], [403, 'bot_403'], [404, 'bot_404'], [500, 'bot_500'], [409, 'bot_409']])('bot %i → outcome %s', async (botStatus, outcome) => {
  botAnswer = { status: botStatus, data: { success: false, outcome: 'not-a-known-code' } };
  await start();
  await post(BODY);
  expect(made()).toEqual([expect.objectContaining({ outcome, httpStatus: botStatus })]);
});

test('a bot that cannot be reached: outcome unreachable, no status', async () => {
  botAnswer = new Error('ECONNREFUSED');
  await start();
  await post(BODY);
  expect(made()).toEqual([expect.objectContaining({ outcome: 'unreachable', httpStatus: null })]);
});

test('a bad request never reaches the bot but is still logged', async () => {
  await start();
  await post({ answers: ANSWERS });
  expect(made()).toEqual([expect.objectContaining({ outcome: 'bad_request', httpStatus: 400 })]);
});

test('switched off for her: nothing is logged (she never saw the form)', async () => {
  flags.portal_lp_make_own = false;
  await start();
  await post(BODY);
  expect(made()).toEqual([]);
});

test('a change: kind change, the plan id, the reason; her words never logged', async () => {
  botAnswer = { status: 409, data: { success: false, outcome: 'too_short' } };
  await start();
  await post({ part: 'warmup', text: 'make it a song please' }, '/api/portal/lp612/own/own-9/change');
  const rows = made();
  expect(rows).toEqual([expect.objectContaining({ kind: 'change', ownId: 'own-9', part: 'warmup', outcome: 'too_short' })]);
  expect(JSON.stringify(rows)).not.toContain('song');
});
