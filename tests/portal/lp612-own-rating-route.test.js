'use strict';
/**
 * bd-snkn32.11 (queue #134 C) — POST /api/portal/lp612/own/:ownId/rating { rating, confusing? }: her rating of her own
 * plan, relayed to the bot as the SESSION's user (never the body's). Dark unless Make my own is on for her.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
let flags;
let gb; // bd-2zopnc: isGbTeacher answer (true, false, or an Error to throw)
let botCalls;
let botAnswer;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'http://bot', INTERNAL_API_KEY: 'k' };
  flags = { portal_teacher_v2: true, portal_lp_make_own: true };
  botCalls = [];
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

async function start(session = { portalUserId: 'u-session' }) {
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

const rate = (body, id = 'own-1') => post(body, `/api/portal/lp612/own/${id}/rating`);

test('relays rating and note as the session user, ignoring a body userId', async () => {
  botAnswer = { status: 200, data: { success: true } };
  await start();
  expect(await rate({ rating: 4, confusing: 'the We Do', userId: 'someone-else' })).toEqual({ status: 200, body: { success: true } });
  expect(botCalls).toEqual([{ url: 'http://bot/api/internal/lp612/own/own-1/rating', body: { userId: 'u-session', rating: 4, confusing: 'the We Do' } }]);
});

test('switched off for her: 404, the bot never asked', async () => {
  flags.portal_lp_make_own = false;
  await start();
  expect((await rate({ rating: 4 })).status).toBe(404);
  expect(botCalls).toEqual([]);
});

test('no rating: 400 before the bot', async () => {
  await start();
  expect((await rate({ confusing: 'x' })).status).toBe(400);
  expect(botCalls).toEqual([]);
});

test.each([[400, 400], [404, 404], [500, 502]])('bot %i -> %i', async (b, out) => {
  botAnswer = { status: b, data: { success: false } };
  await start();
  expect((await rate({ rating: 3 })).status).toBe(out);
});

test('a bot that cannot be reached: 502', async () => {
  botAnswer = new Error('ECONNREFUSED');
  await start();
  expect((await rate({ rating: 3 })).status).toBe(502);
});
