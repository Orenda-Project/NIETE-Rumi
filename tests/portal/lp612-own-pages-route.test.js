'use strict';
/**
 * bd-snkn32.19 (spec item 13) — GET /api/portal/lp612/own/pages (dashboard/routes/portal-lp612-own.routes.js): her
 * book's page text for "Make my own", relayed from the bot. Behind the teacher session and the make-own flags (404,
 * the bot never asked). Real Express over HTTP; flags, auth and the bot stubbed.
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
  botAnswer = { status: 200, data: { success: true, loaded: true, pages: [{ page: 42, text: 'Force' }], missing: [43] } };
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
    post: async () => { throw new Error('not here'); },
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

const get = (query) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal/lp612/own/pages?${query}`, agent: false }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  }).on('error', reject);
});

test('not signed in: 401, the bot never asked', async () => {
  await start(null);
  expect((await get('lesson_id=l&from=1&to=2')).status).toBe(401);
  expect(botCalls).toEqual([]);
});

test('flag off: 404, the bot never asked', async () => {
  flags.portal_lp_make_own = false;
  await start();
  expect((await get('lesson_id=l&from=1&to=2')).status).toBe(404);
  expect(botCalls).toEqual([]);
});

test('passes the day and range to the bot with the internal key; her pages back', async () => {
  await start();
  const out = await get('lesson_id=g3_maths_d4&from=42&to=43&evil=1');
  expect(out).toEqual({ status: 200, body: { success: true, loaded: true, pages: [{ page: 42, text: 'Force' }], missing: [43] } });
  expect(botCalls).toHaveLength(1);
  expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/pages');
  expect(botCalls[0].opts.params).toEqual({ lesson_id: 'g3_maths_d4', from: '42', to: '43' });
  expect(botCalls[0].opts.headers['x-api-key']).toBe('k');
});

test('a segment with no range; a book not loaded passes on as loaded false', async () => {
  botAnswer = { status: 200, data: { success: true, loaded: false, pages: [], missing: [] } };
  await start();
  const out = await get('segment_id=grade_8_science.c01.p001-003');
  expect(out.body).toEqual({ success: true, loaded: false, pages: [], missing: [] });
  expect(botCalls[0].opts.params).toEqual({ segment_id: 'grade_8_science.c01.p001-003' });
});

test('no lesson or segment, or both: 400 before the bot', async () => {
  await start();
  expect((await get('from=1&to=2')).status).toBe(400);
  expect((await get('lesson_id=l&segment_id=s')).status).toBe(400);
  expect(botCalls).toEqual([]);
});

test.each([[400, 400], [404, 404], [500, 502]])('bot %i → %i', async (botStatus, status) => {
  botAnswer = { status: botStatus, data: { success: false } };
  await start();
  const out = await get('lesson_id=l&from=1&to=2');
  expect(out.status).toBe(status);
  expect(out.body.pages).toBeUndefined();
});

test('a bot that cannot be reached is 502', async () => {
  botAnswer = new Error('ECONNREFUSED');
  await start();
  expect((await get('lesson_id=l&from=1&to=2')).status).toBe(502);
});

test('only page numbers and text pass on, whatever else the bot sends', async () => {
  botAnswer = { status: 200, data: { success: true, loaded: true, pages: [{ page: 1, text: 'a', secret: 'x' }], missing: [2], debug: 'y' } };
  await start();
  expect((await get('lesson_id=l&from=1&to=2')).body).toEqual({ success: true, loaded: true, pages: [{ page: 1, text: 'a' }], missing: [2] });
});

// bd-snkn32.19 — the contract with the portal: fetchBookPages (portal own/api.ts) sends exactly these params.
test('the portal\'s own params pass the relay: segment_id (6–12) or lesson_id (1–5), with from and to', async () => {
  await start();
  const seg = await get('segment_id=sci8.c02.p042&from=42&to=43');
  expect(seg.status).toBe(200);
  expect(botCalls[0].opts.params).toEqual({ segment_id: 'sci8.c02.p042', from: '42', to: '43' });
  const day = await get('lesson_id=g3-eng-d12&from=7&to=7');
  expect(day.status).toBe(200);
  expect(botCalls[1].opts.params).toEqual({ lesson_id: 'g3-eng-d12', from: '7', to: '7' });
  // The old shape (grade, subject, lesson) is refused, which is why the strip never showed.
  expect((await get('grade=8&subject=Science&lesson=sci8.c02.p042&from=42&to=43')).status).toBe(400);
});

describe('GET /api/portal/lp612/own/:ownId/sections (spec item 7)', () => {
  const sections = (ownId) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: `/api/portal/lp612/own/${ownId}/sections?userId=evil`, agent: false }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    }).on('error', reject);
  });

  test('asks the bot for HER plan (the session user, never the query) and passes only the cards on', async () => {
    botAnswer = { status: 200, data: { success: true, band: 'k5', changed: 'we_do', extra: 1,
      sections: [{ part: 'we_do', text: 'Game', before: 'Count', x: 2 }, { part: 'hook', text: 'Sing' }] } };
    await start();
    const out = await sections('own-1');
    expect(out).toEqual({ status: 200, body: { success: true, band: 'k5', changed: 'we_do',
      sections: [{ part: 'we_do', text: 'Game', before: 'Count' }, { part: 'hook', text: 'Sing' }] } });
    expect(botCalls[0].url).toBe('http://bot/api/internal/lp612/own/own-1/sections');
    expect(botCalls[0].opts.params).toEqual({ userId: 'u-session' });
    expect(botCalls[0].opts.headers['x-api-key']).toBe('k');
  });
  test('behind the session and the flags; bot 404 passes on, anything else is 502', async () => {
    await start(null);
    expect((await sections('own-1')).status).toBe(401);
    await new Promise((r) => srv.close(r));
    flags.portal_lp_make_own = false;
    await start();
    expect((await sections('own-1')).status).toBe(404);
    expect(botCalls).toEqual([]);
    await new Promise((r) => srv.close(r));
    flags.portal_lp_make_own = true;
    await start();
    botAnswer = { status: 404, data: { success: false } };
    expect((await sections('own-1')).status).toBe(404);
    botAnswer = { status: 500, data: {} };
    expect((await sections('own-1')).status).toBe(502);
  });
});
