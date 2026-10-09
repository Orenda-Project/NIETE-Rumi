'use strict';
/**
 * A web-quiz read that hangs in transit (app_settings web_quiz_db_deadline).
 *
 * At the evening peak a few reads hung 16–50 s between the bot and the database while the database answered in
 * milliseconds; the portal gave up at 10 s and the child saw an error. With the flag on, a read gets a per-attempt
 * deadline and ONE retry; a second hang ends the request with the 502 db_unavailable the page already handles.
 * Off: today's behaviour.
 *
 * The network is the boundary: a REAL supabase-js client runs over a faked fetch that can hang a table's request
 * until it is aborted. Everything first-party on the path runs for real (board() -> resolveCode()).
 */
jest.mock('../../../shared/config/supabase', () => {
  const { createClient } = require('@supabase/supabase-js');
  return createClient('http://db.test', 'test-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (...a) => global.__wqFetch(...a) },
  });
});
jest.mock('../../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

const { logEvent } = require('../../../shared/utils/structured-logger');
const supabase = require('../../../shared/config/supabase');
const WQ = require('../../../shared/services/quiz/web-quiz.service');

const SC_ROW = {
  id: '33333333-3333-4333-8333-333333333333', code: 'AB12CD', quiz_id: '22222222-2222-4222-8222-222222222222',
  video_id: null, teacher_user_id: '11111111-1111-4111-8111-111111111111', language: 'en', active: true,
  expires_at: new Date(Date.now() + 86400000 * 10).toISOString(), invited_by_student_id: null, parent_share_code_id: null,
};

let flag;          // the app_settings value of web_quiz_db_deadline (undefined = no row)
let hangs;         // table -> how many of its next requests hang until aborted
let slowCodeMs;    // the class-code lookup (code=eq.AB12CD) answers only after this many ms (or when aborted)
let calls;         // every request: { table, method, query }
let held;          // resolvers of hung requests that were never aborted (the flag-off case)

const json = (rows) => new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
// A friend's challenge code: resolveCode reads it (call site 1), then its parent class code (call site 2).
const FRIEND_ROW = { ...SC_ROW, id: '55555555-5555-4555-8555-555555555555', code: 'FR12ND', invited_by_student_id: '44444444-4444-4444-8444-444444444444', parent_share_code_id: SC_ROW.id };
const rowsFor = (table, query = '') => {
  if (table === 'app_settings') return flag === undefined ? [] : [{ key: 'web_quiz_db_deadline', value: flag }];
  if (table === 'quiz_share_codes') return query.includes('FR12ND') ? [FRIEND_ROW] : [SC_ROW];
  return [];
};

global.__wqFetch = (url, init = {}) => {
  const u = new URL(String(url));
  const table = u.pathname.split('/').pop();
  calls.push({ table, method: init.method || 'GET', query: decodeURIComponent(u.search) });
  if (slowCodeMs > 0 && table === 'quiz_share_codes' && decodeURIComponent(u.search).includes('code=eq.AB12CD')) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(json(rowsFor(table, decodeURIComponent(u.search)))), slowCodeMs);
      if (init.signal) {
        init.signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })); });
      }
    });
  }
  if (hangs[table] > 0) {
    hangs[table] -= 1;
    return new Promise((resolve, reject) => {
      held.push(() => resolve(json(rowsFor(table, decodeURIComponent(u.search)))));
      if (init.signal) {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })));
      }
    });
  }
  return Promise.resolve(json(rowsFor(table, decodeURIComponent(u.search))));
};

// resolveCode's lookup of the class code (the report loader reads quiz_share_codes too, by id)
const shareCodeCalls = () => calls.filter((c) => c.table === 'quiz_share_codes' && c.query.includes('code=eq.AB12CD'));
const retryLines = () => logEvent.mock.calls.filter(([ev]) => ev === 'web_quiz.db_retry').map(([, p]) => p);

function deadlineModule() {
  try { return require('../../../shared/services/quiz/web-quiz-db-deadline'); } catch (_) { return null; }
}

beforeEach(() => {
  flag = undefined;
  hangs = {};
  slowCodeMs = 0;
  calls = [];
  held = [];
  logEvent.mockClear();
  const D = deadlineModule();
  if (D) D._reset();
});
afterEach(() => { held.forEach((r) => r()); });

describe('web quiz: a read that hangs gets a deadline and one retry (flag on)', () => {
  test('hang once -> retried on a fresh request -> the board answers within ~8 s', async () => {
    flag = true;
    hangs.quiz_share_codes = 1;
    const t0 = Date.now();
    const out = await WQ.board('AB12CD');
    const ms = Date.now() - t0;
    expect(out).toEqual(expect.objectContaining({ finishers_n: 0, rows: [] }));
    expect(shareCodeCalls()).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(3500);
    expect(ms).toBeLessThan(8000);
    expect(retryLines()).toEqual([expect.objectContaining({ label: 'resolveCode:quiz_share_codes:1', outcome: 'recovered', deadline_ms: 4000 })]);
  }, 15000);

  test('the flag stored as a JSON string (as other app_settings rows are) works the same', async () => {
    flag = '{"enabled": true, "ms": 4000}';
    hangs.quiz_share_codes = 1;
    await WQ.board('AB12CD');
    expect(shareCodeCalls()).toHaveLength(2);
    expect(retryLines()).toEqual([expect.objectContaining({ outcome: 'recovered', deadline_ms: 4000 })]);
  }, 15000);

  test('hang twice -> a clean 502 db_unavailable (the page\'s existing error) at ~9.5 s, inside the portal\'s 10 s, never a third try', async () => {
    flag = true;
    hangs.quiz_share_codes = 2;
    const t0 = Date.now();
    const err = await WQ.board('AB12CD').catch((e) => e);
    const ms = Date.now() - t0;
    expect(err).toBeInstanceOf(WQ.WqError);
    expect(err.status).toBe(502);
    expect(err.body).toEqual({ error: 'db_unavailable' });
    expect(shareCodeCalls()).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(9000);
    expect(ms).toBeLessThan(9900);
    const [line] = retryLines();
    expect(retryLines()).toHaveLength(1);
    expect(line).toEqual(expect.objectContaining({ label: 'resolveCode:quiz_share_codes:1', outcome: 'failed' }));
    expect(line.retry_ms).toBeGreaterThanOrEqual(5400);   // 10000 - ~4000 elapsed - 500, at most 5500
    expect(line.retry_ms).toBeLessThanOrEqual(5500);
  }, 15000);

  test('a slow read that DOES answer (5 s) gets the rest of the budget on its retry: the board answers by ~9 s', async () => {
    flag = true;
    slowCodeMs = 5000;
    const t0 = Date.now();
    const out = await WQ.board('AB12CD');
    const ms = Date.now() - t0;
    expect(out).toEqual(expect.objectContaining({ finishers_n: 0 }));
    expect(shareCodeCalls()).toHaveLength(2);
    expect(ms).toBeGreaterThanOrEqual(8500);
    expect(ms).toBeLessThan(9900);
    const [line] = retryLines();
    expect(retryLines()).toHaveLength(1);
    expect(line).toEqual(expect.objectContaining({ label: 'resolveCode:quiz_share_codes:1', outcome: 'recovered', deadline_ms: 4000 }));
    expect(line.retry_ms).toBeGreaterThanOrEqual(5400);
    expect(line.retry_ms).toBeLessThanOrEqual(5500);
  }, 20000);

  test('the budget is the REQUEST\'s: 3 s already spent, a read stuck on both tries still ends in db_unavailable before 10 s', async () => {
    flag = true;
    hangs.quiz_share_codes = 2;
    const Timing = require('../../../shared/services/quiz/web-quiz-timing');
    const t0 = Date.now();
    const err = await Timing.run('/board/:code', async () => {
      await new Promise((r) => setTimeout(r, 3000));
      return WQ.board('AB12CD');
    }).catch((e) => e);
    const ms = Date.now() - t0;
    expect(err).toBeInstanceOf(WQ.WqError);
    expect(err.body).toEqual({ error: 'db_unavailable' });
    expect(ms).toBeGreaterThanOrEqual(9000);
    expect(ms).toBeLessThan(9900);
    const [line] = retryLines();
    expect(line).toEqual(expect.objectContaining({ outcome: 'failed' }));
    expect(line.retry_ms).toBeGreaterThanOrEqual(2300);
    expect(line.retry_ms).toBeLessThanOrEqual(2600);
  }, 20000);

  test('a write handed to the wrapper is never given a deadline or retried', async () => {
    flag = true;
    const D = deadlineModule();
    expect(D).not.toBeNull();
    hangs.quiz_answers = 1;
    let settled = false;
    const p = D.read('test:quiz_answers', (db) => db.from('quiz_answers').insert({ session_id: 's1' })).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 5000));
    expect(settled).toBe(false);
    expect(calls.filter((c) => c.table === 'quiz_answers').map((c) => c.method)).toEqual(['POST']);
    held.forEach((r) => r());
    held = [];
    await p;
    expect(retryLines()).toEqual([]);
  }, 15000);
});

describe('web quiz: flag off (the default) is today\'s behaviour', () => {
  test('no app_settings row -> the hung read is still waiting past the deadline, one request, no retry', async () => {
    hangs.quiz_share_codes = 1;
    let out = null;
    const p = WQ.board('AB12CD').then((o) => { out = o; });
    await new Promise((r) => setTimeout(r, 5000));
    expect(out).toBeNull();
    expect(shareCodeCalls()).toHaveLength(1);
    held.forEach((r) => r());
    held = [];
    await p;
    expect(out).toEqual(expect.objectContaining({ finishers_n: 0 }));
    expect(shareCodeCalls()).toHaveLength(1);
    expect(retryLines()).toEqual([]);
  }, 15000);

  test('flag false -> same', async () => {
    flag = false;
    hangs.quiz_share_codes = 1;
    let done = false;
    const p = WQ.board('AB12CD').then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 4500));
    expect(done).toBe(false);
    expect(shareCodeCalls()).toHaveLength(1);
    held.forEach((r) => r());
    held = [];
    await p;
    expect(retryLines()).toEqual([]);
  }, 15000);
});

test('the shared client itself is untouched: a hung read outside the web quiz still hangs with the flag on', async () => {
  flag = true;
  await WQ.board('AB12CD'); // loads the flag
  hangs.users = 1;
  let done = false;
  const p = supabase.from('users').select('id').eq('id', 'x').maybeSingle().then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 4500));
  expect(done).toBe(false);
  held.forEach((r) => r());
  held = [];
  await p;
}, 15000);

describe('measuring it on a test tier: the flag can hold one read\'s first attempt (never in production)', () => {
  const INJECT = { enabled: true, inject: 'resolveCode:quiz_share_codes:1' };
  const env = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = env; });

  test('inject -> that read\'s first attempt is held for the deadline, the retry runs for real, one line says so', async () => {
    flag = INJECT;
    const t0 = Date.now();
    const out = await WQ.board('AB12CD');
    const ms = Date.now() - t0;
    expect(out).toEqual(expect.objectContaining({ finishers_n: 0 }));
    expect(shareCodeCalls()).toHaveLength(1);
    expect(ms).toBeGreaterThanOrEqual(3500);
    expect(ms).toBeLessThan(8000);
    expect(retryLines()).toEqual([expect.objectContaining({ label: 'resolveCode:quiz_share_codes:1', outcome: 'recovered', injected: true })]);
  }, 15000);

  test('each call site has its own label: a friend\'s code reads twice in resolveCode, inject holds only site 1', async () => {
    flag = INJECT;
    const t0 = Date.now();
    await WQ.getQuiz('FR12ND').catch(() => null);
    const ms = Date.now() - t0;
    expect(retryLines().map((l) => l.label)).toEqual(['resolveCode:quiz_share_codes:1']);
    expect(ms).toBeLessThan(7500);
  }, 20000);

  test('NODE_ENV=production -> inject is ignored: no hold, no line', async () => {
    process.env.NODE_ENV = 'production';
    flag = INJECT;
    const t0 = Date.now();
    await WQ.board('AB12CD');
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(retryLines()).toEqual([]);
  }, 15000);
});
