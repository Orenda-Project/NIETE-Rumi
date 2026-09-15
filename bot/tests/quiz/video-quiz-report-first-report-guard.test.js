'use strict';
/**
 * bd-2yyry.18 — the teacher's report waits for its scheduled time.
 *
 * Every completion asks generate() for a follow-up. Before any report has
 * gone out that path had no timing guard, so the FIRST child to finish sent
 * the teacher's report — measured on production 8–15 Sep 2026: median one
 * child on the report, 970 of 1,059 reports sent that way. A follow-up
 * before the first report is now suppressed; the scheduled job and the
 * teacher's own request still send.
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
const quizzes = [{ id: 'q1', meta: {}, quiz_source: 'video', language: 'en', subject: 'maths', grade: '4' }];

const teacherGotSomething = () => WhatsAppService.sendMessage.mock.calls.some((c) => c[0] === TEACHER_PHONE)
  || WhatsAppService.sendDocument.mock.calls.some((c) => c[0] === TEACHER_PHONE);

beforeEach(() => { jest.clearAllMocks(); process.env.CLASS_CARD_ENABLED = 'true'; });
afterEach(() => { delete process.env.CLASS_CARD_ENABLED; });

describe('bd-2yyry.18 — a completion never sends the first report', () => {
  test('follow_up before any report: suppressed, nothing to the teacher, no card, report_sent_at untouched', async () => {
    const updates = stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes,
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 5 * 60 * 1000)],
    });
    expect(await report.generate(SC, { reason: 'follow_up' })).toBe(false);
    expect(teacherGotSomething()).toBe(false);
    expect(WhatsAppService.sendImageFromBuffer).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === 'quiz_share_codes')).toEqual([]);
    expect(logEvent).toHaveBeenCalledWith('video_quiz.report_suppressed',
      expect.objectContaining({ shareCodeId: SC, reason: 'follow_up', why: 'before_first_report' }));
  });

  test('the scheduled job still sends the first report (and the cards ride with it)', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes,
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 5 * 60 * 1000)],
    });
    expect(await report.generate(SC, { reason: 'scheduled' })).toBe(true);
    expect(teacherGotSomething()).toBe(true);
    expect(WhatsAppService.sendImageFromBuffer.mock.calls.map((c) => c[0])).toEqual(['923111111111']);
  });

  test('the teacher asking from /quiz still sends at once', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode()], users: [teacher], quizzes,
      quiz_sessions: [child('s1', 'st-1', '923111111111', 8, 5 * 60 * 1000)],
    });
    expect(await report.generate(SC, { reason: 'requested', force: true })).toBe(true);
    expect(teacherGotSomething()).toBe(true);
  });

  test('after the first report a follow-up still obeys the once-and-material rule', async () => {
    stubSupabase({
      quiz_share_codes: [shareCode({ report_sent_at: iso(3 * H) })], users: [teacher],
      quizzes: [{ ...quizzes[0], meta: { class_cards: { [SC]: ['st-1'] } } }],
      quiz_sessions: [child('s1', 'st-1', '923111111111', 6, 4 * H), child('s2', 'st-2', '923222222222', 8, 1 * H)],
    });
    // one new child on a class of one = "half again as many" → a follow-up is material
    expect(await report.generate(SC, { reason: 'follow_up' })).toBe(true);
    expect(teacherGotSomething()).toBe(true);
  });
});
