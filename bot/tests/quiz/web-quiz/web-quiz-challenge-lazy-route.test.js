'use strict';
/**
 * The Challenge module itself absent (a promotion that did not carry web-quiz-challenge.js): the internal web-quiz
 * router still loads and serves the quiz; every Challenge route answers a named 503 {error:'unavailable'}.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/services/quiz/web-quiz-challenge', () => {
  const e = new Error("Cannot find module './web-quiz-challenge'"); e.code = 'MODULE_NOT_FOUND'; throw e;
});

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');

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
afterAll(() => new Promise((r) => (server ? server.close(r) : r())));

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };

test('the router loads and the quiz still answers', async () => {
  expect((await fetch(`${base}/quiz/EXPD01`, { headers: KEY })).status).toBe(410);
});

test.each([
  ['GET', '/ch/tok'],
  ['GET', '/ch/tok/bigger'],
  ['GET', '/ch/result/ct'],
  ['POST', '/ch/upload'],
  ['POST', '/ch/result'],
  ['GET', '/challenge/results?list=a0000000-0000-4000-8000-00000000003b'],
])('%s %s answers 503 unavailable', async (method, path) => {
  const r = await fetch(`${base}${path}`, { method, headers: KEY, body: method === 'POST' ? '{}' : undefined });
  expect(r.status).toBe(503);
  expect(await r.json()).toEqual({ error: 'unavailable' });
});
