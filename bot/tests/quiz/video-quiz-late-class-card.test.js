'use strict';
/**
 * bd-2yyry.18 — a child who finishes AFTER the teacher's report still gets
 * their class card, straight away, without another message to the teacher.
 *
 * The child has just answered, so they are inside WhatsApp's free-form
 * window; the card is a free image. The teacher's messaging is untouched:
 * the scheduled report plus at most the one existing follow-up.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no renderer in test env')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png')),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const { htmlToImage } = require('../../shared/utils/html-to-pdf');
const { logEvent } = require('../../shared/utils/structured-logger');
const report = require('../../shared/services/quiz/video-quiz-report.service');

function makeListChain(rows, updates, table) {
  let data = [...(rows || [])];
  const chain = {
    select: () => chain,
    eq: (field, val) => { data = data.filter((r) => r[field] === val); return chain; },
    is: (field, val) => {
      data = data.filter((r) => (val === null ? (r[field] === null || r[field] === undefined) : r[field] === val));
      return chain;
    },
    in: (field, vals) => { data = data.filter((r) => vals.includes(r[field])); return chain; },
    order: () => chain,
    limit: () => chain,
    update: (patch) => { updates.push({ table, patch }); return chain; },
    maybeSingle: async () => ({ data: data[0] || null, error: null }),
    then: (resolve) => resolve({ data, error: null }),
  };
  return chain;
}
function stubSupabase(tables) {
  const updates = [];
  supabase.from.mockImplementation((table) => makeListChain(tables[table] || [], updates, table));
  return updates;
}

const SC = 'sc-1';
const TEACHER_PHONE = '923001234567';
const H = 60 * 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const shareCode = (extra = {}) => ({
  id: SC, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 'u1',
  teacher_name: 'Miss Ayesha', topic: 'Proper Fractions', language: 'en', report_sent_at: null, ...extra,
});
const teacher = { id: 'u1', phone_number: TEACHER_PHONE, preferred_language: 'en' };
const child = (id, studentId, phone, correct, completedAgoMs) => ({
  share_code_id: SC, user_id: null, invited_by_student_id: null, student_class: '4', status: 'completed',
  total_questions_answered: 8, id, student_id: studentId, student_name: `Child ${studentId}`, parent_phone: phone,
  correct_answers: correct, mastery_percentage: Math.round(100 * correct / 8),
  created_at: iso(completedAgoMs + 5 * 60 * 1000), completed_at: iso(completedAgoMs),
});
const quizzes = (meta = {}) => [{ id: 'q1', meta, quiz_source: 'video', language: 'en', subject: 'maths', grade: '4' }];

beforeEach(() => { jest.clearAllMocks(); process.env.CLASS_CARD_ENABLED = 'true'; });
afterEach(() => { delete process.env.CLASS_CARD_ENABLED; });

describe('bd-2yyry.18 — sendLateClassCards()', () => {
  test('report already out: the late finisher gets a card ranked against the whole class; nothing to the teacher; recorded', async () => {
    const updates = stubSupabase({
      quiz_share_codes: [shareCode({ report_sent_at: iso(2 * H) })], users: [teacher],
      quizzes: quizzes({ class_cards: { [SC]: ['st-1'] } }),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 3 * H), child('s2', 'st-2', '923222222222', 6, 2 * 60 * 1000)],
    });
    const out = await report.sendLateClassCards(SC);
    expect(out).toEqual(expect.objectContaining({ sent: 1 }));
    expect(WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0])).toEqual(['923222222222']);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
    const html = htmlToImage.mock.calls[0][0];
    expect(html).toContain('You came 2nd of 2');
    const meta = updates.filter((u) => u.table === 'quizzes').map((u) => u.patch.meta).find((m) => m && m.class_cards);
    expect(meta.class_cards[SC].sort()).toEqual(['st-1', 'st-2']);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.class_card_sent',
      expect.objectContaining({ shareCodeId: SC, studentId: 'st-2', reason: 'late' }));
  });

  test('no report yet: nothing is sent — the card rides with the scheduled report', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 2 * 60 * 1000)],
    });
    expect(await report.sendLateClassCards(SC)).toEqual(expect.objectContaining({ sent: 0, why: 'no_report_yet' }));
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('already carded: a second completion sends nothing', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode({ report_sent_at: iso(2 * H) })], users: [teacher],
      quizzes: quizzes({ class_cards: { [SC]: ['st-1', 'st-2'] } }),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 3 * H), child('s2', 'st-2', '923222222222', 6, 2 * 60 * 1000)],
    });
    expect(await report.sendLateClassCards(SC)).toEqual(expect.objectContaining({ sent: 0 }));
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('flag unset: nothing is sent', async () => {
    delete process.env.CLASS_CARD_ENABLED;
    stubSupabase({
      quiz_share_codes: [shareCode({ report_sent_at: iso(2 * H) })], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s2', 'st-2', '923222222222', 6, 2 * 60 * 1000)],
    });
    expect(await report.sendLateClassCards(SC)).toEqual(expect.objectContaining({ sent: 0 }));
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
  });
});
