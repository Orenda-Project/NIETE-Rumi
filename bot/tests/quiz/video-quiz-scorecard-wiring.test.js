'use strict';
/**
 * bd-2474 — finish() must send the scorecard IMAGE, not the plain text it
 * sends today, and it must do so BEFORE offering the invite-a-friend button
 * (share_link path) — that ordering already exists in the code for the
 * report + inviter-notify calls; the scorecard just needs to land in the
 * same slot the plain text currently occupies, ahead of all of it.
 *
 * finish() is not exported directly — it's reached by driving
 * sendNextQuestion() with state.index already at the end of the question
 * list, which is exactly how the real send loop reaches it.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
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
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({ sendPhase: jest.fn().mockResolvedValue(true) }));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  maybeSendEarly: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/services/quiz/video-quiz-invite.service', () => ({
  notifyInviter: jest.fn().mockResolvedValue(true),
  offerInvite: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-share.service', () => ({
  offerShare: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/student-video-feedback.service', () => ({
  scheduleFeedbackPrompt: jest.fn(),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const Report = require('../../shared/services/quiz/video-quiz-report.service');
const Invite = require('../../shared/services/quiz/video-quiz-invite.service');
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const vq = require('../../shared/services/quiz/video-quiz.service');

const QUIZ_META = { topic: 'Classification of Animals', grade: '5', subject: 'Science' };

function stubSupabase({ session = null } = {}) {
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      update: () => chain,
      maybeSingle: async () => {
        if (table === 'quizzes') return { data: QUIZ_META };
        if (table === 'quiz_sessions') return { data: session };
        return { data: null };
      },
    };
    return chain;
  });
}

function finishingState(overrides = {}) {
  return {
    sessionId: 'sess-1', quizId: 'q1', videoId: 'v1', userId: 'u1',
    language: 'en', source: 'video_solo', shareCodeId: null, studentId: null,
    questionIds: ['a', 'b'], index: 2, correct: 2, answered: 2,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('bd-2474 — the scorecard image replaces the plain-text completion message', () => {
  test('sendScorecard is called with the real quiz topic/grade/subject and the score', async () => {
    stubSupabase();
    await vq.sendNextQuestion('923001234567', finishingState());

    expect(Scorecard.sendScorecard).toHaveBeenCalledWith('923001234567', expect.objectContaining({
      topic: 'Classification of Animals', grade: '5', subject: 'Science',
      correct: 2, total: 2, pct: 100,
    }));
  });

  test('when the scorecard sends successfully, the old plain-text message is NOT also sent', async () => {
    stubSupabase();
    Scorecard.sendScorecard.mockResolvedValueOnce(true);

    await vq.sendNextQuestion('923001234567', finishingState());

    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(
      '923001234567', expect.stringMatching(/All done/));
  });

  test('when the scorecard fails, the plain-text message still sends — a child never gets nothing', async () => {
    stubSupabase();
    Scorecard.sendScorecard.mockResolvedValueOnce(false);

    await vq.sendNextQuestion('923001234567', finishingState());

    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(
      '923001234567', expect.stringMatching(/All done/));
  });
});

describe('bd-2474 — ordering: scorecard lands before the invite-a-friend offer', () => {
  test('for a share_link finisher, sendScorecard is called before Invite.offerInvite', async () => {
    stubSupabase({ session: { quiz_id: 'q1', invited_by_student_id: null } });

    await vq.sendNextQuestion('923001234567', finishingState({
      source: 'share_link', shareCodeId: 'sc-1', studentId: 'stu-1',
    }));

    expect(Scorecard.sendScorecard).toHaveBeenCalled();
    expect(Invite.offerInvite).toHaveBeenCalled();
    const scorecardOrder = Scorecard.sendScorecard.mock.invocationCallOrder[0];
    const inviteOrder = Invite.offerInvite.mock.invocationCallOrder[0];
    expect(scorecardOrder).toBeLessThan(inviteOrder);
  });

  test('the early-report check and inviter notification still run for a share_link finisher', async () => {
    stubSupabase({ session: { quiz_id: 'q1', invited_by_student_id: 'friend-1' } });

    await vq.sendNextQuestion('923001234567', finishingState({
      source: 'share_link', shareCodeId: 'sc-1', studentId: 'stu-1',
    }));

    expect(Report.maybeSendEarly).toHaveBeenCalledWith('sc-1');
    expect(Invite.notifyInviter).toHaveBeenCalled();
  });
});
