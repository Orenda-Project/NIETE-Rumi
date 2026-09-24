'use strict';
/**
 * The quiz funnel, the children's side and the teacher's report:
 * child_joined → child_completed → scorecard_sent → class_cards → report_sent.
 *
 * Two production findings this suite holds (prod, 13 days to 24 Sep 2026):
 *
 *   D2 — 189 of 1,082 teacher reports (17.5%) were stamped `report_sent_at`
 *        with no `video_quiz.report_sent` event. Every one went through the same
 *        branch: the teacher's own test run is excluded, no child is left, the
 *        "nobody took it" message goes to the teacher, the share code is stamped
 *        — and nothing is logged. That branch is now `report_sent {kind:'no_one', n:0}`.
 *
 *   G6 — the child events carried the child-SESSION engine as `source`
 *        (share_link / video_solo), never the quiz stream, and they share their
 *        names with the video-lesson quiz: 6,488 of 23,779 child sessions in 14
 *        days were not a lesson quiz at all. Every child stage now carries the
 *        quiz's own stream, read with the quiz row finish() already reads (and
 *        one primary-key read when a session starts).
 *
 * Mocked: supabase, Redis, WhatsApp, the logger, and the child engine's own
 * send/render seams (not this suite's subject). The report runs through the real
 * generate() and the real template; the PDF engine is replaced.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('m1') }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-render.service', () => ({ build: jest.fn(() => ({})) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-sender.service', () => ({
  sendPhase: jest.fn().mockResolvedValue({ sent: 1, failed: 0, pickerFailed: false }),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-scorecard.service', () => ({ sendScorecard: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({ throttle: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../bot/shared/services/student-video-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Scorecard = require('../../bot/shared/services/quiz/video-quiz-scorecard.service');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const vq = require('../../bot/shared/services/quiz/video-quiz.service');
const report = require('../../bot/shared/services/quiz/video-quiz-report.service');

const QID = '11111111-1111-4111-8111-111111111111';
const SESS = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const TID = '44444444-4444-4444-8444-444444444444';
const QROW = { topic: 'Fractions', grade: '4', subject: 'maths', quiz_source: 'transcript', meta: {}, language: 'en' };

const funnel = (stage) => logEvent.mock.calls.filter((c) => c[0] === `quiz_funnel.${stage}`).map((c) => c[1]);

/** Per-table stub: awaited reads return lists, maybeSingle/single return one row. */
function stub({ quizRow = QROW, sessions = [], shareCode = null, teacher = null, answers = [{ question_id: 'q-1', is_correct: true }] } = {}) {
  supabase.from.mockImplementation((table) => {
    const list = {
      quiz_questions: [{ id: 'q-1', external_id: 'tq:S1:1', sort_order: 1 }],
      quiz_answers: answers,
      quiz_sessions: sessions,
    }[table] || [];
    const one = {
      quizzes: quizRow,
      quiz_sessions: { id: SESS },
      quiz_share_codes: shareCode,
      users: teacher,
    }[table] || null;
    const chain = {};
    ['select', 'eq', 'in', 'is', 'update', 'order', 'limit', 'insert', 'neq', 'not'].forEach((m) => { chain[m] = () => chain; });
    chain.single = async () => ({ data: one, error: null });
    chain.maybeSingle = async () => ({ data: one, error: null });
    chain.then = (resolve, reject) => Promise.resolve({ data: list, error: null }).then(resolve, reject);
    return chain;
  });
  supabase.rpc.mockResolvedValue({ data: null, error: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  WhatsAppService.sendMessage.mockResolvedValue(true);
  WhatsAppService.sendImageFromBuffer.mockResolvedValue(true);
  Scorecard.sendScorecard.mockResolvedValue(true);
  delete process.env.CLASS_CARD_ENABLED;
});
afterEach(() => { delete process.env.CLASS_CARD_ENABLED; });

describe('a child joins and finishes — each stage carries the quiz STREAM, not the session engine', () => {
  test('startSession → child_joined {quiz_id, session_id, source: the quiz_source}', async () => {
    stub();
    await vq.startSession({
      phone: '923009876543', userId: null, quizId: QID, videoId: null, language: 'en',
      source: 'share_link', studentName: 'A', shareCodeId: SC,
    });
    expect(funnel('child_joined')).toEqual([{ quiz_id: QID, session_id: SESS, share_code_id: SC, source: 'transcript' }]);
  });

  test('a quiz row that cannot be read does not stop the child: joined, with no stream', async () => {
    stub({ quizRow: null });
    const state = await vq.startSession({
      phone: '923009876543', userId: null, quizId: QID, videoId: null, language: 'en', source: 'share_link', shareCodeId: SC,
    });
    expect(state).toBeTruthy();
    expect(funnel('child_joined')).toEqual([{ quiz_id: QID, session_id: SESS, share_code_id: SC }]);
  });

  test('finish → child_completed {n, pct} and scorecard_sent {ok}, both on the quiz stream', async () => {
    stub({ quizRow: { ...QROW, quiz_source: 'lp_v8' } });
    await vq.finish('923009876543', {
      sessionId: SESS, quizId: QID, source: 'share_link', language: 'en', questionIds: ['q-1'], answered: 1, correct: 1,
    });
    expect(funnel('child_completed')).toEqual([{ quiz_id: QID, session_id: SESS, source: 'lp_v8', n: 1, pct: 100 }]);
    expect(funnel('scorecard_sent')).toEqual([{ quiz_id: QID, session_id: SESS, source: 'lp_v8', ok: true }]);
  });

  // Staging E2E, 25 Sep: the watcher read "children 2 joined → 1 finished" for a
  // quiz one child took — the other join was the teacher testing their own class
  // link. A share_link session carries a user id only when it is that self-test
  // (teacher-self-test.js: every child's share_link session has user_id null), so
  // the child stages say so, and the watcher can leave it out.
  test('the teacher\'s own run of the class link joins as kind:self_test — a child\'s join carries no kind', async () => {
    stub();
    await vq.startSession({
      phone: '920000000000', userId: TID, quizId: QID, videoId: null, language: 'en',
      source: 'share_link', studentName: 'T', shareCodeId: SC,
    });
    expect(funnel('child_joined')).toEqual([{ quiz_id: QID, session_id: SESS, share_code_id: SC, source: 'transcript', kind: 'self_test' }]);
  });

  test('a teacher\'s solo run of a video-lesson quiz (video_solo, no class link) is not a self-test of a class link', async () => {
    stub();
    await vq.startSession({
      phone: '920000000000', userId: TID, quizId: QID, videoId: 'v-1', language: 'en', source: 'video_solo',
    });
    expect(funnel('child_joined')[0].kind).toBeUndefined();
  });

  test('the self-test finishing: child_completed and scorecard_sent carry kind:self_test too', async () => {
    stub();
    await vq.finish('920000000000', {
      sessionId: SESS, quizId: QID, userId: TID, source: 'share_link', language: 'en', questionIds: ['q-1'], answered: 1, correct: 1,
    });
    expect(funnel('child_completed')).toEqual([{ quiz_id: QID, session_id: SESS, source: 'transcript', n: 1, pct: 100, kind: 'self_test' }]);
    expect(funnel('scorecard_sent')).toEqual([{ quiz_id: QID, session_id: SESS, source: 'transcript', ok: true, kind: 'self_test' }]);
  });

  test('a scorecard that could not be drawn is scorecard_sent {ok:false} — the text fallback went instead', async () => {
    stub();
    Scorecard.sendScorecard.mockResolvedValue(false);
    await vq.finish('923009876543', {
      sessionId: SESS, quizId: QID, source: 'share_link', language: 'en', questionIds: ['q-1'], answered: 1, correct: 1,
    });
    expect(funnel('scorecard_sent')).toEqual([expect.objectContaining({ quiz_id: QID, source: 'transcript', ok: false })]);
  });
});

const SHARE = {
  id: SC, code: 'K7RM2', quiz_id: QID, teacher_user_id: TID, teacher_name: 'T', topic: 'Fractions', language: 'en',
  created_at: '2026-09-20T05:00:00Z', report_sent_at: null,
};
const TEACHER = { phone_number: '920000000000', preferred_language: 'en', name: 'T' };
const done = (i) => ({
  id: `s${i}`, student_id: `k${i}`, student_name: `Child ${i}`, student_class: '4', status: 'completed', parent_phone: `92300000000${i}`,
  total_questions_answered: 4, correct_answers: 3, mastery_percentage: 75, completed_at: new Date(Date.now() - 3600e3).toISOString(),
});

describe('the teacher report', () => {
  test('D2 — nobody took the quiz: the teacher is told, the code is stamped, and report_sent {kind:no_one, n:0} is logged', async () => {
    stub({ shareCode: SHARE, teacher: TEACHER, sessions: [] });
    const sent = await report.generate(SC, { reason: 'scheduled' });
    expect(sent).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(funnel('report_sent')).toEqual([{
      quiz_id: QID, share_code_id: SC, source: 'transcript', kind: 'no_one', reason: 'scheduled', n: 0,
    }]);
  });

  test('a class report is report_sent {kind:report, n: children who finished}', async () => {
    stub({ shareCode: SHARE, teacher: TEACHER, sessions: [done(1), done(2)] });
    await report.generate(SC, { reason: 'requested', force: true });
    expect(funnel('report_sent')).toEqual([{
      quiz_id: QID, share_code_id: SC, source: 'transcript', kind: 'report', reason: 'requested', n: 2,
    }]);
  });

  test('a report owed to a teacher with no number is report_failed, not silence', async () => {
    stub({ shareCode: SHARE, teacher: null, sessions: [done(1)] });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(false);
    expect(funnel('report_failed')).toEqual([{ quiz_id: QID, share_code_id: SC, reason: 'no_teacher_phone' }]);
  });

  test('the class cards (leaderboards) sent with a report are one class_cards event: sent, failed, skipped', async () => {
    process.env.CLASS_CARD_ENABLED = 'true';
    const late = { ...done(3), completed_at: new Date(Date.now() - 30 * 3600e3).toISOString() };   // outside the window
    stub({ shareCode: SHARE, teacher: TEACHER, sessions: [done(1), done(2), late] });
    WhatsAppService.sendImageFromBuffer.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await report.generate(SC, { reason: 'requested', force: true });
    expect(funnel('class_cards')).toEqual([{
      quiz_id: QID, share_code_id: SC, source: 'transcript', n: 1, failed: 1, skipped: 1,
    }]);
  });
});
