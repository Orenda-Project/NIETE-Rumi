'use strict';
/**
 * app_settings web_quiz_fold_retry: the folded end card (the child home) offers a 0-word read one way to read again.
 * The server's part is one menu field, {fold_retry: true}, with the key literally true; anything else: no field, so
 * the Jugnu page's menu is today's, byte for byte.
 */
process.env.INTERNAL_API_KEY = 'route-key';
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const express = require('express');
const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const Ch = require('../../../shared/services/quiz/web-quiz-challenge');

const FR = () => require('../../../shared/services/quiz/web-quiz-fold-retry');

let server; let base;
let settings = [];
const reads = { n: 0 };
beforeAll(async () => {
  const fake = makeFake({});
  Object.assign(supabase, {
    from: (t) => {
      if (t !== 'app_settings') return fake.from(t);
      reads.n += 1;
      return { select: () => ({ eq: (_k, key) => Promise.resolve({ data: settings.filter((r) => r.key === key), error: null }) }) };
    },
    rpc: fake.rpc,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { FR()._reset(); reads.n = 0; });
afterEach(() => jest.restoreAllMocks());

const MENU = { lang: 'en', exercises: [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null }] };
const menu = async () => {
  jest.spyOn(Ch, 'menu').mockImplementation(async () => JSON.parse(JSON.stringify(MENU)));
  const r = await fetch(`${base}/ch/HUB.TOKEN`, { headers: { 'x-api-key': 'route-key' } });
  return r.json();
};

describe('the switch reads strictly: only the JSON true is on', () => {
  test.each([['absent', null], ['false', false], ['the string "true"', 'true'], ['1', 1], ['{}', {}]])('%s: no field; the menu is today\'s', async (_n, value) => {
    settings = value === null ? [] : [{ key: 'web_quiz_fold_retry', value }];
    expect(await FR().menuField()).toEqual({});
    expect(await menu()).not.toHaveProperty('fold_retry');
  });
  test('the JSON true: {fold_retry: true} on the Jugnu page\'s menu', async () => {
    settings = [{ key: 'web_quiz_fold_retry', value: true }];
    expect(await FR().menuField()).toEqual({ fold_retry: true });
    expect((await menu()).fold_retry).toBe(true);
  });
  test('a failed settings read is off, never on', async () => {
    const from = supabase.from;
    supabase.from = () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'down' } }) }) });
    try { expect(await FR().on()).toBe(false); expect(await FR().menuField()).toEqual({}); } finally { supabase.from = from; }
  });
  test('one settings read per 30 s, whatever the key holds (absent, false, the string "true")', async () => {
    for (const s of [[], [{ key: 'web_quiz_fold_retry', value: false }], [{ key: 'web_quiz_fold_retry', value: 'true' }]]) {
      settings = s; FR()._reset(); reads.n = 0;
      await FR().on(); await FR().on(); await FR().menuField();
      expect(reads.n).toBe(1);
    }
  });
});
