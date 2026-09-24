'use strict';
/**
 * bd-2yyry.13 — the child's /quiz: what it lists, how it opens, what the two
 * actions do. Executed against the service with the database, Redis and
 * WhatsApp at the boundary.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
  htmlToPdf: jest.fn().mockRejectedValue(new Error('n/a')),
}));
jest.mock('../../shared/services/quiz/student-identity.service', () => ({
  findByPhone: jest.fn().mockResolvedValue([{ id: 'st-1', student_name: 'Ayesha', self_reported_class: '4' }]),
  normalisePhone: (p) => String(p || '').replace(/^\+/, ''),
}));
jest.mock('../../shared/services/quiz/quiz-session.service', () => ({
  getActiveState: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/services/quiz/video-quiz-share.service', () => ({
  startForStudent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/services/quiz/video-quiz-report.service', () => ({
  loadClassRows: jest.fn(),
}));

const supabase = require('../../shared/config/supabase');
const redisService = require('../../shared/services/cache/railway-redis.service');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const share = require('../../shared/services/quiz/video-quiz-share.service');
const report = require('../../shared/services/quiz/video-quiz-report.service');
const QuizSession = require('../../shared/services/quiz/quiz-session.service');
const { resolveUx } = require('../../shared/config/ux-strings');
const ChildFlowToken = require('../../shared/services/quiz/child-flow-token');
const SQ = require('../../shared/services/quiz/student-quiz.service');

const PHONE = '923001234567';

function makeChain(rows) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (f, v) => { data = data.filter((r) => r[f] === v); return chain; },
    in: (f, vals) => { data = data.filter((r) => vals.includes(r[f])); return chain; },
    not: () => chain, is: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}
function stub(tables) { supabase.from.mockImplementation((t) => makeChain(tables[t] || [])); }

const SESSIONS = [
  { id: 's3', quiz_id: 'q1', share_code_id: 'sc-1', student_id: 'st-1', status: 'in_progress', correct_answers: 0, total_questions_answered: 1, mastery_percentage: 0, completed_at: null, created_at: '2026-09-14T10:00:00Z', student_class: '4' },
  { id: 's2', quiz_id: 'q1', share_code_id: 'sc-1', student_id: 'st-1', status: 'completed', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75, completed_at: '2026-09-14T09:05:00Z', created_at: '2026-09-14T09:00:00Z', student_class: '4' },
  { id: 's1', quiz_id: 'q1', share_code_id: 'sc-1', student_id: 'st-1', status: 'completed', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88, completed_at: '2026-09-13T09:05:00Z', created_at: '2026-09-13T09:00:00Z', student_class: '4' },
  { id: 's0', quiz_id: 'q0', share_code_id: 'sc-0', student_id: 'st-1', status: 'completed', correct_answers: 3, total_questions_answered: 8, mastery_percentage: 38, completed_at: '2026-09-10T09:05:00Z', created_at: '2026-09-10T09:00:00Z', student_class: '4' },
];
const CODES = [
  { id: 'sc-1', code: 'K7RM2X', active: true, expires_at: null, topic: 'Proper Fractions', language: 'en', quiz_id: 'q1', video_id: null, teacher_user_id: 't1' },
  { id: 'sc-0', code: 'OLDONE', active: false, expires_at: null, topic: 'Shapes', language: 'en', quiz_id: 'q0', video_id: null, teacher_user_id: 't1' },
];
const QUIZZES = [
  { id: 'q1', topic: 'Proper Fractions', subject: 'maths', language: 'en', grade: '4' },
  { id: 'q0', topic: 'Shapes', subject: 'maths', language: 'en', grade: '4' },
];
const STUDENTS = [{ id: 'st-1', student_name: 'Ayesha', self_reported_class: '4' }];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.STUDENT_QUIZ_FLOW_ID;
  redisService.get.mockResolvedValue(null);
  QuizSession.getActiveState.mockResolvedValue(null);
  stub({ quiz_sessions: SESSIONS, quiz_share_codes: CODES, quizzes: QUIZZES, students: STUDENTS });
});

describe('quizzesForHandset', () => {
  test('one entry per quiz, newest first: latest completed, best, attempt count, whether the link is still open', async () => {
    const list = await SQ.quizzesForHandset(PHONE);
    expect(list.map((q) => q.shareCodeId)).toEqual(['sc-1', 'sc-0']);
    const fr = list[0];
    expect(fr).toMatchObject({ topic: 'Proper Fractions', attempts: 3, active: true, code: 'K7RM2X', studentId: 'st-1', studentName: 'Ayesha' });
    expect(fr.latest.id).toBe('s2');     // the latest COMPLETED, not the abandoned retake
    expect(fr.best.id).toBe('s1');       // 7/8 beats 6/8
    expect(list[1].active).toBe(false);  // the closed link
  });
});

describe('open', () => {
  test('with STUDENT_QUIZ_FLOW_ID set: sends the child Flow with a childpick token for the latest quiz and THIS child', async () => {
    process.env.STUDENT_QUIZ_FLOW_ID = 'flow-sq';
    expect(await SQ.open(PHONE, { language: 'ur' })).toBe(true);
    const [to, flow] = WhatsAppService.sendFlow.mock.calls[0];
    expect(to).toBe(PHONE);
    expect(flow.flowId).toBe('flow-sq');
    expect(ChildFlowToken.parse(flow.flowToken)).toMatchObject({ shareCodeId: 'sc-1', studentId: 'st-1', language: 'en' });
    expect(Array.from(flow.header).length).toBeLessThanOrEqual(60);
    expect(Array.from(flow.buttonText).length).toBeLessThanOrEqual(20);
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('without the Flow: two buttons for the latest quiz, context kept for the tap', async () => {
    expect(await SQ.open(PHONE)).toBe(true);
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    const [, opts] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(opts.buttons.map((b) => b.id)).toEqual([SQ.RETRY_ID, SQ.CARD_ID]);
    for (const b of opts.buttons) expect(Array.from(b.title).length).toBeLessThanOrEqual(20);
    expect(opts.body).toContain('Proper Fractions');
    expect(opts.body).toContain('6/8');
    expect(redisService.set).toHaveBeenCalledWith(SQ.FALLBACK_KEY(PHONE), expect.objectContaining({ shareCodeId: 'sc-1', studentId: 'st-1', code: 'K7RM2X' }), expect.any(Number));
  });

  test('no quizzes on the handset: one line, nothing else', async () => {
    stub({ quiz_sessions: [], quiz_share_codes: CODES, quizzes: QUIZZES });
    expect(await SQ.open(PHONE)).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqNoQuizzes', { language: 'en' }));
    expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

describe('retry', () => {
  const ctx = { shareCodeId: 'sc-1', studentId: 'st-1', code: 'K7RM2X', active: true, language: 'en' };

  test('starts the quiz again for THIS child through the same start a tapped link runs', async () => {
    expect(await SQ.retry(PHONE, ctx)).toBe(true);
    expect(share.startForStudent).toHaveBeenCalledWith(PHONE,
      expect.objectContaining({ shareCodeId: 'sc-1', quizId: 'q1' }),
      expect.objectContaining({ id: 'st-1', student_name: 'Ayesha' }));
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqRetryStarting', { language: 'en' }));
  });

  test('a closed link is refused with one line (E20)', async () => {
    expect(await SQ.retry(PHONE, { ...ctx, active: false })).toBe(false);
    expect(share.startForStudent).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqCodeExpired', { language: 'en' }));
  });

  test('a quiz already in flight on the handset is not restarted (E19)', async () => {
    QuizSession.getActiveState.mockResolvedValue({ sessionId: 'live' });
    expect(await SQ.retry(PHONE, ctx)).toBe(false);
    expect(share.startForStudent).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqInFlight', { language: 'en' }));
  });

  // A class-link quiz runs on the VIDEO engine (its own Redis state). The
  // adaptive engine no longer adopts those sessions, so the live one is read
  // where it lives — and restarting over it would overwrite its state.
  test('a video / transcript / lesson-plan quiz waiting on a question is not restarted either', async () => {
    redisService.get.mockImplementation(async (k) => (k === `videoquiz:${PHONE}:active`
      ? { sessionId: 'vq-live', currentQuestionId: 'q-1', questionIds: ['q-1'] } : null));
    expect(await SQ.retry(PHONE, ctx)).toBe(false);
    expect(share.startForStudent).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqInFlight', { language: 'en' }));
  });
});

describe('sendCard', () => {
  test('renders the card for THIS child over the class rows the report counts and sends it to the child', async () => {
    report.loadClassRows.mockResolvedValue({
      shareCode: { id: 'sc-1', topic: 'Proper Fractions' }, language: 'en', className: 'Class 4', subject: 'maths',
      rows: [
        { sessionId: 's2', studentId: 'st-1', name: 'Ayesha', correct: 6, total: 8, pct: 75, completedAt: '2026-09-14T09:05:00Z' },
        { sessionId: 'x1', studentId: 'st-2', name: 'Bilal', correct: 8, total: 8, pct: 100, completedAt: '2026-09-14T08:05:00Z' },
      ],
    });
    expect(await SQ.sendCard(PHONE, { shareCodeId: 'sc-1', studentId: 'st-1', language: 'en' })).toBe(true);
    const { htmlToImage } = require('../../shared/utils/html-to-pdf');
    expect(htmlToImage.mock.calls[0][0]).toContain('You came 2nd of 2');
    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalledWith(PHONE, expect.any(Buffer), expect.stringContaining('Proper Fractions'));
  });

  test('a child who has not finished that quiz gets one line, no image (E22/E23)', async () => {
    report.loadClassRows.mockResolvedValue({ shareCode: { id: 'sc-1', topic: 'T' }, language: 'en', className: '', subject: '', rows: [] });
    expect(await SQ.sendCard(PHONE, { shareCodeId: 'sc-1', studentId: 'st-1', language: 'en' })).toBe(false);
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(PHONE, resolveUx('sqNoCardYet', { language: 'en' }));
  });
});

describe('handleButton — the fallback taps', () => {
  test('sq_retry consumes the kept context and retries; a foreign id is not ours', async () => {
    // Key-aware, as Redis is: the kept context lives under the fallback key
    // only (retry also reads the video quiz's own key, which is empty here).
    redisService.get.mockImplementation(async (k) => (k === SQ.FALLBACK_KEY(PHONE)
      ? { shareCodeId: 'sc-1', studentId: 'st-1', code: 'K7RM2X', active: true, language: 'en' } : null));
    expect(await SQ.handleButton('vq_more_yes', PHONE)).toBe(false);
    expect(await SQ.handleButton(SQ.RETRY_ID, PHONE)).toBe(true);
    expect(redisService.delete).toHaveBeenCalledWith(SQ.FALLBACK_KEY(PHONE));
    expect(share.startForStudent).toHaveBeenCalled();
  });
});
