'use strict';
/**
 * bd-snkn32.42 — the portal's shelf and human-check doors (dashboard/routes/portal-lp612-shelf.routes.js).
 *   GET  /lp612/shelf?keys=            — teacher; portal_teacher_v2 AND portal_lp_own_shelf, else 404
 *   GET  /lp612/own/review             — staff on the list-only portal_lp_own_reviewers, else 404
 *   POST /lp612/own/review/:ownId      — same; the reviewer is ALWAYS the session user
 *   GET  /lp612/own/review/:ownId/file — same; the PDF relayed like every lesson plan
 * Fields are whitelisted (never an author id); the bot failing is a 502.
 */
const http = require('http');
const express = require('express');

const ENV = { ...process.env };
let flags;
let listed;
let botCalls;
let botAnswer;
let relayed;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'http://bot', INTERNAL_API_KEY: 'k' };
  flags = { portal_teacher_v2: true, portal_lp_own_shelf: true };
  listed = { portal_lp_own_reviewers: ['u-session'] };
  botCalls = [];
  botAnswer = { status: 200, data: { success: true, plans: [] } };
  relayed = [];
  jest.doMock('../../dashboard/config/supabase', () => ({}));
  jest.doMock('../../dashboard/lib/portal-auth', () => ({
    requirePortalAuth: (req, res, next) => (req.session && req.session.portalUserId ? next() : res.status(401).json({})),
  }));
  jest.doMock('../../dashboard/lib/teacher-app', () => ({ teacherAppOnFor: async (_s, key) => flags[key] === true }));
  jest.doMock('../../dashboard/lib/feature-flags', () => ({
    PORTAL_TEACHER_V2_KEY: 'portal_teacher_v2',
    PORTAL_LP_OWN_SHELF_KEY: 'portal_lp_own_shelf',
    PORTAL_LP_OWN_REVIEWERS_KEY: 'portal_lp_own_reviewers',
    isFlagEnabledForUser: async (_s, key) => flags[key] === true,
    isUserListedInFlag: async (_s, key, id) => (listed[key] || []).includes(id),
  }));
  jest.doMock('../../dashboard/lib/lesson-plan-file', () => ({
    relayLessonPlanPdf: async (url, res) => { relayed.push(url); res.type('application/pdf').send('PDF'); },
  }));
  const bot = (method) => async (url, a, b) => {
    const opts = method === 'post' ? b : a;
    botCalls.push({ method, url, opts, body: method === 'post' ? a : undefined });
    if (botAnswer instanceof Error) throw botAnswer;
    return botAnswer;
  };
  jest.doMock('axios', () => ({ get: bot('get'), post: bot('post') }));
});
afterAll(() => { process.env = ENV; });

let srv;
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

async function start(session = { portalUserId: 'u-session' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.session = session; next(); });
  a.use('/api/portal', require('../../dashboard/routes/portal-lp612-shelf.routes'));
  srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
}

const call = (method, path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : '';
  const req = http.request({
    host: '127.0.0.1', port: srv.address().port, path, method, agent: false, headers: { 'Content-Type': 'application/json' },
  }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => { let b = null; try { b = s ? JSON.parse(s) : null; } catch { b = s; } resolve({ status: res.statusCode, body: b, type: res.headers['content-type'] }); });
  });
  req.on('error', reject);
  req.end(data);
});

describe('the shelf', () => {
  test('passes the chapter lesson keys and returns only the shelf fields', async () => {
    botAnswer = { status: 200, data: { success: true, plans: [{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en', userId: 'u9', answers: {} }] } };
    await start();
    const r = await call('GET', '/api/portal/lp612/shelf?keys=L1,L2');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, plans: [{ ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en' }] });
    expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/shelf');
    expect(botCalls[0].opts.params).toEqual({ keys: 'L1,L2' });
    expect(botCalls[0].opts.headers['x-api-key']).toBe('k');
  });

  test('dark when the shelf flag or the teacher app is off: 404, the bot never asked', async () => {
    flags.portal_lp_own_shelf = false;
    await start();
    expect((await call('GET', '/api/portal/lp612/shelf?keys=L1')).status).toBe(404);
    flags.portal_lp_own_shelf = true;
    flags.portal_teacher_v2 = false;
    expect((await call('GET', '/api/portal/lp612/shelf?keys=L1')).status).toBe(404);
    expect(botCalls).toHaveLength(0);
  });

  test('no keys 400; signed out 401; bot down 502', async () => {
    await start();
    expect((await call('GET', '/api/portal/lp612/shelf')).status).toBe(400);
    botAnswer = new Error('ECONNREFUSED');
    expect((await call('GET', '/api/portal/lp612/shelf?keys=L1')).status).toBe(502);
    await new Promise((r) => srv.close(r));
    await start({});
    expect((await call('GET', '/api/portal/lp612/shelf?keys=L1')).status).toBe(401);
  });
});

describe('the human check', () => {
  test('only a listed reviewer: anyone else 404, the bot never asked', async () => {
    await start({ portalUserId: 'teacher-x' });
    expect((await call('GET', '/api/portal/lp612/own/review')).status).toBe(404);
    expect((await call('POST', '/api/portal/lp612/own/review/o1', { decision: 'approve' })).status).toBe(404);
    expect((await call('GET', '/api/portal/lp612/own/review/o1/file')).status).toBe(404);
    expect(botCalls).toHaveLength(0);
  });

  test('the queue, whitelisted', async () => {
    const plan = { ownId: 'o1', lesson: 'L1', band: 'k5', lang: 'en', score: 86, reviewedAt: 't', below: [{ id: '6B', name: 'n', rating: 2 }], notAssessed: ['2I'], userId: 'u9' };
    botAnswer = { status: 200, data: { success: true, plans: [plan] } };
    await start();
    const r = await call('GET', '/api/portal/lp612/own/review');
    const { userId: _u, ...clean } = plan;
    expect(r.body).toEqual({ success: true, plans: [clean] });
    expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/review');
  });

  test('a decision: the reviewer is the session user, never the body', async () => {
    botAnswer = { status: 200, data: { success: true, decision: 'approved' } };
    await start();
    const r = await call('POST', '/api/portal/lp612/own/review/o1', { decision: 'approve', reason: 'ok', reviewerId: 'forged' });
    expect(r).toMatchObject({ status: 200, body: { success: true, decision: 'approved' } });
    expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/review/o1');
    expect(botCalls[0].body).toEqual({ reviewerId: 'u-session', decision: 'approve', reason: 'ok' });
  });

  test('the bot\'s 400 and 404 pass on; anything else 502', async () => {
    await start();
    for (const s of [400, 404]) {
      botAnswer = { status: s, data: { success: false } };
      expect((await call('POST', '/api/portal/lp612/own/review/o1', { decision: 'approve' })).status).toBe(s);
    }
    botAnswer = { status: 500, data: {} };
    expect((await call('POST', '/api/portal/lp612/own/review/o1', { decision: 'approve' })).status).toBe(502);
    expect((await call('GET', '/api/portal/lp612/own/review')).status).toBe(502);
  });

  test('the PDF: relayed from the bot\'s fresh link; not reviewable 404', async () => {
    botAnswer = { status: 200, data: { success: true, url: 'https://signed/x.pdf' } };
    await start();
    const r = await call('GET', '/api/portal/lp612/own/review/o1/file');
    expect(r.status).toBe(200);
    expect(r.type).toMatch(/pdf/);
    expect(relayed).toEqual(['https://signed/x.pdf']);
    botAnswer = { status: 404, data: { success: false } };
    expect((await call('GET', '/api/portal/lp612/own/review/o1/file')).status).toBe(404);
  });
});
