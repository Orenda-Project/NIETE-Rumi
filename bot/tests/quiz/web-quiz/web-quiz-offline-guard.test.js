'use strict';
/**
 * A tap while offline stays on the page (app_settings web_quiz_offline_guard): default off, on only for the stored
 * JSON boolean true, 30 s cache, fail off, never waited for. On, the hub (GET and POST), challenge menu and quiz answers
 * say `offline_guard: true` (how a flip is checked: the hub answer's field); off, every answer is byte for byte the
 * page module's own answer (the step adds nothing). An error answer never gets the field.
 *
 * Supabase and the loggers are the boundaries. The route tests stand in the page modules' answers (getQuiz, hub, menu)
 * so the bytes compared are exactly what the route adds.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_offline_guard';
let rows = [];
let fail = false;
let settingsReads = 0;
// app_settings only: what the switch reads (the route tests' page modules are stood in).
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { t, key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { return b; },
        async maybeSingle() {
          if (t === 'app_settings') settingsReads += 1;
          if (fail) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) { return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

let Guard;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  fail = false;
  settingsReads = 0;
  seed();
  Guard = require('../../../shared/services/quiz/web-quiz-offline-guard');
});

const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]];

describe('the switch', () => {
  test('JSON true: on', async () => {
    rows = [{ key: KEY, value: true }];
    expect(await Guard.flag()).toBe(true);
    expect(Guard.on()).toBe(true);
  });

  test.each(OFF_VALUES)('%s: off', async (_n, value) => {
    rows = [{ key: KEY, value }];
    expect(await Guard.flag()).toBe(false);
    expect(Guard.on()).toBe(false);
  });

  test('no row: off', async () => {
    expect(await Guard.flag()).toBe(false);
    expect(Guard.on()).toBe(false);
  });

  test('a failed read: off, and off stays cached for 30 s', async () => {
    rows = [{ key: KEY, value: true }];
    fail = true;
    expect(await Guard.flag()).toBe(false);
    expect(Guard.on()).toBe(false);
    fail = false;
    expect(Guard.on()).toBe(false);
    expect(settingsReads).toBe(1);
  });

  test('never waited for: the first answer after a start is off, the next one (read in the background) on', async () => {
    rows = [{ key: KEY, value: true }];
    expect(Guard.on()).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(Guard.on()).toBe(true);
    expect(settingsReads).toBe(1);
  });

  test('30 s cache: no read inside it, one background read after it; a flip lands on the next answer', async () => {
    rows = [{ key: KEY, value: true }];
    const t0 = Date.now();
    await Guard.flag(t0);
    expect(settingsReads).toBe(1);
    for (let i = 0; i < 5; i += 1) expect(Guard.on(t0 + 29 * 1000)).toBe(true);
    expect(settingsReads).toBe(1);
    rows = [{ key: KEY, value: false }];
    // stale: the cached value answers at once, the refresh runs behind it
    expect(Guard.on(t0 + 31 * 1000)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(settingsReads).toBe(2);
    expect(Guard.on()).toBe(false);
  });

  test('a value older than twice the cache time is off (a refresh that never comes back cannot keep it on)', async () => {
    rows = [{ key: KEY, value: true }];
    const t0 = Date.now();
    await Guard.flag(t0);
    // every read from here hangs
    require('../../../shared/config/supabase').from = () => ({ select() { return this; }, eq() { return this; }, maybeSingle: () => new Promise(() => {}) });
    expect(Guard.on(t0 + 59 * 1000)).toBe(true);
    expect(Guard.on(t0 + 61 * 1000)).toBe(false);
  });

  test('the hub\'s one settings read: its rows fill this cache by the same rule (true on; anything else, or no row, off)', () => {
    const now = Date.now();
    expect(Guard.hubSwitches.keys).toEqual([KEY]);
    expect(Guard.hubSwitches.age(now)).toBe('cold');
    Guard.hubSwitches.prime([{ key: 'web_quiz_fast', value: true }, { key: KEY, value: true }], now);
    expect(Guard.hubSwitches.age(now)).toBe('fresh');
    expect(Guard.on(now)).toBe(true);
    Guard.hubSwitches.prime([{ key: KEY, value: 'true' }], now);
    expect(Guard.on(now)).toBe(false);
    Guard.hubSwitches.prime([], now);
    expect(Guard.on(now)).toBe(false);
    expect(Guard.hubSwitches.age(now + 31 * 1000)).toBe('stale');
    expect(settingsReads).toBe(0);
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', lang: 'ur', questions: [] }, cls: { label: 'Class 3' }, ui: { ur2: true }, fast: true };
const HUB = { lang: 'ur', kids: [{ kid: '0123456789abcdef', name: 'Test Child' }], rt: false, fast: true };
const MENU = { lang: 'ur', exercises: [], rt: false };

async function serve(fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const C = require('../../../shared/services/quiz/web-quiz-challenge');
  const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
  const spies = [
    jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => JSON.parse(JSON.stringify(QUIZ))),
    jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(HUB))),
    jest.spyOn(C, 'menu').mockImplementation(async () => JSON.parse(JSON.stringify(MENU))),
    jest.spyOn(CardImage, 'field').mockResolvedValue({}),
    jest.spyOn(require('../../../shared/services/quiz/web-quiz-hub-door'), 'menuFoldField').mockResolvedValue({}),
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
    menu: await (await fetch(`${base}/ch/abc.def`, { headers: h })).text(),
  });
  try { return await fn(ask); } finally { spies.forEach((s) => s.mockRestore()); await new Promise((r) => server.close(r)); }
}
// The OFF golden: each page module's own answer, as the route sent it before this switch.
const GOLDEN = { quiz: JSON.stringify(QUIZ), hubGet: JSON.stringify(HUB), hubPost: JSON.stringify(HUB), menu: JSON.stringify(MENU) };

describe('the routes', () => {
  test('on: the quiz, hub (GET and POST) and challenge menu answers say offline_guard: true, and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await Guard.flag();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) {
        expect(JSON.parse(out[k]).offline_guard).toBe(true);
        expect(out[k].replace(/,"offline_guard":true/, '')).toBe(GOLDEN[k]);
      }
    });
  });

  test.each([...OFF_VALUES, ['no row', undefined], ['a failed read', 'FAIL']])('%s: every answer byte for byte the OFF golden', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await Guard.flag();
    await serve(async (ask) => {
      const out = await ask();
      expect(out).toEqual(GOLDEN);
    });
  });

  test('a cold switch never holds the answer: the first answers are today\'s while the read runs behind them', async () => {
    rows = [{ key: KEY, value: true }];
    await serve(async (ask) => {
      expect((await ask()).quiz).toBe(GOLDEN.quiz);
      const later = await ask();
      expect(JSON.parse(later.hubGet).offline_guard).toBe(true);
    });
    expect(settingsReads).toBe(1);
  });

  test('on: an error answer (a closed code) never gets the field', async () => {
    rows = [{ key: KEY, value: true }];
    await Guard.flag();
    process.env.INTERNAL_API_KEY = 'route-key';
    const express = require('express');
    const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
    const spy = jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => { throw new WebQuiz.WqError(404, { error: 'not_found' }); });
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/wq/quiz/AB12CD`, { headers: { 'x-api-key': 'route-key' } });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('{"error":"not_found"}');
    } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
  });

  test('a route this switch does not name (a challenge game, the library) is never touched, on or off', async () => {
    rows = [{ key: KEY, value: true }];
    await Guard.flag();
    const seen = [];
    const fake = { get: (p, fn) => seen.push(['get', p, fn]), post: (p, fn) => seen.push(['post', p, fn]) };
    Guard.mount(fake);
    expect(seen.map((x) => [x[0], x[1]])).toEqual([['get', ['/hub/:token', '/ch/:token', '/quiz/:code']], ['post', '/hub/:token']]);
  });
});
