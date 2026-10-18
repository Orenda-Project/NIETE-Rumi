'use strict';
/**
 * The busy page's switch on the bot's answers (app_settings web_quiz_busy_page, web-quiz-busy-page.js). On (only the
 * stored JSON boolean true): the hub answers (GET and POST) and the quiz answer carry `busy_page: true`, so the portal
 * learns it the way it learns `wait_ux`. Off (no row, false, the string 'true', 1, an object, a failed read): every answer
 * byte for byte the page module's own answer.
 * The switch rides the hub's one batched app_settings read (web-quiz-hub-flags.js): it adds no settings read, on or off.
 * Supabase and the loggers are the boundaries; the page modules' answers are stood in so the bytes compared are exactly
 * what the route adds.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_busy_page';
let rows = [];
let fail = false;
let settingsReads = 0;
let inLists = [];
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      if (t === 'app_settings') settingsReads += 1;
      const st = { key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in(c, list) { if (t === 'app_settings') inLists.push(list); return b; },
        async maybeSingle() {
          if (fail) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) { return Promise.resolve(fail && t === 'app_settings' ? { data: null, error: { message: 'down' } } : { data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null }).then(res, rej); },
      };
      return b;
    },
  });
}

let Flags;
beforeEach(() => {
  jest.resetModules();
  rows = []; fail = false; settingsReads = 0; inLists = [];
  seed();
  Flags = require('../../../shared/services/quiz/web-quiz-hub-flags');
});

const HUB = { lang: 'en', kids: [{ kid: '0123456789abcdef', name: 'Sana Testwala' }], rt: false };
const QUIZ = { quiz: { code: 'AB12CD', lang: 'en', questions: [] }, brand: 'niete' };
const DOORS = { games: [{ kind: 'numbers', stop: 'bigger' }] };

async function serve(fn) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const Doors = require('../../../shared/services/quiz/web-quiz-hub-doors');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
  const OneFace = require('../../../shared/services/quiz/web-quiz-one-face');
  const Og = require('../../../shared/services/quiz/web-quiz-og');
  const spies = [
    jest.spyOn(Hub, 'hub').mockImplementation(async () => JSON.parse(JSON.stringify(HUB))),
    jest.spyOn(Doors, 'door').mockImplementation(async () => JSON.parse(JSON.stringify(DOORS))),
    jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => JSON.parse(JSON.stringify(QUIZ))),
    jest.spyOn(CardImage, 'field').mockImplementation(async () => ({})),
    jest.spyOn(OneFace, 'carry').mockImplementation((p) => Promise.resolve(p)),
    jest.spyOn(Og, 'remember').mockImplementation(() => {}),
  ];
  const app = express();
  app.use(express.json());
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const one = async (url, init) => { const r = await fetch(url, init); return { status: r.status, body: await r.text() }; };
  const ask = async () => ({
    hubGet: await one(`${base}/hub/abc.def`, { headers: h }),
    hubPost: await one(`${base}/hub/abc.def`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' }),
    quiz: await one(`${base}/quiz/AB12CD`, { headers: h }),
    doors: await one(`${base}/doors/h/abc.def?d=games`, { headers: h }),
  });
  try { return await fn(ask); } finally { spies.forEach((s) => s.mockRestore()); await new Promise((r) => server.close(r)); }
}
const GOLDEN = { hubGet: JSON.stringify(HUB), hubPost: JSON.stringify(HUB), quiz: JSON.stringify(QUIZ), doors: JSON.stringify(DOORS) };

describe('the answers', () => {
  test('on (JSON true): the hub and quiz answers say busy_page: true at their end; nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await Flags.flags();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of ['hubGet', 'hubPost', 'quiz']) {
        expect(out[k].status).toBe(200);
        expect(JSON.parse(out[k].body).busy_page).toBe(true);
        expect(out[k].body).toBe(GOLDEN[k].replace(/}$/, ',"busy_page":true}'));
      }
      expect(out.doors.body).toBe(GOLDEN.doors);
    });
  });

  test.each([['false', false], ['the string true', 'true'], ['1', 1], ['an object', { on: true }], ['no row', undefined], ['a failed read', 'FAIL']])('off (%s): every answer byte for byte the golden', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await Flags.flags();
    await serve(async (ask) => {
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) { expect(out[k].status).toBe(200); expect(out[k].body).toBe(GOLDEN[k]); }
    });
  });

  test('a cold or expired switch cache is off (the answer is today\'s), never a read of its own', async () => {
    rows = [{ key: KEY, value: true }];
    await serve(async (ask) => {
      settingsReads = 0;
      const out = await ask();
      for (const k of Object.keys(GOLDEN)) expect(out[k].body).toBe(GOLDEN[k]);
      expect(settingsReads).toBe(0);
    });
  });
});

describe('the settings reads', () => {
  test('the switch is one more key in the hub\'s one batched read: one query, cold, on or off', async () => {
    expect(Flags.KEYS).toContain(KEY);
    for (const value of [undefined, true]) {
      Flags._resetCache();
      rows = value === undefined ? [] : [{ key: KEY, value }];
      settingsReads = 0; inLists = [];
      await Flags.flags();
      expect(settingsReads).toBe(1);
      expect(inLists).toHaveLength(1);
      expect(inLists[0]).toContain(KEY);
      expect(inLists[0]).toContain('web_quiz_wait_ux');
    }
  });

  test('the routes make the same number of settings reads on and off', async () => {
    const counts = {};
    for (const [name, value] of [['off', undefined], ['on', true]]) {
      Flags._resetCache();
      rows = value === undefined ? [] : [{ key: KEY, value }];
      await Flags.flags();
      await serve(async (ask) => { settingsReads = 0; await ask(); counts[name] = settingsReads; });
    }
    expect(counts.on).toBe(counts.off);
  });
});
