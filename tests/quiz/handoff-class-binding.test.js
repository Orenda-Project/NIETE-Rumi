'use strict';
/**
 * The lesson/coaching quiz hand-out (sendHandoff, first send from generate())
 * asks the same ONE class question as a video hand-out: known → bound at mint;
 * ambiguous → the PDF and the link go out exactly as before (unbound), THEN
 * the question, and a tap binds that code; none → unbound, as before.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
// The real share service (the parked hand-out lives there), with minting stubbed.
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  ...jest.requireActual('../../bot/shared/services/quiz/video-quiz-share.service'),
  mintCode: jest.fn().mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555', code: 'ABC234', teacherName: 'Teacher Testwala' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(), set: jest.fn(), delete: jest.fn(), setNX: jest.fn(),
}));
jest.mock('../../bot/shared/services/quiz/web-quiz-identity', () => ({ resolveQuizClass: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const Identity = require('../../bot/shared/services/quiz/web-quiz-identity');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const HandoutClass = require('../../bot/shared/services/quiz/handout-class.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '33333333-3333-4333-8333-333333333333';
const C4A = { id: '44444444-4444-4444-8444-44444444444a', label: '4-A', listId: null };
const C4B = { id: '44444444-4444-4444-8444-44444444444b', label: '4-B', listId: null };
const DIGEST = {
  topic: 'Fractions', subject: 'maths', grade_band: '3-5', language_of_instruction: 'en', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }],
};
const SESSION = { id: SID, created_at: '2026-09-05T05:00:00Z' };
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};

let quiz;
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => {
      const up = calls.find((c) => c[0] === 'update');
      if (up) { quiz = { ...quiz, ...up[1] }; return { data: [{ id: QID }] }; }
      return { data: [quiz] };
    },
    coaching_sessions: { data: [SESSION] },
    users: { data: [{ preferred_language: 'en', name: 'Teacher Testwala' }] },
    quiz_questions: { data: [ROW] },
  });
}
function prepared() {
  const meta = { digest: DIGEST, cost_usd: 0.01 };
  quiz = {
    id: QID, teacher_id: TEACHER_ID, topic: 'Fractions', subject: 'maths', language: 'en', grade: null,
    status: 'ready', coaching_session_id: SID, quiz_source: 'transcript', meta,
  };
  wire();
  return {
    quiz, session: SESSION, questions: null, qRows: [ROW], digest: DIGEST,
    teacherName: 'Teacher Testwala', meta, language: 'en', teacherLang: 'en',
  };
}

let store;
beforeEach(() => {
  jest.clearAllMocks();
  store = new Map();
  redis.get.mockImplementation(async (k) => (store.has(k) ? store.get(k) : null));
  redis.set.mockImplementation(async (k, v) => { store.set(k, v); return true; });
  redis.delete.mockImplementation(async (k) => { store.delete(k); return true; });
  redis.setNX.mockImplementation(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; });
  HandoutClass._resetForTests();
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});

describe('sendHandoff binds the code to a KNOWN class', () => {
  test('known → mintCode gets the classId', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'known', class: C4A, classes: [C4A] });
    const r = await Handoff.sendHandoff(QID, '920000000001', { firstSend: true, prepared: prepared() });
    expect(r.ok).toBe(true);
    expect(Identity.resolveQuizClass).toHaveBeenCalledWith(expect.objectContaining({ teacherUserId: TEACHER_ID, quizId: QID }));
    expect(Share.mintCode).toHaveBeenCalledWith(expect.objectContaining({ quizId: QID, classId: C4A.id }));
  });

  test('ambiguous → the PDF and the link go out unbound FIRST, then ONE question about that code', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4B, C4A] });
    const r = await Handoff.sendHandoff(QID, '920000000001', { firstSend: true, prepared: prepared() });
    expect(r.ok).toBe(true);
    expect(Share.mintCode.mock.calls[0][0].classId).toBeNull();
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const lastSend = Math.max(...WhatsAppService.sendMessage.mock.invocationCallOrder, ...WhatsAppService.sendDocument.mock.invocationCallOrder);
    expect(WhatsAppService.sendInteractiveButtons.mock.invocationCallOrder[0]).toBeGreaterThan(lastSend);
    const [, body] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(body.buttons.map((b) => b.title)).toEqual(['4-A', '4-B', 'All / not sure']);
    expect(quiz.status).toBe('sent');
  });

  test('the tap binds the code the PDF and link already carry', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'ambiguous', class: null, classes: [C4A, C4B] });
    await Handoff.sendHandoff(QID, '920000000001', { firstSend: true, prepared: prepared() });
    const tap = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons[1].id;
    jest.clearAllMocks();
    installFrom(supabase.from, { quiz_share_codes: { data: null }, quizzes: { data: [quiz] }, classes: { data: [{ grade_code: 'grade_4' }] } });

    expect(await HandoutClass.handleTap(tap, '920000000001')).toBe(true);

    const upd = supabase.from.callsFor('quiz_share_codes').flat().find((c) => c[0] === 'update');
    expect(upd[1]).toEqual({ class_id: C4B.id });
    expect(Share.mintCode).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1])
      .toBe(resolveUx('vqWhichClassBound', { language: 'en', params: { cls: '4-B' } }));
  });

  test('known → no question', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'known', class: C4A, classes: [C4A] });
    await Handoff.sendHandoff(QID, '920000000001', { firstSend: true, prepared: prepared() });
    expect(WhatsAppService.sendInteractiveButtons).not.toHaveBeenCalled();
    expect(WhatsAppService.sendInteractiveMessage).not.toHaveBeenCalled();
  });

  test('a resend never resolves (it reuses the code it already has)', async () => {
    Identity.resolveQuizClass.mockResolvedValue({ state: 'known', class: C4A, classes: [C4A] });
    const p = prepared();
    p.meta = { ...p.meta, share_code: 'XYZ999', share_code_id: 'sc-old', link: 'https://x', student_message: 'msg' };
    await Handoff.sendHandoff(QID, '920000000001', { prepared: p });
    expect(Identity.resolveQuizClass).not.toHaveBeenCalled();
    expect(Share.mintCode).not.toHaveBeenCalled();
  });
});
