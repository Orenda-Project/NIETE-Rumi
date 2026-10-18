'use strict';
/**
 * The join page's shell answer (GET /join/page/:token) and the one-face switch (app_settings web_quiz_one_face): on, an
 * ok or stale answer says `one_face: true`; off (anything but the JSON boolean true), the answer is byte for byte the
 * join module's own. The key rides the join's one grouped settings read (the real join module over the fake database):
 * the route makes the same number of app_settings round trips as before the key existed.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_one_face';
const BOT_NO = ['92', '000', '0000', '100'].join('');
const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null], ['no row', undefined]];
const BASE = { quiz_student_join: true, web_quiz_hub: true };
const stale = (c) => c.ask({ stale: true });

describe('GET /join/page/:token', () => {
  test('on: the ok answer says one_face: true and nothing else changes', async () => {
    await realRoute({ ...BASE, [KEY]: true }, async (c) => {
      const out = await c.ask();
      expect(out.status).toBe(200);
      expect(out.body.one_face).toBe(true);
      const { one_face: _f, ...rest } = out.body;
      expect(rest).toEqual({ ok: true, lang: 'ur', practice: false });
    });
  });

  test('on: the stale answer says one_face: true too, and nothing else changes', async () => {
    await realRoute({ ...BASE, [KEY]: true }, async (c) => {
      const out = await stale(c);
      expect(out.status).toBe(410);
      expect(out.body).toEqual({ error: 'stale', lang: 'ur', one_face: true });
    });
  });

  test('on: the join switch off (404) stays the 404, with no field', async () => {
    await realRoute({ quiz_student_join: false, [KEY]: true }, async (c) => {
      const out = await c.ask();
      expect(out.status).toBe(404);
      expect(out.body).toEqual({ error: 'off' });
    });
  });

  test.each(OFF_VALUES)('%s: every answer is byte for byte the OFF golden', async (_n, value) => {
    const settings = { ...BASE };
    if (value !== undefined) settings[KEY] = value;
    await realRoute(settings, async (c) => {
      expect((await c.ask()).body).toEqual({ ok: true, lang: 'ur', practice: false });
      expect((await stale(c)).body).toEqual({ error: 'stale', lang: 'ur' });
    });
  });

  test('a failed settings read is the OFF golden too (the join switch off as well)', async () => {
    await realRoute({ ...BASE, [KEY]: true }, async (c) => {
      c.failReads();
      expect((await c.ask()).status).toBe(404);
    });
  });
});

// The real join module over the fake database: the key rides the join's one grouped settings read, never a read of its own.
async function realRoute(settings, fn) {
  jest.resetModules();
  const { makeFake } = require('./fake-supabase');
  const supabase = require('../../../shared/config/supabase');
  const fake = makeFake({ app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })) });
  let reads = 0;
  let fail = false;
  supabase.from = (t) => {
    if (t === 'app_settings') reads += 1;
    if (t === 'app_settings' && fail) { const dead = { select: () => dead, eq: () => dead, in: () => dead, maybeSingle: async () => ({ data: null, error: { message: 'down' } }), then: (res) => res({ data: null, error: { message: 'down' } }) }; return dead; }
    return fake.from(t);
  };
  process.env.INTERNAL_API_KEY = 'route-key';
  const T = require('../../../shared/services/quiz/web-quiz-token');
  const tok = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) + 600 });
  const old = T.sign({ k: 'j', n: T.newNonce(), l: 'ur', exp: Math.floor(Date.now() / 1000) - 600 });
  const express = require('express');
  const app = express(); app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const ask = async (o = {}) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/join/page/${o.stale ? old : tok}`, { headers: { 'x-api-key': 'route-key' } }); return { status: r.status, body: JSON.parse(await r.text()) }; };
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const real = Date.now; let shift = 0; Date.now = () => real() + shift;
  try { return await fn({ ask, settle, failReads: () => { fail = true; }, reads: () => reads, resetReads: () => { reads = 0; }, advance: (ms) => { shift += ms; } }); } finally { Date.now = real; await new Promise((r) => server.close(r)); }
}

describe('settings round trips on the join page route (real join module)', () => {
  test.each([['key absent', undefined], ['key false', false], ['key true', true]])('%s: cold cache makes 4 app_settings round trips (as on base), warm 0, expired 4', async (_n, v) => {
    const settings = { quiz_student_join: true, web_quiz_hub: true };
    if (v !== undefined) settings[KEY] = v;
    await realRoute(settings, async (c) => {
      c.resetReads(); await c.ask(); await c.settle(); expect(c.reads()).toBe(4);
      c.resetReads(); await c.ask(); await c.settle(); expect(c.reads()).toBe(0);
      c.advance(31000);
      c.resetReads(); await c.ask(); await c.settle(); expect(c.reads()).toBe(4);
    });
  });
});
