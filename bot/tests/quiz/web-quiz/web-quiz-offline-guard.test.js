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
let ownReads = 0;
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
          if (t === 'app_settings' && st.key === KEY) ownReads += 1; // a read of this switch's own row (it must never make one; other modules read their own)
          if (fail) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) {
          if (t === 'app_settings') settingsReads += 1; // the hub's one batched read (it carries this switch's key)
          if (fail) return Promise.resolve({ data: null, error: { message: 'down' } }).then(res, rej);
          return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej);
        },
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
  ownReads = 0;
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

  test('a failed read: off', async () => {
    rows = [{ key: KEY, value: true }];
    fail = true;
    expect(await Guard.flag()).toBe(false);
    expect(Guard.on()).toBe(false);
    fail = false;
    expect(Guard.on()).toBe(false);
  });

  test('never reads and never waits: a cold switch is off, and stays off with no read of its own', async () => {
    rows = [{ key: KEY, value: true }];
    expect(Guard.on()).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(Guard.on()).toBe(false);
    expect(settingsReads).toBe(0);
    expect(ownReads).toBe(0);
  });

  test('it rides the hub\'s one batched read: the key is in the hub switches, one read serves them, none is its own', async () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    expect(Flags.KEYS).toContain(KEY);
    expect(KEY).toBe(Flags.OFFLINE_GUARD_KEY);
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    await Flags.flags();
    expect(settingsReads).toBe(1);
    expect(ownReads).toBe(0);
    expect(Guard.on()).toBe(true);
  });

  test('another module\'s batched read (prime) that carries the key turns it on, with no read of ours', () => {
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    Flags._resetCache();
    Flags.prime([{ key: KEY, value: true }]);
    expect(Guard.on()).toBe(true);
    Flags._resetCache();
    Flags.prime([{ key: KEY, value: 'true' }]);
    expect(Guard.on()).toBe(false);
    expect(settingsReads).toBe(0);
  });

  test('30 s cache: no read inside it; after it the switch is off until the hub reads again (no read of its own)', async () => {
    rows = [{ key: KEY, value: true }];
    const t0 = Date.now();
    await require('../../../shared/services/quiz/web-quiz-hub-flags').flags(t0);
    expect(settingsReads).toBe(1);
    for (let i = 0; i < 5; i += 1) expect(Guard.on(t0 + 29 * 1000)).toBe(true);
    expect(Guard.on(t0 + 31 * 1000)).toBe(false);
    expect(settingsReads).toBe(1);
    rows = [{ key: KEY, value: false }];
    await require('../../../shared/services/quiz/web-quiz-hub-flags').flags(t0 + 32 * 1000);
    expect(settingsReads).toBe(2);
    expect(Guard.on(t0 + 33 * 1000)).toBe(false);
  });

  test('the hub\'s other switches do not turn it on, and it does not turn them on', async () => {
    rows = [{ key: 'web_quiz_hub', value: true }, { key: 'web_quiz_wait_ux', value: true }];
    expect(await Guard.flag()).toBe(false);
    rows = [{ key: KEY, value: true }];
    const f = await require('../../../shared/services/quiz/web-quiz-hub-flags').flags(Date.now() + 40 * 1000);
    expect([f.hub, f.waitUx, f.offlineGuard]).toEqual([false, false, true]);
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', lang: 'ur', questions: [] }, cls: { label: 'Class 3' }, ui: { ur2: true }, fast: true };
const HUB = { lang: 'ur', kids: [{ kid: '0123456789abcdef', name: 'Test Child' }], rt: false, fast: true };
const MENU = { lang: 'ur', exercises: [], rt: false };

async function serve(fn, warm) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const C = require('../../../shared/services/quiz/web-quiz-challenge');
  const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
  const spies = [
    jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => { if (warm) await warm(); return JSON.parse(JSON.stringify(QUIZ)); }),
    jest.spyOn(Hub, 'hub').mockImplementation(async () => { if (warm) await warm(); return JSON.parse(JSON.stringify(HUB)); }),
    jest.spyOn(C, 'menu').mockImplementation(async () => JSON.parse(JSON.stringify(MENU))),
    jest.spyOn(CardImage, 'field').mockResolvedValue({}),
    jest.spyOn(require('../../../shared/services/quiz/web-quiz-hub-door'), 'menuFoldField').mockResolvedValue({}),
    jest.spyOn(require('../../../shared/services/quiz/web-quiz-read-feedback'), 'menuField').mockResolvedValue({}), // reads its own switch: not this guard's read
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

  test('a cold switch never holds the answer and never reads: today\'s answers, 0 settings reads', async () => {
    rows = [{ key: KEY, value: true }];
    await serve(async (ask) => {
      expect(await ask()).toEqual(GOLDEN);
    });
    expect(settingsReads).toBe(0);
    expect(ownReads).toBe(0);
  });

  test('a cold switch, an answer whose own flags read runs first (the real handlers\'): the answer carries the field, one read in all', async () => {
    rows = [{ key: KEY, value: true }];
    const Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
    await serve(async (ask) => {
      const out = await ask();
      expect(JSON.parse(out.quiz).offline_guard).toBe(true);
      expect(JSON.parse(out.hubGet).offline_guard).toBe(true);
    }, () => Flags.flags());
    expect(settingsReads).toBe(1);
    expect(ownReads).toBe(0);
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
