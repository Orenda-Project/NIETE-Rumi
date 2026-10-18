'use strict';
/**
 * app_settings web_quiz_juice: the switch the sound + motion kit rides on (default off, fail closed, cached 30 s),
 * and the bot's answer to the edge for the kit's demo page (GET /api/internal/wq/juice → {on}).
 */
jest.mock('../../../shared/config/supabase', () => {
  const state = { rows: [], fail: false, reads: 0 };
  const q = { select: () => q, eq: () => q, maybeSingle: async () => { state.reads += 1; return state.fail ? { data: null, error: { message: 'boom' } } : { data: state.rows[0] || null, error: null }; } };
  return { from: () => q, __state: state };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const supabase = require('../../../shared/config/supabase');
const Juice = require('../../../shared/services/quiz/web-quiz-juice');

describe('web_quiz_juice', () => {
  beforeEach(() => { Juice._reset(); supabase.__state.rows = []; supabase.__state.fail = false; });
  test('absent → off; field() → null', async () => { expect(await Juice.flag()).toBe(false); expect(await Juice.field()).toBeNull(); });
  test.each([[true]])('%p (JSON true only) → on; field() → true', async (v) => {
    supabase.__state.rows = [{ key: Juice.KEY, value: v }];
    expect(await Juice.flag()).toBe(true);
    expect(await Juice.field()).toBe(true);
  });
  test.each([[false], ['false'], ['yes'], [1], [{ enabled: true }], ['true'], [' TRUE '], ['"true"']])('%p → off (a string \'true\' row is off)', async (v) => {
    supabase.__state.rows = [{ key: Juice.KEY, value: v }];
    expect(await Juice.flag()).toBe(false);
  });
  test('a db error fails closed and is cached', async () => {
    supabase.__state.fail = true; expect(await Juice.flag()).toBe(false);
    supabase.__state.fail = false; supabase.__state.rows = [{ key: Juice.KEY, value: true }];
    expect(await Juice.flag()).toBe(false);
    expect(await Juice.flag(Date.now() + 31000)).toBe(true);
  });
  test('the key is the documented one', () => expect(Juice.KEY).toBe('web_quiz_juice'));
});

describe('GET /api/internal/wq/juice (the demo page asks)', () => {
  const express = require('express');
  let server; let base;
  beforeAll(async () => {
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  beforeEach(() => { Juice._reset(); supabase.__state.rows = []; });

  test('needs the key', async () => { expect((await fetch(`${base}/juice`)).status).toBe(401); });
  test('off → {on:false}; on → {on:true}', async () => {
    const H = { headers: { 'x-api-key': 'route-key' } };
    expect(await (await fetch(`${base}/juice`, H)).json()).toEqual({ on: false });
    supabase.__state.rows = [{ key: 'web_quiz_juice', value: true }];
    Juice._reset();
    expect(await (await fetch(`${base}/juice`, H)).json()).toEqual({ on: true });
  });
});
