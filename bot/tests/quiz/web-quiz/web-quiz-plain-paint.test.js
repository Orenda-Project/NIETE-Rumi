'use strict';
/**
 * A wordless first paint (app_settings web_quiz_plain_paint): default off, on only for the stored JSON boolean true,
 * 30 s cache, fail off, never waited for, and looked at only for an answer that says `fast: true` (web_quiz_fast on). On, the
 * quiz and hub answers that say `fast: true` also say `plain_paint: true`, so the edge's guessed head carries no words
 * in any language; off, every answer is byte for byte the page module's own answer (the route adds nothing).
 *
 * Supabase and the loggers are the boundaries. The route tests stand in the page modules' answers (getQuiz, hub) so the
 * bytes compared are exactly what the route adds.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_plain_paint';
let rows = [];
let fail = false;
let reads = [];
// app_settings only: what the switches read (the route tests' page modules are stood in).
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { t, key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { return b; },
        async maybeSingle() {
          if (t === 'app_settings') reads.push(st.key);
          if (fail && st.key === KEY) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) {
          // the hub's one switch read (.in(KEYS)) fails with this key's own read
          if (fail && t === 'app_settings' && !st.key) return Promise.resolve({ data: null, error: { message: 'down' } }).then(res, rej);
          return Promise.resolve({ data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej);
        },
      };
      return b;
    },
  });
}

let Plain;
beforeEach(() => {
  jest.resetModules();
  rows = [];
  fail = false;
  reads = [];
  seed();
  Plain = require('../../../shared/services/quiz/web-quiz-plain-paint');
});
const tick = () => new Promise((r) => setImmediate(r));
// The switch read once (its own cache for the quiz page, the hub's one switch read for the home), then the reads
// counted from zero.
const hubFlags = () => require('../../../shared/services/quiz/web-quiz-hub-flags');
async function warm() {
  await Plain.flag();
  await hubFlags().flags();
  reads = [];
}

const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]];

describe('the switch', () => {
  test('JSON true: on', async () => {
    rows = [{ key: KEY, value: true }];
    expect(await Plain.flag()).toBe(true);
    expect(Plain.on()).toBe(true);
  });

  test.each(OFF_VALUES)('%s: off', async (_n, value) => {
    rows = [{ key: KEY, value }];
    expect(await Plain.flag()).toBe(false);
    expect(Plain.on()).toBe(false);
  });

  test('no row: off', async () => {
    expect(await Plain.flag()).toBe(false);
    expect(Plain.on()).toBe(false);
  });

  test('a failed read: off, and off stays cached for 30 s', async () => {
    rows = [{ key: KEY, value: true }];
    fail = true;
    expect(await Plain.flag()).toBe(false);
    fail = false;
    expect(Plain.on()).toBe(false);
    expect(reads.filter((k) => k === KEY)).toHaveLength(1);
  });

  test('never waited for: the first answer after a start is off, the next one (read in the background) on', async () => {
    rows = [{ key: KEY, value: true }];
    expect(Plain.on()).toBe(false);
    await tick();
    expect(Plain.on()).toBe(true);
    expect(reads).toEqual([KEY]);
  });

  test('a value older than twice the cache time is off (a refresh that never comes back cannot keep it on)', async () => {
    rows = [{ key: KEY, value: true }];
    const t0 = Date.now();
    await Plain.flag(t0);
    require('../../../shared/config/supabase').from = () => ({ select() { return this; }, eq() { return this; }, maybeSingle: () => new Promise(() => {}) });
    expect(Plain.on(t0 + 59 * 1000)).toBe(true);
    expect(Plain.on(t0 + 61 * 1000)).toBe(false);
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', lang: 'ur', questions: [] }, cls: { label: 'Class 3' }, ui: { ur2: true }, fast: true };
const HUB = { lang: 'ur', kids: [{ kid: '0123456789abcdef', name: 'Star Testwala' }], rt: false, fast: true };

async function serve(fn, { quiz = QUIZ, hub = HUB } = {}) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
  const spies = [
    jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => JSON.parse(JSON.stringify(quiz))),
    jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(hub))),
    jest.spyOn(CardImage, 'field').mockResolvedValue({}),
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
  });
  const hubOnly = async () => (await fetch(`${base}/hub/abc.def`, { headers: h })).text();
  try { return await fn(ask, hubOnly); } finally { spies.forEach((s) => s.mockRestore()); await new Promise((r) => server.close(r)); }
}
// The OFF golden: each page module's own answer, as the route sent it before this switch.
const GOLDEN = { quiz: JSON.stringify(QUIZ), hubGet: JSON.stringify(HUB) };

describe('the routes', () => {
  test('on, with the fast page on: the quiz and hub answers say plain_paint: true, and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await warm();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) {
        expect(JSON.parse(out[k]).plain_paint).toBe(true);
        expect(out[k].replace(/,"plain_paint":true/, '')).toBe(GOLDEN[k]);
      }
    });
  });

  test('on, but the fast page off (answers without `fast: true`, no early head): nothing added, this switch never read', async () => {
    rows = [{ key: KEY, value: true }];
    const quiz = { ...QUIZ }; delete quiz.fast;
    const hub = { ...HUB }; delete hub.fast;
    await serve(async (ask) => {
      expect(await ask()).toEqual({ quiz: JSON.stringify(quiz), hubGet: JSON.stringify(hub) });
      expect(await ask()).toEqual({ quiz: JSON.stringify(quiz), hubGet: JSON.stringify(hub) });
    }, { quiz, hub });
    expect(reads).not.toContain(KEY);
  });

  test.each([...OFF_VALUES, ['no row', undefined], ['a failed read', 'FAIL']])('%s: every answer byte for byte the OFF golden', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await warm();
    await serve(async (ask) => {
      expect(await ask()).toEqual(GOLDEN);
    });
  });

  test('a cold switch never holds the answer: the first answers are today\'s while the read runs behind them', async () => {
    rows = [{ key: KEY, value: true }];
    await serve(async (ask) => {
      expect(await ask()).toEqual(GOLDEN);
      await hubFlags().flags(); // the hub's own switch read (the stood-in hub does not make it)
      const later = await ask();
      expect(JSON.parse(later.quiz).plain_paint).toBe(true);
      expect(JSON.parse(later.hubGet).plain_paint).toBe(true);
    });
    expect(reads.filter((k) => k === KEY)).toHaveLength(1);
  });

  test('the home takes the switch from the hub\'s one settings read (it carries this key): no read of its own', async () => {
    rows = [{ key: KEY, value: true }];
    expect(hubFlags().KEYS).toContain(KEY);
    await hubFlags().flags();
    reads = [];
    await serve(async (_ask, hubOnly) => {
      expect(JSON.parse(await hubOnly()).plain_paint).toBe(true);
      expect(JSON.parse(await hubOnly()).plain_paint).toBe(true);
    });
    expect(reads.filter((k) => k === KEY)).toEqual([]);
  });

  test('the hub\'s read off, failed or empty: the home is today\'s', async () => {
    rows = [{ key: KEY, value: 'true' }];
    await hubFlags().flags();
    await serve(async (_ask, hubOnly) => {
      expect(await hubOnly()).toBe(GOLDEN.hubGet);
    });
    hubFlags()._resetCache();
    await serve(async (_ask, hubOnly) => {
      expect(await hubOnly()).toBe(GOLDEN.hubGet);
    });
  });
});
