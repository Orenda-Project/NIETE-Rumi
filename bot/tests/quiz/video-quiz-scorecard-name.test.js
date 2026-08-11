'use strict';
/**
 * bd-2481 — the scorecard should carry the quiz-taker's name.
 *
 * Two paths:
 *  - video_solo (a teacher taking the quiz herself via /video -> Select
 *    Video): no name is ever collected in this flow, so startSession must
 *    resolve it from `users` (first_name/last_name) by userId.
 *  - share_link (a child on a shared class link): already gives a name at
 *    join time (video-quiz-share.service.js), which startSession already
 *    receives as `studentName` — that value must be used as-is, no lookup.
 *
 * The resolved name is carried on session state as `takerName` and threaded
 * through finish() -> Scorecard.sendScorecard() -> the template.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn() }));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-share.service', () => ({
  offerShare: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(),
}));

const supabase = require('../../shared/config/supabase');
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const vq = require('../../shared/services/quiz/video-quiz.service');

// startSession() always calls sendNextQuestion() internally — give it a
// harmless default so tests that only care about the resolved name don't
// need to think about question delivery.
sender.sendPhase.mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false });

/** Per-table answering stub — users vs quizzes vs quiz_sessions vs quiz_questions. */
function stubSupabase({ sessionId = 'sess-1', user = null } = {}) {
  const inserts = [];
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: () => chain,
      order: () => chain,
      eq: () => chain,
      update: () => chain,
      insert: (payload) => { inserts.push({ table, payload }); return chain; },
      then: (resolve) => {
        // Only quiz_questions is awaited directly off the chain.
        resolve({
          data: [{ id: 'q-1', external_id: 'leg:1', sort_order: 1 }],
          error: null,
        });
      },
      single: async () => (table === 'quiz_sessions'
        ? { data: { id: sessionId }, error: null }
        : { data: { id: 'q-1', question_text: 'x', option_a: 'a', option_b: 'b', correct_option: 'A' }, error: null }),
      maybeSingle: async () => {
        if (table === 'users') return { data: user, error: null };
        if (table === 'quizzes') return { data: { topic: 't', grade: 4, subject: 'Science' }, error: null };
        return { data: null, error: null };
      },
    };
    return chain;
  });
  return { inserts };
}

beforeEach(() => {
  jest.clearAllMocks();
  supabase.rpc.mockResolvedValue({ data: null, error: null });
});

describe('bd-2481 — resolving the taker\'s name at startSession time', () => {
  test('video_solo with no studentName resolves the teacher\'s name from users', async () => {
    stubSupabase({ user: { first_name: 'Ayesha', last_name: 'Khan' } });

    const state = await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'video_solo',
    });

    expect(state.takerName).toBe('Ayesha Khan');
  });

  test('video_solo when the user lookup finds nothing leaves takerName null (not "null")', async () => {
    stubSupabase({ user: null });

    const state = await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'video_solo',
    });

    expect(state.takerName).toBeNull();
  });

  test('share_link with a studentName already given uses it as-is — no users lookup', async () => {
    stubSupabase({ user: { first_name: 'Should Not Be Used' } });

    const state = await vq.startSession({
      phone: '923009876543', userId: null, quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'share_link', studentName: 'Ali', shareCodeId: 'sc-1',
    });

    expect(state.takerName).toBe('Ali');
  });

  test('the resolved name is also written onto quiz_sessions.student_name', async () => {
    const { inserts } = stubSupabase({ user: { first_name: 'Ayesha', last_name: 'Khan' } });

    await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'video_solo',
    });

    const sessionInsert = inserts.find((i) => i.table === 'quiz_sessions');
    expect(sessionInsert.payload).toMatchObject({ student_name: 'Ayesha Khan' });
  });
});

describe('bd-2481 — finish() threads takerName through to the scorecard', () => {
  test('sendScorecard is called with the resolved takerName', async () => {
    stubSupabase({ user: { first_name: 'Ayesha', last_name: 'Khan' } });
    sender.sendPhase.mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false });

    const state = await vq.startSession({
      phone: '923001234567', userId: 'u1', quizId: 'qz1', videoId: 'v1',
      language: 'en', source: 'video_solo',
    });
    state.answered = 1;
    state.correct = 1;
    state.index = state.questionIds.length; // force straight to finish()

    await vq.sendNextQuestion('923001234567', state);

    expect(Scorecard.sendScorecard).toHaveBeenCalledWith('923001234567',
      expect.objectContaining({ takerName: 'Ayesha Khan' }));
  });
});
