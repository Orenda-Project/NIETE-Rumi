'use strict';
/**
 * bd-2yyry.11 — the child's class card is SENT: to every child who finished,
 * at the moment the teacher's report goes out, never to the teacher, once
 * per child per quiz, behind CLASS_CARD_ENABLED.
 *
 * These tests execute generate() end to end with the PDF renderer failing
 * (so the teacher's report takes the text fallback, as the report suites do)
 * and the image renderer succeeding, and read what crossed the WhatsApp
 * boundary.
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
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const H = 60 * 60 * 1000;

const shareCode = (extra = {}) => ({
  id: SC, code: 'K7RM2', quiz_id: 'q1', teacher_user_id: 'u1',
  teacher_name: 'Miss Ayesha', topic: 'Proper Fractions', language: 'en', report_sent_at: null, ...extra,
});
const teacher = { id: 'u1', phone_number: TEACHER_PHONE, preferred_language: 'en' };
const base = { share_code_id: SC, user_id: null, invited_by_student_id: null, student_class: '4', status: 'completed', total_questions_answered: 8 };
const child = (id, studentId, phone, correct, completedAgoMs) => ({
  ...base, id, student_id: studentId, student_name: `Child ${studentId}`, parent_phone: phone,
  correct_answers: correct, mastery_percentage: Math.round(100 * correct / 8),
  created_at: iso(completedAgoMs + 5 * 60 * 1000), completed_at: iso(completedAgoMs),
});
const quizzes = (meta = {}) => [{ id: 'q1', meta, quiz_source: 'video', language: 'en', subject: 'maths', grade: '4' }];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLASS_CARD_ENABLED = 'true';
});
afterEach(() => { delete process.env.CLASS_CARD_ENABLED; });

describe('bd-2yyry.11 — the class card goes to the children when the report goes out', () => {
  test('scheduled report: one card per finished child, to the child, never the teacher; sends recorded on the quiz', async () => {
    const updates = stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 2 * H), child('s2', 'st-2', '923222222222', 8, 1 * H)],
    });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);

    const to = WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0]).sort();
    expect(to).toEqual(['923111111111', '923222222222']);
    expect(to).not.toContain(TEACHER_PHONE);
    // Each child's card is rendered for THEM — their own session is the target.
    expect(htmlToImage).toHaveBeenCalledTimes(2);
    const htmls = htmlToImage.mock.calls.map((c) => c[0]);
    expect(htmls[0]).toContain("class='row me'");
    expect(htmls.join('')).toContain('You came 2nd of 2');
    expect(htmls.join('')).toContain('You came 1st of 2');
    // The caption is in the quiz language and names nobody.
    const caption = WhatsAppService.sendImageFromBuffer.mock.calls[0][2];
    expect(caption).toContain('Proper Fractions');
    expect(caption).not.toMatch(/Child st-/);
    // Recorded, so a follow-up never sends twice.
    const meta = updates.filter((u) => u.table === 'quizzes').map((u) => u.patch.meta).find((m) => m && m.class_cards);
    expect(meta.class_cards[SC].sort()).toEqual(['st-1', 'st-2']);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.class_card_sent', expect.objectContaining({ shareCodeId: SC, studentId: 'st-1' }));
  });

  test('a second report the teacher asked for: only the children who have no card yet get one', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode({ report_sent_at: iso(3 * H) })], users: [teacher],
      quizzes: quizzes({ class_cards: { [SC]: ['st-1'] } }),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 4 * H), child('s2', 'st-2', '923222222222', 8, 1 * H)],
    });
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0])).toEqual(['923222222222']);
  });

  test('a child whose last answer is older than the free-form window is skipped, and the skip is logged', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 30 * H), child('s2', 'st-2', '923222222222', 8, 1 * H)],
    });
    await report.generate(SC, { reason: 'requested' });
    expect(WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0])).toEqual(['923222222222']);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.class_card_skipped', expect.objectContaining({ studentId: 'st-1', why: 'window' }));
  });

  test('flag unset: the report goes out, no card does', async () => {
    delete process.env.CLASS_CARD_ENABLED;
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 2 * H)],
    });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(WhatsAppService.sendMessage).toHaveBeenCalled();          // the teacher's report
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
  });

  test('a render failure for one child costs that child only, never the report', async () => {
    htmlToImage.mockRejectedValueOnce(new Error('boom'));
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes: quizzes(),
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 2 * H), child('s2', 'st-2', '923222222222', 8, 1 * H)],
    });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(WhatsAppService.sendImageFromBuffer).toHaveBeenCalledTimes(1);
  });
});
