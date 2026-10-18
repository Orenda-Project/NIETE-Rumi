'use strict';
/**
 * The closed pages in the child's language (app_settings web_quiz_closed_lang): default off, on only for the stored JSON
 * boolean true, 30 s cache, fail off. On, a genuine but expired home link's 401 carries the children's `lang` (their class
 * quizzes' language, else the link's `l`, else their own quizzes'); a forged link's 401 is today's; the quiz and hub
 * answers say `closed_lang: true`. Off, every answer is byte for byte today's.
 *
 * Supabase, the loggers and the children's quiz history (student-quiz.service's quizzesForStudents, a read of its own)
 * are the boundaries. The route tests stand in the page modules' answers (getQuiz, hub).
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const KEY = 'web_quiz_closed_lang';
const KID = '55555555-5555-4555-8555-0000000000a1';
let rows = [];
let students = [];
let fail = false;
let studentsFail = false;
let reads = [];
function seed() {
  Object.assign(require('../../../shared/config/supabase'), {
    from(t) {
      const st = { t, key: null };
      const b = {
        select() { return b; },
        eq(c, v) { if (c === 'key') st.key = v; return b; },
        in() { return b; },
        abortSignal() { return b; },
        async maybeSingle() {
          if (t === 'app_settings') reads.push(st.key);
          if (fail && st.key === KEY) return { data: null, error: { message: 'down' } };
          return { data: rows.find((r) => r.key === st.key) || null, error: null };
        },
        then(res, rej) {
          if (t === 'students') reads.push('students');
          const out = t === 'students' ? (studentsFail ? { data: null, error: { message: 'down' } } : { data: students, error: null })
            : { data: t === 'app_settings' ? rows.filter((r) => !st.key || r.key === st.key) : [], error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  });
}

let Closed;
let T;
let history;
beforeEach(() => {
  jest.resetModules();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'closed-lang-test-secret';
  rows = [];
  students = [{ id: KID, is_active: true }];
  fail = false;
  studentsFail = false;
  reads = [];
  history = [{ language: 'ur' }];
  seed();
  jest.spyOn(require('../../../shared/services/quiz/student-quiz.service'), 'quizzesForStudents').mockImplementation(async () => history);
  Closed = require('../../../shared/services/quiz/web-quiz-closed-lang');
  T = require('../../../shared/services/quiz/web-quiz-token');
});
afterEach(() => jest.restoreAllMocks());

const nowS = () => Math.floor(Date.now() / 1000);
const expired = (extra = {}) => T.sign({ k: 'h', ids: [KID], ...extra, exp: nowS() - 3600 });
const forged = () => { const t = expired(); return `${t.slice(0, -4)}AAAA`; };

const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }], ['false', false], ['null', null]];

describe('the switch', () => {
  test('JSON true: on', async () => {
    rows = [{ key: KEY, value: true }];
    expect(await Closed.flag()).toBe(true);
    expect(Closed.on()).toBe(true);
  });
  test.each(OFF_VALUES)('%s: off', async (_n, value) => {
    rows = [{ key: KEY, value }];
    expect(await Closed.flag()).toBe(false);
  });
  test('no row, or a failed read: off', async () => {
    expect(await Closed.flag()).toBe(false);
    Closed._reset();
    rows = [{ key: KEY, value: true }];
    fail = true;
    expect(await Closed.flag()).toBe(false);
  });
});

describe('the children\'s language for a home link', () => {
  test('a genuine expired link: its children\'s class quiz language', async () => {
    expect(await Closed.hubLang(expired())).toBe('ur');
    history = [{ language: 'en' }];
    expect(await Closed.hubLang(expired({ l: 'ur' }))).toBe('en');
  });
  test('no class quiz yet: the link\'s own `l`, else the child\'s own quizzes\'', async () => {
    history = [{ language: 'ur', lessonCode: 'L1' }];
    expect(await Closed.hubLang(expired({ l: 'en' }))).toBe('en');
    expect(await Closed.hubLang(expired())).toBe('ur');
  });
  test('a forged or garbled link: null, and nothing is read', async () => {
    expect(await Closed.hubLang(forged())).toBeNull();
    expect(await Closed.hubLang('not-a-token')).toBeNull();
    expect(reads).not.toContain('students');
  });
  test('the children cannot be read: the link\'s `l` or null, never a throw', async () => {
    studentsFail = true;
    expect(await Closed.hubLang(expired({ l: 'ur' }))).toBe('ur');
    expect(await Closed.hubLang(expired())).toBeNull();
  });
});

// ── the routes ─────────────────────────────────────────────────────────────────────────────────────────
const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', lang: 'ur', questions: [] }, cls: { label: 'Class 3' } };
const HUB = { lang: 'ur', kids: [{ kid: '0123456789abcdef', name: 'Star Testwala' }], rt: false };

async function serve(fn, { hubFails = false } = {}) {
  process.env.INTERNAL_API_KEY = 'route-key';
  const express = require('express');
  const WebQuiz = require('../../../shared/services/quiz/web-quiz.service');
  const Hub = require('../../../shared/services/quiz/web-quiz-hub');
  const CardImage = require('../../../shared/services/quiz/web-quiz-card-image');
  jest.spyOn(WebQuiz, 'getQuiz').mockImplementation(async () => JSON.parse(JSON.stringify(QUIZ)));
  jest.spyOn(Hub, 'hub').mockImplementation(async () => {
    if (hubFails) throw new WebQuiz.WqError(401, { error: 'bad_token' });
    return JSON.parse(JSON.stringify(HUB));
  });
  jest.spyOn(CardImage, 'field').mockResolvedValue({});
  const app = express();
  app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
  const h = { 'x-api-key': 'route-key' };
  const ask = async (token = 'abc.def') => {
    const q = await fetch(`${base}/quiz/AB12CD`, { headers: h });
    const g = await fetch(`${base}/hub/${token}`, { headers: h });
    return { quiz: await q.text(), hub: `${g.status} ${await g.text()}` };
  };
  try { return await fn(ask); } finally { await new Promise((r) => server.close(r)); }
}

describe('the routes', () => {
  test('on: the quiz and hub answers say closed_lang: true, and nothing else changes', async () => {
    rows = [{ key: KEY, value: true }];
    await Closed.flag();
    await serve(async (ask) => {
      const out = await ask();
      expect(JSON.parse(out.quiz).closed_lang).toBe(true);
      expect(out.quiz.replace(/,"closed_lang":true/, '')).toBe(JSON.stringify(QUIZ));
      expect(out.hub).toBe(`200 ${JSON.stringify({ ...HUB, closed_lang: true })}`);
    });
  });

  test('on: a genuine expired home link\'s 401 carries the children\'s language', async () => {
    rows = [{ key: KEY, value: true }];
    await Closed.flag();
    await serve(async (ask) => {
      expect((await ask(expired())).hub).toBe('401 {"error":"bad_token","lang":"ur"}');
    }, { hubFails: true });
  });

  test('on: a forged home link\'s 401 is today\'s (no language), and no child is read', async () => {
    rows = [{ key: KEY, value: true }];
    await Closed.flag();
    await serve(async (ask) => {
      expect((await ask(forged())).hub).toBe('401 {"error":"bad_token"}');
    }, { hubFails: true });
    expect(reads).not.toContain('students');
  });

  test.each([...OFF_VALUES, ['no row', undefined], ['a failed read', 'FAIL']])('%s: every answer, the 401 included, byte for byte today\'s', async (_n, value) => {
    if (value === 'FAIL') { rows = [{ key: KEY, value: true }]; fail = true; } else if (value !== undefined) rows = [{ key: KEY, value }];
    await Closed.flag();
    await serve(async (ask) => {
      expect(await ask()).toEqual({ quiz: JSON.stringify(QUIZ), hub: `200 ${JSON.stringify(HUB)}` });
    });
    await serve(async (ask) => {
      expect((await ask(expired())).hub).toBe('401 {"error":"bad_token"}');
    }, { hubFails: true });
    expect(reads).not.toContain('students');
  });
});
