'use strict';
/**
 * The quiz page in the child's language (app_settings web_quiz_page_lang): default off, on only for the stored JSON
 * boolean true, read in the hub switches' one settings read (no read of its own). On, the quiz and hub answers say
 * `page_lang: true` (the hub's Videos links name the child's language; the edge opens the quiz page in it); off,
 * every answer is byte for byte the page module's own answer.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const KEY = 'web_quiz_page_lang';
let rows = [];
let settingsReads = 0;
let ownReads = 0;
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { t, key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { st.many = true; return b; },
        async maybeSingle() {
          if (t === 'app_settings') settingsReads += 1;
          if (t === 'app_settings' && st.key === KEY) ownReads += 1;
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) {
          if (t === 'app_settings') settingsReads += 1;
          if (t === 'app_settings' && st.key === KEY) ownReads += 1;
          return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej);
        },
      };
      return b;
    },
  });
}

let PageLang;
let Flags;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  settingsReads = 0;
  ownReads = 0;
  seed();
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
  PageLang = require('../../../shared/services/quiz/web-quiz-page-lang');
});

const OFF_VALUES = [['absent', undefined], ['the string true', 'true'], ['a quoted string', '"true"'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]];

describe('the switch rides the hub switches\' one read', () => {
  test('its key is in the hub read (KEYS), and asking for it makes no read of its own', async () => {
    expect(Flags.KEYS).toContain(KEY);
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    const n = settingsReads;
    expect(await PageLang.carry({ quiz: {} })).toEqual({ quiz: {}, page_lang: true });
    expect(settingsReads).toBe(n);
    expect(ownReads).toBe(0);
  });
  test('cold (no hub read yet): off, and no read', async () => {
    rows = [{ key: KEY, value: true }];
    expect(await PageLang.carry({ quiz: {} })).toEqual({ quiz: {} });
    expect(settingsReads).toBe(0);
  });
});

describe('on only for the JSON true', () => {
  test('JSON true: the answer (or its promise) says page_lang: true', async () => {
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    expect(await PageLang.carry(Promise.resolve({ a: 1 }))).toEqual({ a: 1, page_lang: true });
  });
  test.each(OFF_VALUES)('%s: the answer as it came, byte for byte', async (_n, value) => {
    rows = value === undefined ? [] : [{ key: KEY, value }];
    await Flags.flags();
    const body = { quiz: { lang: 'en' }, cls: {} };
    const out = await PageLang.carry(body);
    expect(JSON.stringify(out)).toBe(JSON.stringify({ quiz: { lang: 'en' }, cls: {} }));
  });
  test('a non-object answer passes through', async () => {
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    expect(await PageLang.carry(null)).toBeNull();
    expect(await PageLang.carry([1])).toEqual([1]);
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', lang: 'en', questions: [] }, cls: { label: 'Class 3' } };
const HUB = { lang: 'ur', kids: [{ kid: '0123456789abcdef', name: 'Noor Testwala' }], rt: false };

async function serve(fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const spies = [
    jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => JSON.parse(JSON.stringify(QUIZ))),
    jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(HUB))),
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const ask = async () => ({
    quiz: await (await fetch(`${base}/quiz/AB12CD`, { headers: h })).text(),
    hubGet: await (await fetch(`${base}/hub/abc.def`, { headers: h })).text(),
    hubPost: await (await fetch(`${base}/hub/abc.def`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).text(),
  });
  try { return await fn(ask); } finally { spies.forEach((s) => s.mockRestore()); await new Promise((r) => server.close(r)); }
}
// The OFF golden: each page module's own answer, as the route sent it before this switch.
const GOLDEN = { quiz: JSON.stringify(QUIZ), hubGet: JSON.stringify(HUB), hubPost: JSON.stringify(HUB) };

describe('the routes', () => {
  test('on: the quiz and hub (GET and POST) answers say page_lang: true, and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) {
        expect([k, JSON.parse(out[k]).page_lang]).toEqual([k, true]);
        expect(out[k].replace(/,"page_lang":true/, '')).toBe(GOLDEN[k]);
      }
    });
    expect(ownReads).toBe(0);
  });
  test.each(OFF_VALUES)('%s: every answer byte for byte the OFF golden', async (_n, value) => {
    rows = value === undefined ? [] : [{ key: KEY, value }];
    await Flags.flags();
    await serve(async (ask) => {
      expect(await ask()).toEqual(GOLDEN);
    });
  });
});
