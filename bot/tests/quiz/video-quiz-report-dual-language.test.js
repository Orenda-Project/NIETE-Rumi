'use strict';
/**
 * bd-mg9c7.27 — the class report must read in the TEACHER's language while
 * quoting her class's questions in the QUIZ's language.
 *
 * The service took both from `quiz_share_codes.language`, so a teacher whose
 * stored preference is English received an entirely Urdu report — chrome,
 * plain-text fallback and the "for tomorrow" paragraph included — for a quiz
 * her class happened to take in Urdu. Rawalpindi's /videos flow hits this
 * every time.
 *
 * Driven through the real generate() so the parameter is proved to reach the
 * template and the model prompt, not merely to be passed one hop.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
}));

// The one network boundary the guidance paragraph crosses.
const captured = { prompts: [] };
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn(async ({ messages }) => {
        captured.prompts.push(messages[0].content);
        return { choices: [{ message: { content: 'They think a half is any small piece.' } }] };
      }),
    },
  },
})));

const supabase = require('../../shared/config/supabase');
const { htmlToPdf } = require('../../shared/utils/html-to-pdf');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const SHARE_CODE_ID = 'sc-1';

function stubSupabase({ shareCode, teacher, sessions, answers = [], questions = [], quiz = null }) {
  supabase.from.mockImplementation((table) => {
    const lists = {
      quiz_sessions: sessions,
      quiz_answers: answers,
      quiz_questions: questions,
    };
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      update: () => chain,
      maybeSingle: async () => {
        if (table === 'quiz_share_codes') return { data: shareCode };
        if (table === 'users') return { data: teacher };
        if (table === 'quizzes') return { data: quiz };
        return { data: null };
      },
      then: (resolve) => resolve({ data: lists[table] || [], error: null }),
    };
    return chain;
  });
}

const SHARE_CODE = {
  id: SHARE_CODE_ID, code: 'LWMZMN', quiz_id: 'q1', teacher_user_id: 'u1',
  teacher_name: 'Rifat Noor', topic: 'کسریں', language: 'ur', report_sent_at: null,
};
const SESSIONS = [
  { id: 's1', student_name: 'علی', student_class: '4', status: 'completed', total_questions_answered: 8, correct_answers: 6, mastery_percentage: 75 },
  { id: 's2', student_name: 'فاطمہ', student_class: '4', status: 'completed', total_questions_answered: 8, correct_answers: 4, mastery_percentage: 50 },
];
// Two children, same question, same wrong option — the minimum a "the class
// found this hard" signal is allowed to be built from.
const ANSWERS = [
  { question_id: 'q-1', selected_option: 'B', is_correct: false },
  { question_id: 'q-1', selected_option: 'B', is_correct: false },
];
const QUESTIONS = [{
  id: 'q-1', external_id: 'tq:S1:1', question_text: 'آدھی روٹی کا کسر کیا ہے؟',
  option_a: '½', option_b: '⅓', option_c: '¼', correct_option: 'A',
  option_feedback: { wrong: { 1: 'تین حصے نہیں تھے۔' } },
}];

beforeEach(() => { jest.clearAllMocks(); captured.prompts = []; });

describe('teacher en + quiz ur', () => {
  test('the PDF gets her language as chrome and the quiz language as content', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(htmlToPdf).toHaveBeenCalled();
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Worth reteaching/);
    expect(html).toMatch(/class="m-q content" dir="rtl"/);
  });

  test('the "for tomorrow" paragraph is asked for in HER language', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(captured.prompts).toHaveLength(1);
    expect(captured.prompts[0]).toMatch(/Write EXACTLY three sentences/);
    // The evidence itself stays in the language the class answered in.
    expect(captured.prompts[0]).toMatch(/آدھی روٹی/);
  });

  test('the plain-text fallback chrome is hers too when the PDF cannot render', async () => {
    htmlToPdf.mockResolvedValueOnce(null);
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const body = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(body).toMatch(/Quiz results/);
    expect(body).toMatch(/students finished/);
  });
});

describe('teacher ur + quiz ur', () => {
  test('everything stays Urdu', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'ur' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(captured.prompts[0]).toMatch(/بالکل تین جملے لکھیں/);
  });
});

describe('an unreadable stored preference falls back to the offer floor', () => {
  test('a null preferred_language does not put the report in the quiz language by accident', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: null },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
  });
});

describe('nobody opened the link yet', () => {
  test('the "no one has opened" note is in HER language, from the catalog', async () => {
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    const { resolveUx } = require('../../shared/config/ux-strings');
    WhatsAppService.sendMessage.mockClear();
    stubSupabase({
      shareCode: SHARE_CODE, teacher: { phone_number: '923000000000', preferred_language: 'ur' },
      sessions: [], answers: [], questions: QUESTIONS,
    });
    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const body = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(body).toBe(resolveUx('vqReportNoOne', { language: 'ur', params: { topic: SHARE_CODE.topic } }));
    expect(body).not.toMatch(/No one has opened/);
  });
});

describe('the SLO line survives the globally-unique external id', () => {
  test('tq:<quizId>:S1:1 still resolves to the digest statement (and the old tq:S1:1 shape still does too)', async () => {
    const digest = { slos: [{ id: 'S1', statement: 'آدھے کو کسر میں لکھنا' }] };
    for (const ext of ['tq:22222222-2222-4222-8222-222222222222:S1:1', 'tq:S1:1']) {
      htmlToPdf.mockClear();
      stubSupabase({
        shareCode: SHARE_CODE, teacher: { phone_number: '923001234567', preferred_language: 'en' },
        sessions: SESSIONS, answers: ANSWERS, questions: [{ ...QUESTIONS[0], external_id: ext }],
        quiz: { quiz_source: 'transcript', meta: { digest } },
      });
      await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });
      const html = htmlToPdf.mock.calls[0][0];
      expect(html).toMatch(/آدھے کو کسر میں لکھنا/);
    }
  });
});

describe('after the report, /quiz says so', () => {
  test('a transcript quiz flips to report_sent when its report goes out', async () => {
    stubSupabase({
      shareCode: SHARE_CODE, teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
      quiz: { quiz_source: 'transcript', meta: { digest: { slos: [] } } },
    });
    const updates = [];
    const orig = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      const chain = orig(table);
      if (table === 'quizzes') {
        const u = chain.update;
        chain.update = (patch) => { updates.push(patch); return chain; };
      }
      return chain;
    });
    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });
    expect(updates.some((p) => p.status === 'report_sent')).toBe(true);
  });
});
