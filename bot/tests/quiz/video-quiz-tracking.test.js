'use strict';
/**
 * bd-2396 / bd-2397 / bd-2398 — the three funnel-tracking gaps found in the
 * first live pull (2026-07-29, 2 days of prod data).
 *
 *  - bd-2396: video_quiz_deliveries.quiz_session_id was 0/44 in prod.
 *    startSession received deliveryId and dropped it, so offer→session
 *    conversion could only be inferred by a user+quiz join.
 *  - bd-2397: quiz_share_codes.uses_count was 0 on all 11 codes despite 5
 *    real child joins. Two causes: the .catch() fallback around the RPC was
 *    dead code (supabase .rpc() RESOLVES with {error}, it never rejects), and
 *    the Flow-join route never called the increment at all. The increment now
 *    lives in startSession — the one place every join route funnels through.
 *  - bd-2398: the CHECK constraint admits 'ignored' but nothing ever wrote
 *    it; unanswered offers sat at NULL forever, so response-rate queries had
 *    to guess what NULL meant. sweepIgnoredOffers stamps them after 24h.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-tracking.test.js
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn(),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// Question rendering/sending is not under test; stub the whole send layer so
// startSession can run to completion without a real question payload.
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({
  build: jest.fn(() => ({})),
}));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const { logToFile } = require('../../shared/utils/logger');
const vq = require('../../shared/services/quiz/video-quiz.service');

/**
 * A recording supabase.from stub. Every chain is thenable (the questions
 * lookup is awaited directly off .order()), records update/insert payloads
 * and filters, and answers per-table.
 */
function stubSupabase({ sessionId = 'sess-1' } = {}) {
  const calls = { updates: [], inserts: [] };
  supabase.from.mockImplementation((table) => {
    const rec = { table, filters: [] };
    const chain = {
      then(resolve) {
        // Awaiting the chain directly — only the quiz_questions list query
        // does this. Three questions is enough for a session.
        resolve({
          data: [
            { id: 'q-1', external_id: 'leg:1', sort_order: 1 },
            { id: 'q-2', external_id: 'gen:1', sort_order: 2 },
            { id: 'q-3', external_id: 'gen:2', sort_order: 3 },
          ],
          error: null,
        });
      },
      select: () => chain,
      order: () => chain,
      insert: (payload) => { calls.inserts.push({ table, payload }); return chain; },
      update: (payload) => { rec.payload = payload; calls.updates.push(rec); return chain; },
      eq: (col, val) => { rec.filters.push(['eq', col, val]); return chain; },
      is: (col, val) => { rec.filters.push(['is', col, val]); return chain; },
      lt: (col, val) => { rec.filters.push(['lt', col, val]); return chain; },
      single: async () => (table === 'quiz_sessions'
        ? { data: { id: sessionId }, error: null }
        : { data: { id: 'q-1', question_text: 'x', option_a: 'a', option_b: 'b', correct_option: 'A' }, error: null }),
      maybeSingle: async () => ({ data: { uses_count: 3 }, error: null }),
    };
    return chain;
  });
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe('bd-2396 — a solo session is written back onto its delivery row', () => {
  test('startSession stamps quiz_session_id on the delivery it came from', async () => {
    const calls = stubSupabase({ sessionId: 'sess-42' });

    await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', deliveryId: 'd-7', source: 'video_solo',
    });

    const write = calls.updates.find((u) => u.table === 'video_quiz_deliveries');
    expect(write).toBeDefined();
    expect(write.payload).toMatchObject({ quiz_session_id: 'sess-42' });
    expect(write.filters).toContainEqual(['eq', 'id', 'd-7']);
  });

  test('a share_link session (no deliveryId) does not touch deliveries', async () => {
    const calls = stubSupabase();

    await vq.startSession({
      phone: '923009876543', userId: null, quizId: 'qz1', videoId: 'v1',
      language: 'en', deliveryId: null, source: 'share_link',
      studentName: 'Ali', shareCodeId: 'sc-1',
    });

    expect(calls.updates.find((u) => u.table === 'video_quiz_deliveries')).toBeUndefined();
  });
});

describe('bd-2397 — every share-code join increments uses_count', () => {
  test('a share_link session calls the RPC with the code id', async () => {
    stubSupabase();

    await vq.startSession({
      phone: '923009876543', userId: null, quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'share_link', studentName: 'Ali', shareCodeId: 'sc-9',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('increment_share_code_uses',
      { code_id: 'sc-9' });
  });

  test('a solo session never calls the RPC', async () => {
    stubSupabase();

    await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', deliveryId: 'd-1', source: 'video_solo',
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('an RPC error is LOGGED and falls back to read-modify-write', async () => {
    // The original bug: .rpc() resolves with {error}, it never rejects, so a
    // .catch() fallback never ran and the failure was invisible. The fallback
    // must key off the resolved error object.
    const calls = stubSupabase();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });

    await vq.startSession({
      phone: '923009876543', userId: null, quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'share_link', studentName: 'Ali', shareCodeId: 'sc-9',
    });

    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('increment_share_code_uses'),
      expect.objectContaining({ error: 'function does not exist' }));
    const fallback = calls.updates.find((u) => u.table === 'quiz_share_codes');
    expect(fallback).toBeDefined();
    expect(fallback.payload).toMatchObject({ uses_count: 4 }); // 3 + 1
    expect(fallback.filters).toContainEqual(['eq', 'id', 'sc-9']);
  });

  test('an increment failure never blocks the quiz from starting', async () => {
    stubSupabase();
    supabase.rpc.mockRejectedValue(new Error('network down'));

    const state = await vq.startSession({
      phone: '923009876543', userId: null, quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'share_link', studentName: 'Ali', shareCodeId: 'sc-9',
    });

    expect(state).not.toBeNull();
  });
});

describe("bd-2398 — unanswered offers age out to 'ignored'", () => {
  test('sweepIgnoredOffers stamps NULL responses older than the cutoff', async () => {
    const calls = stubSupabase();

    await vq.sweepIgnoredOffers({ maxAgeHours: 24 });

    const sweep = calls.updates.find((u) => u.table === 'video_quiz_deliveries');
    expect(sweep).toBeDefined();
    expect(sweep.payload).toMatchObject({ quiz_response: 'ignored' });
    expect(sweep.filters).toContainEqual(['is', 'quiz_response', null]);
    const lt = sweep.filters.find((f) => f[0] === 'lt' && f[1] === 'quiz_offered_at');
    expect(lt).toBeDefined();
    const cutoff = new Date(lt[2]).getTime();
    // The cutoff is ~24h ago (loose bound: 23-25h).
    const age = Date.now() - cutoff;
    expect(age).toBeGreaterThan(23 * 3600 * 1000);
    expect(age).toBeLessThan(25 * 3600 * 1000);
  });

  test('rows with a quiz_offered_at of NULL are never swept', async () => {
    // A delivery whose offer was never sent (status short of offered) has
    // quiz_offered_at NULL; `lt` excludes NULL in SQL, but the filter must be
    // on quiz_offered_at — not created_at — for that to hold.
    const calls = stubSupabase();
    await vq.sweepIgnoredOffers({ maxAgeHours: 24 });
    const sweep = calls.updates.find((u) => u.table === 'video_quiz_deliveries');
    expect(sweep.filters.some((f) => f[1] === 'created_at')).toBe(false);
  });

  test('sweep failures are logged, never thrown (janitor contract)', async () => {
    supabase.from.mockImplementation(() => { throw new Error('db down'); });
    await expect(vq.sweepIgnoredOffers({ maxAgeHours: 24 })).resolves.not.toThrow();
    expect(logToFile).toHaveBeenCalled();
  });
});
