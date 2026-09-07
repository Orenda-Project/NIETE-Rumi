'use strict';
/**
 * TQ-R5 lane H — "the quiz is complete, the kid gets offered video, or to send
 * to another friend. Make sure all these have telemetry" (operator).
 *
 * A UNIFORM two-event funnel across every post-quiz offer:
 *   video_quiz.offer_shown    { kind, sessionId, quizId, source, language }
 *   video_quiz.offer_answered { kind, choice, ... }
 * kind ∈ quiz | invite | share | binge | feedback. Plus the point events:
 * scorecard_sent, binge_started/binge_unavailable, feedback_answered.
 *
 * Modeled on the mocking style of video-quiz-tracking.test.js: stub
 * supabase/redis/whatsapp/logger/structured-logger, drive the real services.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
  setNX: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/constants', () => ({ STUDENT_VIDEOS_FLOW_ID: 'flow-123' }));
// Question rendering/sending and the heavy image/PDF services are not under
// test here; stub them so the real offer/finish code can run to completion.
jest.mock('../../shared/services/quiz/video-quiz-render.service', () => ({
  build: jest.fn(() => ({})),
}));
jest.mock('../../shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-scorecard.service', () => ({
  sendScorecard: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  maybeSendFollowUp: jest.fn().mockResolvedValue(undefined),
  scheduleForShareCode: jest.fn().mockResolvedValue(undefined),
}));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { logEvent } = require('../../shared/utils/structured-logger');
const Scorecard = require('../../shared/services/quiz/video-quiz-scorecard.service');
const vq = require('../../shared/services/quiz/video-quiz.service');
const Invite = require('../../shared/services/quiz/video-quiz-invite.service');
const Binge = require('../../shared/services/quiz/video-quiz-binge.service');
const Share = require('../../shared/services/quiz/video-quiz-share.service');
const StudentVideoFeedback = require('../../shared/services/student-video-feedback.service');

function eventsNamed(name) {
  return logEvent.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

/** A per-table recording supabase.from stub, generic enough for finish()'s reads. */
function stubSupabase(responses = {}) {
  supabase.from.mockImplementation((table) => {
    const chain = {
      select: () => chain,
      update: () => chain,
      insert: () => chain,
      eq: () => chain,
      order: () => chain,
      maybeSingle: async () => responses[table] || { data: null, error: null },
      // Only the feedback-insert path in this file calls .single() (the
      // 'quiz_sessions' insert it mirrors is spied over via startSession),
      // so a fixed synthetic row is enough here.
      single: async () => ({ data: { id: 'fb-1' }, error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  redisService.set.mockResolvedValue(true);
  redisService.delete.mockResolvedValue(true);
  Scorecard.sendScorecard.mockResolvedValue(true);
});

// ─── finish() ───────────────────────────────────────────────────────────────

describe('finish() — share_link session', () => {
  const state = () => ({
    sessionId: 'sess-1', quizId: 'qz1', videoId: 'v1', userId: null,
    language: 'en', source: 'share_link', shareCodeId: 'sc-1', studentId: 'stu-1',
    takerName: 'Ali Khan', answered: 5, correct: 5,
  });

  test('emits offer_shown{kind:"invite"} and scorecard_sent', async () => {
    stubSupabase({
      quizzes: { data: { topic: 'Numbers', grade: '3', subject: 'Maths' }, error: null },
      quiz_sessions: {
        data: {
          quiz_id: 'qz1', student_name: 'Ali Khan', correct_answers: 5,
          total_questions_answered: 5, mastery_percentage: 100, invited_by_student_id: null,
        },
        error: null,
      },
    });

    await vq.finish('923001234567', state());

    const scorecardEvents = eventsNamed('video_quiz.scorecard_sent');
    expect(scorecardEvents).toHaveLength(1);
    expect(scorecardEvents[0]).toMatchObject({
      sessionId: 'sess-1', quizId: 'qz1', ok: true, fallback: false, pct: 100, language: 'en',
    });

    const shown = eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'invite');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: 'invite', sessionId: 'sess-1', quizId: 'qz1', language: 'en' });
  });

  test('scorecard_sent reflects a failed image send (fallback path)', async () => {
    stubSupabase({
      quizzes: { data: { topic: 'Numbers', grade: '3', subject: 'Maths' }, error: null },
      quiz_sessions: { data: { quiz_id: 'qz1', invited_by_student_id: null }, error: null },
    });
    Scorecard.sendScorecard.mockResolvedValue(false);

    await vq.finish('923001234567', state());

    const scorecardEvents = eventsNamed('video_quiz.scorecard_sent');
    expect(scorecardEvents[0]).toMatchObject({ ok: false, fallback: true });
  });
});

describe('finish() — video_solo session', () => {
  const state = () => ({
    sessionId: 'sess-2', quizId: 'qz1', videoId: 'v1', userId: 'u1',
    language: 'en', source: 'video_solo', answered: 5, correct: 4,
  });

  test('emits offer_shown{kind:"share"}, and does NOT yet claim the feedback offer', async () => {
    stubSupabase({
      quizzes: { data: { topic: 'Numbers', grade: '3', subject: 'Maths' }, error: null },
    });

    await vq.finish('923001234567', state());

    const shareShown = eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'share');
    expect(shareShown).toHaveLength(1);
    expect(shareShown[0]).toMatchObject({
      kind: 'share', sessionId: 'sess-2', quizId: 'qz1', language: 'en', sent: true,
    });

    // finish() only SCHEDULES the survey (30 s later, and the send can fail).
    // An offer nobody has received yet is not an offer shown, so the event
    // belongs to the send, not to finish() — see the sendFeedbackPrompt block.
    expect(eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'feedback')).toHaveLength(0);
  });
});

// ─── the post-quiz survey: shown at SEND time, not at schedule time ────────

describe('sendFeedbackPrompt — offer_shown{kind:"feedback"}', () => {
  beforeEach(() => { logEvent.mockClear(); WhatsAppService.sendInteractiveButtons.mockResolvedValue(true); });

  const ctx = (scope) => ({
    videoId: 'v1', userId: 'u1', phone: '923001234567',
    context: { language: 'en', scope, quizSessionId: 'sess-2', deliveryId: null },
  });

  test('fires once when the post-quiz survey actually sends', async () => {
    await StudentVideoFeedback.sendFeedbackPrompt(ctx('video_and_quiz'));
    const shown = eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'feedback');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: 'feedback', sessionId: 'sess-2', language: 'en' });
  });

  test('does not fire when the send fails — an undelivered offer is not shown', async () => {
    WhatsAppService.sendInteractiveButtons.mockResolvedValue(false);
    await StudentVideoFeedback.sendFeedbackPrompt(ctx('video_and_quiz'));
    expect(eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'feedback')).toHaveLength(0);
  });

  test('does not fire for a bare-video survey — that is a different offer', async () => {
    await StudentVideoFeedback.sendFeedbackPrompt(ctx('video'));
    expect(eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'feedback')).toHaveLength(0);
  });
});

// ─── handleOfferButton (the quiz offer) ────────────────────────────────────

describe('handleOfferButton — carries kind:"quiz" and choice, keeps accepted/shared', () => {
  const offer = { userId: 'u1', quizId: 'qz1', videoId: 'v1', language: 'en', deliveryId: null };

  beforeEach(() => {
    redisService.get.mockResolvedValue(offer);
    stubSupabase();
  });

  test('yes', async () => {
    jest.spyOn(vq, 'startSession').mockResolvedValue({});
    await vq.handleOfferButton(vq.OFFER_YES, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'quiz');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'quiz', choice: 'yes', accepted: true, shared: false });
    vq.startSession.mockRestore();
  });

  test('no', async () => {
    await vq.handleOfferButton(vq.OFFER_NO, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'quiz');
    expect(events[0]).toMatchObject({ kind: 'quiz', choice: 'no', accepted: false, shared: false });
  });

  test('share', async () => {
    jest.spyOn(Share, 'deliverClassLink').mockResolvedValue(true);
    await vq.handleOfferButton(vq.OFFER_SHARE, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'quiz');
    expect(events[0]).toMatchObject({ kind: 'quiz', choice: 'share', accepted: true, shared: true });
    Share.deliverClassLink.mockRestore();
  });
});

// ─── handleInviteButton → binge chain ───────────────────────────────────────

describe('handleInviteButton — funnel + binge chain', () => {
  beforeEach(() => {
    redisService.get.mockResolvedValue({
      studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en', sessionId: 'sess-1', quizId: 'qz1',
    });
  });

  test('NO: offer_answered{kind:invite,choice:no} AND offer_shown{kind:binge}', async () => {
    await Invite.handleInviteButton(Invite.INVITE_NO, '923001234567');

    const answered = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'invite');
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({ kind: 'invite', choice: 'no' });

    const shown = eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'binge');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ kind: 'binge', sessionId: 'sess-1', quizId: 'qz1' });
  });

  test('YES: offer_answered{kind:invite,choice:yes}', async () => {
    stubSupabase({}); // no parent share code found -> early return, no mint
    await Invite.handleInviteButton(Invite.INVITE_YES, '923001234567');

    const answered = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'invite');
    expect(answered[0]).toMatchObject({ kind: 'invite', choice: 'yes' });
    expect(eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'binge')).toHaveLength(0);
  });

  test('an old in-flight ctx without sessionId/quizId still answers cleanly', async () => {
    redisService.get.mockResolvedValue({ studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en' });
    await expect(Invite.handleInviteButton(Invite.INVITE_NO, '923001234567')).resolves.toBe(true);
    const shown = eventsNamed('video_quiz.offer_shown').filter((e) => e.kind === 'binge');
    expect(shown[0]).toMatchObject({ kind: 'binge', sessionId: null, quizId: null });
  });
});

// ─── handleShareButton ──────────────────────────────────────────────────────

describe('handleShareButton — offer_answered both branches', () => {
  const ctx = { quizId: 'qz1', videoId: 'v1', userId: 'u1', language: 'en', sessionId: 'sess-1' };

  test('no', async () => {
    redisService.get.mockResolvedValue(ctx);
    await Share.handleShareButton(Share.SHARE_NO, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'share');
    expect(events[0]).toMatchObject({ kind: 'share', choice: 'no' });
  });

  test('yes', async () => {
    redisService.get.mockResolvedValue(ctx);
    jest.spyOn(Share, 'deliverClassLink').mockResolvedValue(true);
    await Share.handleShareButton(Share.SHARE_YES, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'share');
    expect(events[0]).toMatchObject({ kind: 'share', choice: 'yes' });
    Share.deliverClassLink.mockRestore();
  });
});

// ─── handleMoreButton (binge) ───────────────────────────────────────────────

describe('handleMoreButton — offer_answered + binge_started/unavailable', () => {
  const ctx = { studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en', sessionId: 'sess-1', quizId: 'qz1' };

  test('no', async () => {
    redisService.get.mockResolvedValue(ctx);
    await Binge.handleMoreButton(Binge.MORE_NO, '923001234567');
    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'binge');
    expect(events[0]).toMatchObject({ kind: 'binge', choice: 'no' });
    expect(eventsNamed('video_quiz.binge_started')).toHaveLength(0);
  });

  test('yes: a successful Flow send emits binge_started', async () => {
    redisService.get.mockResolvedValue(ctx);
    WhatsAppService.sendFlow.mockResolvedValue(true);
    await Binge.handleMoreButton(Binge.MORE_YES, '923001234567');

    const events = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'binge');
    expect(events[0]).toMatchObject({ kind: 'binge', choice: 'yes' });

    const started = eventsNamed('video_quiz.binge_started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ sessionId: 'sess-1', quizId: 'qz1', shareCodeId: 'sc-1' });
    expect(eventsNamed('video_quiz.binge_unavailable')).toHaveLength(0);
  });

  test('yes: a failed Flow send emits binge_unavailable, not binge_started', async () => {
    redisService.get.mockResolvedValue(ctx);
    WhatsAppService.sendFlow.mockResolvedValue(false);
    await Binge.handleMoreButton(Binge.MORE_YES, '923001234567');

    expect(eventsNamed('video_quiz.binge_started')).toHaveLength(0);
    const unavail = eventsNamed('video_quiz.binge_unavailable');
    expect(unavail).toHaveLength(1);
    expect(unavail[0]).toMatchObject({ reason: 'flow_send_failed' });
  });
});

// ─── student-video-feedback: post-quiz gate ────────────────────────────────

describe('handleFeedbackButton — video_quiz.feedback_answered only when quiz-linked', () => {
  const VIDEO_ID = '11111111-1111-1111-1111-111111111111';

  test('a scope-linked tap emits feedback_answered with quizSessionId/useful/videoId', async () => {
    redisService.get.mockImplementation((key) => {
      if (key === `student_video_feedback_scope:user-1:${VIDEO_ID}`) {
        return Promise.resolve({ scope: 'video_and_quiz', quizSessionId: 'sess-9', deliveryId: null });
      }
      return Promise.resolve(null);
    });
    stubSupabase({
      student_videos: { data: { id: VIDEO_ID, grade: '3', subject: 'Maths', clean_chapter: 'C', clean_title: 'T' }, error: null },
      users: { data: { id: 'user-1', preferred_language: 'en' }, error: null },
    });

    const ok = await StudentVideoFeedback.handleFeedbackButton(`student_video_feedback_yes_${VIDEO_ID}__vq`, '923001234567');
    expect(ok).toBe(true);

    const events = eventsNamed('video_quiz.feedback_answered');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ quizSessionId: 'sess-9', useful: true, videoId: VIDEO_ID });
    // offer_answered uses `sessionId` for EVERY kind, so one funnel query joins them.
    const answered = eventsNamed('video_quiz.offer_answered').filter((e) => e.kind === 'feedback');
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({ kind: 'feedback', choice: 'useful', sessionId: 'sess-9' });
  });

  test('a bare-video tap (no quiz link) never emits feedback_answered', async () => {
    redisService.get.mockResolvedValue(null); // no scope row stored
    stubSupabase({
      student_videos: { data: { id: VIDEO_ID, grade: '3', subject: 'Maths' }, error: null },
      users: { data: { id: 'user-2', preferred_language: 'en' }, error: null },
    });

    await StudentVideoFeedback.handleFeedbackButton(`student_video_feedback_no_${VIDEO_ID}`, '923001234567');
    expect(eventsNamed('video_quiz.feedback_answered')).toHaveLength(0);
  });
});

// ─── privacy ────────────────────────────────────────────────────────────────

describe('privacy — no event payload leaks a phone number or a name', () => {
  test('across a realistic mixed run, only ids/enums/booleans/counts cross', async () => {
    // A rich run: a share_link finish (studentId + a real taker name in STATE,
    // never logged) followed by an invite decline into the binge offer.
    stubSupabase({
      quizzes: { data: { topic: 'Numbers', grade: '3', subject: 'Maths' }, error: null },
      quiz_sessions: { data: { quiz_id: 'qz1', invited_by_student_id: null }, error: null },
    });
    await vq.finish('923001234567', {
      sessionId: 'sess-3', quizId: 'qz1', videoId: 'v1', userId: null,
      language: 'en', source: 'share_link', shareCodeId: 'sc-1', studentId: 'stu-1',
      takerName: 'Ayesha Bibi', answered: 5, correct: 5,
    });

    redisService.get.mockResolvedValue({
      studentId: 'stu-1', shareCodeId: 'sc-1', language: 'en', sessionId: 'sess-3', quizId: 'qz1',
    });
    await Invite.handleInviteButton(Invite.INVITE_NO, '923001234567');

    const BAD_KEYS = new Set(['phone', 'takerName', 'studentName', 'name']);
    expect(logEvent.mock.calls.length).toBeGreaterThan(0);
    for (const [, payload] of logEvent.mock.calls) {
      if (!payload || typeof payload !== 'object') continue;
      for (const [key, value] of Object.entries(payload)) {
        expect(BAD_KEYS.has(key)).toBe(false);
        if (typeof value === 'string') {
          expect(value).not.toMatch(/\d{10,}/);
        }
      }
    }
  });
});
