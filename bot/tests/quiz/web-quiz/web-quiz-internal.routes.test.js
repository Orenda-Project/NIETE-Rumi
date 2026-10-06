'use strict';
/**
 * The bot side of the web quiz over HTTP: mounted at /api/internal/wq behind
 * the existing x-api-key check, service errors mapped to their status codes.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');

let server; let base;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const fake = makeFake({ quiz_share_codes: [{ id: 'sc-x', code: 'EXPD01', quiz_id: 'q', teacher_user_id: 't', language: 'ur', active: false }] });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };

test('no key or a wrong key: 401, the service never runs', async () => {
  expect((await fetch(`${base}/quiz/EXPD01`)).status).toBe(401);
  expect((await fetch(`${base}/quiz/EXPD01`, { headers: { 'x-api-key': 'nope' } })).status).toBe(401);
});

test('service errors keep their status and body', async () => {
  const gone = await fetch(`${base}/quiz/EXPD01`, { headers: KEY });
  expect(gone.status).toBe(410);
  expect(await gone.json()).toEqual({ error: 'expired', lang: 'ur' });
  expect((await fetch(`${base}/quiz/NOPE99`, { headers: KEY })).status).toBe(404);
  const bad = await fetch(`${base}/answers`, { method: 'POST', headers: KEY, body: JSON.stringify({ st: 'x', a: [] }) });
  expect(bad.status).toBe(401);
});

test('events: 204 and logged', async () => {
  const r = await fetch(`${base}/e`, { method: 'POST', headers: KEY, body: JSON.stringify({ events: [{ n: 'm3_view', lang: 'en' }] }) });
  expect(r.status).toBe(204);
  expect(logEvent).toHaveBeenCalledWith('web_quiz.m3_view', { lang: 'en' });
});

test("the teacher's who-played routes are mounted and keep the service's refusals", async () => {
  // An expired code answers 410 before any token check: the route reached the service.
  const who = await fetch(`${base}/who`, { method: 'POST', headers: KEY, body: JSON.stringify({ code: 'EXPD01', p: 'x' }) });
  expect(who.status).toBe(410);
  const fix = await fetch(`${base}/who/fix`, { method: 'POST', headers: KEY, body: JSON.stringify({ code: 'EXPD01', p: 'x', ref: 's', roll: 1 }) });
  expect(fix.status).toBe(410);
  const bind = await fetch(`${base}/who/class`, { method: 'POST', headers: KEY, body: JSON.stringify({ code: 'EXPD01', p: 'x', key: 'k' }) });
  expect(bind.status).toBe(410);
});

test('"watch another video": list and start are mounted behind the key, service errors keep their status', async () => {
  expect((await fetch(`${base}/videos/EXPD01`)).status).toBe(401);
  const gone = await fetch(`${base}/videos/EXPD01`, { headers: KEY });
  expect(gone.status).toBe(410);
  const bad = await fetch(`${base}/videos/start`, { method: 'POST', headers: KEY, body: JSON.stringify({ code: 'NOPE99', st: 'x', vid: 'y' }) });
  expect(bad.status).toBe(404);
});

test('peer pulse: GET /pulse/:code is mounted behind the key and refuses a forged token', async () => {
  expect((await fetch(`${base}/pulse/EXPD01?st=x`)).status).toBe(401);
  const forged = await fetch(`${base}/pulse/EXPD01?st=forged&since=0`, { headers: KEY });
  expect(forged.status).toBe(401);
  expect(await forged.json()).toEqual({ error: 'bad_token' });
  const T = require('../../../shared/services/quiz/web-quiz-token');
  const st = T.signSession({ sessionId: 's-1', deviceRef: 'd', shareCodeId: 'sc-x' });
  // A genuine token reaches the code lookup: this code is closed, so 410 like every other endpoint.
  expect((await fetch(`${base}/pulse/EXPD01?st=${encodeURIComponent(st)}&since=0`, { headers: KEY })).status).toBe(410);
});
