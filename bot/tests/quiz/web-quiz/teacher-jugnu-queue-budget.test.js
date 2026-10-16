'use strict';
/**
 * The teacher's Jugnu tab never waits on the teacher-confirm queue past a fixed budget (QUEUE_BUDGET_MS, 3 s):
 * the portal edge gives the bot 10 s, and a slow queue read used to hold the whole tab past it (a 502).
 *
 *   - a queue that answers late: the tab answers within the budget, 200, no queue section, the rest of the tab present
 *   - a queue that answers in time: the page is byte for byte the page rendered without the budget code path
 *   - a queue that rejects after the budget: no unhandled rejection; one log line
 *   - the budget itself: 3000 ms, and its timer is cleared when the queue answers in time
 *
 * The routes run for real on an ephemeral port over the real data module, page and token. Faked: Supabase
 * (in-memory, filters applied), the loggers, and the join-queue service (scripted candidatesFor). The route
 * tests shrink the budget on the freshly loaded data module so the suite stays fast; the budget test uses
 * jest fake timers against the real 3000 ms. Children are invented "Testwala" fixtures.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../../shared/services/quiz/web-quiz-join-queue', () => ({
  candidatesFor: jest.fn(async () => []),
  decide: jest.fn(async () => ({ ok: true })),
  linkClassCodes: jest.fn(async () => ({ linked: 0 })),
}));

const express = require('express');
const { makeFake } = require('./fake-supabase');

const NOW = Date.parse('2026-10-15T09:30:00Z');
const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const LIST = 'a0000000-0000-4000-8000-00000000003b';
const CLASS = 'c1a55000-0000-4000-8000-000000000001';
const id = (n) => `b0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const LOOSE = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const at = (iso) => new Date(Date.parse(iso)).toISOString();
const KIDS = [[1, 'Ayesha Testwala'], [2, 'Bilal Testwala'], [3, 'Noor Testwala']];

const ROWS = [
  { loose_id: LOOSE(1), candidate_id: id(1), first: 'Ayesha', candidate_first: 'Ayesha', father_first: null, candidate_father_first: null, class_id: CLASS, grade: 3 },
  { loose_id: LOOSE(2), candidate_id: id(2), first: 'Bilal', candidate_first: 'Bilal', father_first: null, candidate_father_first: null, class_id: CLASS, grade: 3 },
];

let DB;
let throwOn = null; // a table whose read throws (the queue's own reads failing outright)
function seed() {
  DB = {
    app_settings: [
      { key: 'web_quiz_teacher_jugnu', value: 'true' }, { key: 'web_quiz_challenge_v2', value: 'true' }, { key: 'web_quiz_challenge', value: 'true' },
      { key: 'web_quiz_identity_canon', value: 'true' }, { key: 'web_quiz_hub', value: 'true' },
    ],
    users: [{ id: TEACHER, preferred_language: 'en' }],
    quizzes: [{ id: QUIZ, teacher_id: TEACHER, topic: 'Plants', subject: 'science', grade: '3', language: 'en', quiz_source: 'transcript',
      status: 'report_sent', list_id: null, created_at: at('2026-10-14T03:00:00Z'), meta: { share_code_id: SC } }],
    quiz_share_codes: [{ id: SC, code: 'AB12CD', quiz_id: QUIZ, teacher_user_id: TEACHER, active: true, expires_at: null, language: 'en', created_at: at('2026-10-14T03:00:00Z') }],
    quiz_sessions: [], quiz_questions: [], quiz_answers: [],
    student_lists: [{ id: LIST, class_name: 'Grade 3', section: 'B', user_id: TEACHER, is_active: true, class_id: CLASS }],
    students: KIDS.map(([n, name]) => ({ id: id(n), list_id: LIST, roll_number: n, student_name: name, father_name: null, student_name_urdu: null, is_active: true, merged_into: null })),
    class_enrollments: KIDS.map(([n]) => ({ class_id: CLASS, student_id: id(n), is_active: true })),
    web_quiz_challenge_runs: [],
    child_rungs: [],
    child_phone_bindings: [],
    merge_log: [],
  };
  const fake = makeFake(DB);
  const from = (t) => {
    if (t === throwOn) throw new Error(`${t} read failed outright`);
    return fake.from(t);
  };
  Object.assign(require('../../../shared/config/supabase'), { from, rpc: fake.rpc });
}

let server;
let base;
let Token;
let Queue;
let Data;
let logger;
async function boot() {
  jest.resetModules();
  process.env.INTERNAL_API_KEY = 'test-key';
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  throwOn = null;
  seed();
  Token = require('../../../shared/services/quiz/teacher-report-token');
  Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
  Data = require('../../../shared/services/quiz/teacher-jugnu.data');
  logger = require('../../../shared/utils/logger');
  const app = express();
  app.use('/api/internal/tr', require('../../../shared/routes/teacher-report-internal.routes'));
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/internal/tr`;
}

const get = (p) => fetch(`${base}${p}`, { headers: { 'x-api-key': 'test-key' }, redirect: 'manual' });
const tok = () => Token.signTeacherReport({ teacherId: TEACHER, quizId: QUIZ });
const TAB = () => `/page/${tok()}?tab=jugnu&class=${LIST}`;
const rowsOf = (h) => [...h.matchAll(/<li class="jk"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const later = (ms, v) => new Promise((r) => { setTimeout(() => r(v), ms); });
const budgetLines = () => logger.logToFile.mock.calls.filter((c) => /queue/i.test(String(c[0])) && /budget/i.test(String(c[0])));

describe('the confirm queue on the Jugnu tab has a budget', () => {
  beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] }); });
  afterEach(async () => { jest.useRealTimers(); if (server) await new Promise((r) => server.close(r)); server = null; });

  test('a queue that answers late: 200 within the budget, no queue section, the rest of the tab present', async () => {
    await boot();
    Data.QUEUE_BUDGET_MS = 100;
    Queue.candidatesFor.mockImplementation(() => later(5000, ROWS));
    const t0 = performance.now();
    const r = await get(TAB());
    const h = await r.text();
    const took = performance.now() - t0;
    expect(r.status).toBe(200);
    expect(took).toBeLessThan(2000);
    expect(h).not.toContain('id="jq"');
    expect(h).not.toContain('/queue');
    expect(h).not.toContain('Is Ayesha the same child as Ayesha?');
    expect(rowsOf(h)).toHaveLength(3);
    expect(h).toContain('Sorted by name. No scores, no positions.');
    expect(h).toContain("Practice: nothing counts on a teacher's phone.");
    expect(h).not.toMatch(/Testwala/);
    expect(budgetLines()).toHaveLength(1);
    const [, meta, level] = budgetLines()[0];
    expect(level).toBe('warn');
    expect(JSON.stringify(meta || {})).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // no teacher, list or child id
  }, 15000);

  test('a queue that answers in time: byte for byte the page rendered without the budget code path', async () => {
    await boot();
    Queue.candidatesFor.mockResolvedValue(ROWS);
    expect(Data.QUEUE_BUDGET_MS).toBe(3000);
    const within = jest.spyOn(Data, 'confirmQueueWithin');
    const withBudget = await (await get(TAB())).text();
    expect(within).toHaveBeenCalledTimes(1);
    expect(withBudget).toContain('id="jq"');
    expect(withBudget).toContain('Is Ayesha the same child as Ayesha?');
    // The same page with the budget wrapper bypassed: the queue straight from confirmQueue, as before.
    within.mockImplementation((teacherId, tab, lang) => Data.confirmQueue(teacherId, tab, lang));
    const without = await (await get(TAB())).text();
    expect(Buffer.from(withBudget, 'utf8').equals(Buffer.from(without, 'utf8'))).toBe(true);
    expect(budgetLines()).toHaveLength(0);
  });

  test('a queue that rejects after the budget: the tab still answers 200 and nothing goes unhandled', async () => {
    await boot();
    Data.QUEUE_BUDGET_MS = 50;
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      // candidatesFor answers at 200 ms; the merge_log read then throws, so confirmQueue itself rejects — late.
      Queue.candidatesFor.mockImplementation(async () => { await later(200); throwOn = 'merge_log'; return ROWS; });
      const r = await get(TAB());
      const h = await r.text();
      expect(r.status).toBe(200);
      expect(h).not.toContain('id="jq"');
      expect(rowsOf(h)).toHaveLength(3);
      await later(400);
      await new Promise((res) => setImmediate(res));
      expect(unhandled).toEqual([]);
      expect(budgetLines()).toHaveLength(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 15000);
});

describe('the budget itself (fake timers, the real 3000 ms)', () => {
  afterEach(() => { jest.useRealTimers(); });

  function load() {
    jest.resetModules();
    throwOn = null;
    seed();
    Queue = require('../../../shared/services/quiz/web-quiz-join-queue');
    Data = require('../../../shared/services/quiz/teacher-jugnu.data');
    logger = require('../../../shared/utils/logger');
  }
  const TAB_DATA = () => ({ list: { id: LIST, classId: CLASS, grade: '3' }, kids: KIDS.map(([n, name]) => ({ id: id(n), first: name.split(' ')[0] })) });

  test('QUEUE_BUDGET_MS is 3000; a queue that never answers gives null at 3000 ms, not before', async () => {
    load();
    expect(Data.QUEUE_BUDGET_MS).toBe(3000);
    jest.useFakeTimers({ now: NOW });
    Queue.candidatesFor.mockImplementation(() => new Promise(() => {}));
    let settled = false;
    let value;
    const p = Data.confirmQueueWithin(TEACHER, TAB_DATA(), 'en').then((v) => { settled = true; value = v; });
    await jest.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toBe(true);
    expect(value).toBeNull();
    expect(budgetLines()).toHaveLength(1);
  });

  test('a queue that answers in time: the same rows as confirmQueue, and the budget timer is cleared', async () => {
    load();
    Queue.candidatesFor.mockResolvedValue(ROWS);
    const direct = await Data.confirmQueue(TEACHER, TAB_DATA(), 'en');
    jest.useFakeTimers({ now: NOW });
    const rows = await Data.confirmQueueWithin(TEACHER, TAB_DATA(), 'en');
    expect(rows).toEqual(direct);
    expect(rows).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
    expect(budgetLines()).toHaveLength(0);
  });

  test('a queue that fails inside the budget fails the same way it did before', async () => {
    load();
    Queue.candidatesFor.mockResolvedValue(ROWS);
    throwOn = 'merge_log';
    await expect(Data.confirmQueue(TEACHER, TAB_DATA(), 'en')).rejects.toThrow('merge_log read failed outright');
    await expect(Data.confirmQueueWithin(TEACHER, TAB_DATA(), 'en')).rejects.toThrow('merge_log read failed outright');
    expect(budgetLines()).toHaveLength(0);
  });
});
