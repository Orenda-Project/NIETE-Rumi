'use strict';
/**
 * bd-snkn32.20 — GET /api/portal/lp612/own/mine?keys=a,b: "Your plans for this chapter". Dark unless both flags are on
 * (404, the bot never asked). The user is ALWAYS the session's, never the query's. Bot failure is a 502.
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
  botAnswer = { status: 200, data: { success: true, plans: [{ ownId: 'o2', rootId: 'o1', lesson: 's1', band: 'g612', status: 'ready', changesLeft: 1, round: 1, createdAt: 't', extra: 'x' }] } };
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async (_s, key) => flags[key] === true }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_LP_MAKE_OWN_KEY: 'portal_lp_make_own',
    isFlagEnabledForUser: async (_s, key) => flags[key] === true,
  }));
  jest.doMock('axios', () => ({
    get: async (url, opts) => { botCalls.push({ url, opts }); if (botAnswer instanceof Error) throw botAnswer; return botAnswer; },
  }));
});
afterAll(() => { process.env = ENV; });

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start(session = { portalUserId: 'u-session' }) {
  const a = express();
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-own.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, agent: false }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => { let body = null; try { body = s ? JSON.parse(s) : null; } catch { body = s; } resolve({ status: res.statusCode, body }); });
  }).on('error', reject);
});

test('asks the bot for the SESSION user, passes the lesson ids, returns only the plan fields', async () => {
  await start();
  const r = await get('/api/portal/lp612/own/mine?keys=s1,s2&userId=someone-else');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ success: true, plans: [{ ownId: 'o2', rootId: 'o1', lesson: 's1', band: 'g612', status: 'ready', changesLeft: 1, round: 1, createdAt: 't' }] });
  expect(botCalls).toHaveLength(1);
  expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/mine');
  expect(botCalls[0].opts.params).toEqual({ userId: 'u-session', keys: 's1,s2' });
});

test('dark when Make my own is off: 404, the bot is never asked', async () => {
  flags.portal_lp_make_own = false;
  await start();
  expect((await get('/api/portal/lp612/own/mine?keys=s1')).status).toBe(404);
  expect(botCalls).toHaveLength(0);
});

test('no lesson ids: 400, the bot is never asked', async () => {
  await start();
  expect((await get('/api/portal/lp612/own/mine')).status).toBe(400);
  expect(botCalls).toHaveLength(0);
});

test('bot down or erroring: 502', async () => {
  await start();
  botAnswer = new Error('ECONNREFUSED');
  expect((await get('/api/portal/lp612/own/mine?keys=s1')).status).toBe(502);
  botAnswer = { status: 500, data: { success: false } };
  expect((await get('/api/portal/lp612/own/mine?keys=s1')).status).toBe(502);
});
