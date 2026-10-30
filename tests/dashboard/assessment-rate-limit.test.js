/**
 * The per-teacher soft limit on making papers: 10 an hour, 30 a day, behind
 * `assessment_rate_limit_enabled` (app_settings, absent = off).
 *
 * Why: a board-pattern paper costs several model calls, and the heaviest teacher today made 21 papers
 * in one hour. A limit that a teacher can read ("the next one can be made at 11:40") is a better day
 * than a queue that backs up for everyone.
 *
 * Off is the default, and off means the proxy behaves exactly as before: the count query never runs.
 * A failed count never blocks a teacher (the limit fails open; the flag fails closed).
 */

// Not a suite about the sign-in account check: every session user reads as live (tests/fixtures/portal-auth-live.js).
require('../fixtures/portal-auth-live').installLivePortalAccounts();

const { setup, invoke, BOT } = require('./portal-proxy-harness');

const NOW = new Date('2026-10-16T06:40:00.000Z'); // 11:40 PKT
const minsAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const rows = (...mins) => mins.map((m) => ({ created_at: minsAgo(m) }));

const FLAG_ON = [{ key: 'assessment_rate_limit_enabled', value: true }];
const BODY = { grade: 5, subject: 'maths', pattern: 'fde_g5_2027', scope: 'fde', questionCount: 0,
  contentSource: 'unseen', questionTypes: [], answerLines: true, outputFormat: 'pdf' };

let edges;
beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => { jest.useRealTimers(); jest.resetModules(); });

describe('check() — the count', () => {
  const lib = () => require('../../dashboard/lib/assessment-rate-limit');

  test('under both limits → ok', async () => {
    const dbQuery = jest.fn(async () => ({ rows: rows(1, 2, 3, 4, 5, 6, 7, 8, 9) }));
    expect(await lib().check(dbQuery, 'teacher-1', NOW)).toEqual({ ok: true });
  });

  test('the 11th request in an hour is refused until the 10th-newest ages out', async () => {
    const dbQuery = jest.fn(async () => ({ rows: rows(1, 2, 3, 4, 5, 6, 7, 8, 9, 50) }));
    const out = await lib().check(dbQuery, 'teacher-1', NOW);
    expect(out.ok).toBe(false);
    expect(out.window).toBe('hour');
    expect(out.retryAt).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString()); // 50 min ago + 60 min
  });

  test('30 in a day is refused until the 30th-newest ages out', async () => {
    const day = Array.from({ length: 30 }, (_, i) => 70 + i * 40); // none in the last hour
    const dbQuery = jest.fn(async () => ({ rows: rows(...day) }));
    const out = await lib().check(dbQuery, 'teacher-1', NOW);
    expect(out.ok).toBe(false);
    expect(out.window).toBe('day');
    expect(out.retryAt).toBe(new Date(new Date(minsAgo(70 + 29 * 40)).getTime() + 24 * 3600_000).toISOString());
  });

  test('the count query is bounded: one teacher, the last 24 h, at most 30 rows, newest first', async () => {
    const dbQuery = jest.fn(async () => ({ rows: [] }));
    await lib().check(dbQuery, 'teacher-1', NOW);
    const [sql, params] = dbQuery.mock.calls[0];
    expect(sql).toMatch(/FROM assessment_requests/i);
    expect(sql).toMatch(/WHERE user_id = \$1 AND created_at > \$2/i);
    expect(sql).toMatch(/ORDER BY created_at DESC/i);
    expect(sql).toMatch(/LIMIT 30\b/i);
    expect(params).toEqual(['teacher-1', new Date(NOW.getTime() - 24 * 3600_000).toISOString()]);
  });

  test('message names the limit and the time in Pakistan', () => {
    expect(lib().message({ ok: false, window: 'hour', retryAt: '2026-10-16T06:40:00.000Z' }))
      .toBe('You have made 10 papers this hour. The next one can be made at 11:40.');
    expect(lib().message({ ok: false, window: 'day', retryAt: '2026-10-16T13:05:00.000Z' }))
      .toBe('You have made 30 papers today. The next one can be made at 18:05.');
  });
});

describe('the generate proxy with the limit', () => {
  test('flag off (absent) → never counted, the bot is asked as before', async () => {
    edges = setup({ appSettings: [], dbRows: rows(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11) });
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-1' } });
    const { statusCode } = await invoke('post', '/assessment/generate', { body: BODY });
    expect(statusCode).toBe(202);
    expect(edges.dbQuery).not.toHaveBeenCalled();
    expect(edges.axios.post.mock.calls[0][0]).toBe(`${BOT}/api/internal/assessment/create`);
  });

  test('flag set to anything but true → off', async () => {
    edges = setup({ appSettings: [{ key: 'assessment_rate_limit_enabled', value: 'yes' }], dbRows: rows(1, 2, 3, 4, 5, 6, 7, 8, 9, 10) });
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-1' } });
    expect((await invoke('post', '/assessment/generate', { body: BODY })).statusCode).toBe(202);
    expect(edges.dbQuery).not.toHaveBeenCalled();
  });

  test('flag on + the 11th request in an hour → 429 RATE_LIMITED and the bot is not asked', async () => {
    edges = setup({ appSettings: FLAG_ON, dbRows: rows(1, 2, 3, 4, 5, 6, 7, 8, 9, 50) });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: BODY });
    expect(statusCode).toBe(429);
    expect(payload).toEqual({
      success: false,
      error: 'You have made 10 papers this hour. The next one can be made at 11:50.',
      errorCode: 'RATE_LIMITED',
      retryAt: '2026-10-16T06:50:00.000Z',
    });
    expect(edges.axios.post).not.toHaveBeenCalled();
    expect(edges.dbQuery.mock.calls[0][1][0]).toBe('teacher-1'); // the session's teacher
  });

  test('flag on + under the limit → the bot is asked', async () => {
    edges = setup({ appSettings: FLAG_ON, dbRows: rows(5, 30) });
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-9' } });
    const { statusCode, payload } = await invoke('post', '/assessment/generate', { body: BODY });
    expect(statusCode).toBe(202);
    expect(payload).toEqual({ success: true, requestId: 'r-9' });
  });

  test('flag on + the count fails → the teacher is not blocked', async () => {
    edges = setup({ appSettings: FLAG_ON, dbRows: () => { throw new Error('pool exhausted'); } });
    edges.axios.post.mockResolvedValueOnce({ status: 200, data: { success: true, requestId: 'r-10' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { statusCode } = await invoke('post', '/assessment/generate', { body: BODY });
    expect(statusCode).toBe(202);
  });
});
