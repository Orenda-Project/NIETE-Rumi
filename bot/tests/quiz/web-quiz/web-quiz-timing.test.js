'use strict';
/**
 * Where the web quiz's server time goes: every /api/internal/wq route logs how long it took and how many
 * database round trips it made (web_quiz.timing {route, ms, db}) — always when slow, sampled otherwise —
 * so a 3-second "start the next lesson" can be attributed to round trips or to work. Counting happens only
 * inside a web-quiz request; every other caller of the shared client is untouched.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const { logEvent } = require('../../../shared/utils/structured-logger');

let server; let base; let Timing;
beforeAll(async () => {
  process.env.INTERNAL_API_KEY = 'route-key';
  const fake = makeFake({ quiz_share_codes: [{ id: 'sc-x', code: 'EXPD01', quiz_id: 'q', teacher_user_id: 't', language: 'ur', active: false }] });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  Timing = require('../../../shared/services/quiz/web-quiz-timing');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { logEvent.mockClear(); Timing.setSample(1); });

const KEY = { 'x-api-key': 'route-key', 'content-type': 'application/json' };
const timings = () => logEvent.mock.calls.filter((c) => c[0] === 'web_quiz.timing').map((c) => c[1]);

test('a web-quiz route logs its time and its database round trips, by route pattern (never the code)', async () => {
  const r = await fetch(`${base}/quiz/EXPD01`, { headers: KEY });
  expect(r.status).toBe(410);
  const t = timings();
  expect(t).toHaveLength(1);
  expect(t[0]).toEqual({ route: '/quiz/:code', status: 410, ms: expect.any(Number), db: expect.any(Number) });
  expect(t[0].db).toBeGreaterThanOrEqual(1);
  expect(JSON.stringify(t[0])).not.toContain('EXPD01');
});

test('outside a web-quiz request the shared client is not counted and behaves exactly as before', () => {
  const q = supabase.from('quiz_share_codes');
  expect(typeof q.select).toBe('function');
  expect(Timing.peek()).toBeNull();
});

test('fast requests are sampled; slow ones are always logged', async () => {
  Timing.setSample(0);
  await Timing.run('/x', async () => { supabase.from('quizzes'); return { status: 200 }; });
  expect(timings()).toHaveLength(0);
  await Timing.run('/slow', async () => { supabase.from('quizzes'); supabase.from('quiz_sessions'); await new Promise((r) => setTimeout(r, Timing.SLOW_MS + 20)); });
  expect(timings()).toEqual([expect.objectContaining({ route: '/slow', db: 2 })]);
});
