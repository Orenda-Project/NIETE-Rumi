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
 * PLAN_R4 D1 (bd-mg9c7.48) REVERSES the split for the DOCUMENT specifically:
 * the operator's staging report mixed English chrome with Urdu question
 * content and read as broken ("if it is in English why does it have Urdu in
 * it"). The PDF and its plain-text substitute now render ENTIRELY in the
 * quiz's own content language. Only the WhatsApp CAPTION that carries the
 * PDF still follows her stored preference — a caption is an interstitial,
 * not part of the document (Tariq's rule, unchanged).
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

// The one network boundary the guidance box crosses. generateGuidance now
// asks for (and parses) JSON — {muddled, board, check} in the reteach mode
// every test here exercises — so the fixture reply is JSON, not prose.
const captured = { prompts: [] };
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn(async ({ messages }) => {
        captured.prompts.push(messages[0].content);
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                muddled: 'They think a half is any small piece.',
                board: 'Draw a half and a third on the board.',
                check: 'What is a half?',
              }),
            },
          }],
        };
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

describe('D1 — teacher en + quiz ur: the DOCUMENT follows the quiz, not her', () => {
  test('the PDF is entirely in the quiz\'s content language, chrome included', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(htmlToPdf).toHaveBeenCalled();
    const html = htmlToPdf.mock.calls[0][0];
    // Both `language` (chrome) and `contentLanguage` reach the template as
    // the SAME value now — the quiz's own language — not her preference.
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/دوبارہ پڑھانے کے قابل/);
    expect(html).not.toMatch(/Worth reteaching/);
  });

  test('the "for tomorrow" box is asked for in the DOCUMENT\'s (content) language, not hers', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(captured.prompts).toHaveLength(1);
    // The JSON schema keys are language-agnostic; the instruction PROSE and
    // the evidence both come through in Urdu because the quiz is Urdu.
    expect(captured.prompts[0]).toMatch(/"muddled"/);
    expect(captured.prompts[0]).toMatch(/رومن اردو میں ہرگز نہیں/);
    expect(captured.prompts[0]).toMatch(/آدھی روٹی/);
  });

  test('the plain-text fallback stays in the DOCUMENT language even though her preference is English', async () => {
    htmlToPdf.mockResolvedValueOnce(null);
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const body = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(body).toMatch(/کوئز کے نتائج/);
    expect(body).toMatch(/طلبہ نے مکمل کیا/);
    expect(body).not.toMatch(/Quiz results/);
  });

  test('the WhatsApp CAPTION still follows HER preference — the one part of the send that stays hers', async () => {
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toMatch(/Class results/);
    expect(caption).not.toMatch(/کلاس کے نتائج/);
  });
});

describe('D1 — the footer stamp is part of the document, so it is dated in the document language', () => {
  test('an Urdu quiz gets an Urdu-month stamp, never the en-GB one', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const html = htmlToPdf.mock.calls[0][0];
    const stamp = (html.match(/<div class="stamp content" dir="[a-z]+">([^<]*(?:<span[^>]*>[^<]*<\/span>[^<]*)*)<\/div>/) || [])[1] || '';
    // The Urdu month names formatLessonDate() ships; one of them must be the
    // one in this stamp, and no English three-letter month may be.
    expect(stamp).toMatch(/[\u0600-\u06FF]/);
    expect(stamp).not.toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  });

  test('the roster prints the class label in the document language', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'en' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const html = htmlToPdf.mock.calls[0][0];
    // The label is isolated in its own .ltr span under RTL, so match the cell
    // and then look inside it rather than assuming the text sits bare.
    const cells = html.match(/<div class="cls">[\s\S]*?<\/div>/g) || [];
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => {
      expect(cell).not.toMatch(/Grade/);
      expect(cell).toMatch(/جماعت/);
    });
  });
});

describe('teacher ur + quiz ur (both sides the same, unaffected by D1)', () => {
  test('everything stays Urdu', async () => {
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: 'ur' },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(captured.prompts[0]).toMatch(/"muddled"/);
    expect(captured.prompts[0]).toMatch(/رومن اردو میں ہرگز نہیں/);
  });
});

describe('D1 — the CAPTION falls back to the offer floor on an unreadable preference; the DOCUMENT does not care', () => {
  test('a null preferred_language leaves the document in the quiz language and floors only the caption', async () => {
    const WhatsAppService = require('../../shared/services/whatsapp.service');
    stubSupabase({
      shareCode: SHARE_CODE,
      teacher: { phone_number: '923001234567', preferred_language: null },
      sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
    });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toMatch(/Class results/);   // floored to English, not guessed Urdu
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

/**
 * bd-mg9c7.48 (lane C manager pass) — the PDF and the WhatsApp text fallback
 * are the SAME document on two surfaces. They were shipping two different
 * vocabularies for the same three parts ("Check question" in the PDF,
 * "چیک سوال" in the fallback; "Secure" vs "کیا پکا ہوا ہے"), which is exactly
 * the drift a teacher notices and we do not.
 */
describe('bd-mg9c7.48 — the fallback and the PDF name the reteach parts identically', () => {
  const LABELS = {
    en: ['What they muddled', 'On the board', 'Check question', 'Secure', 'One to stretch them'],
    ur: ['کیا الجھن ہوئی', 'بورڈ پر', 'جانچ کا سوال', 'یہ پکا ہو گیا', 'ایک اور آگے کا سوال'],
  };

  ['en', 'ur'].forEach((lang) => {
    test(`every ${lang} guidance label in the template's CHROME also appears in the text fallback`, async () => {
      htmlToPdf.mockResolvedValueOnce(null);
      const WhatsAppService = require('../../shared/services/whatsapp.service');
      stubSupabase({
        shareCode: { ...SHARE_CODE, language: lang },
        teacher: { phone_number: '923001234567', preferred_language: lang },
        sessions: SESSIONS, answers: ANSWERS, questions: QUESTIONS,
      });

      await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

      const body = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
      // The reteach shape is the one this fixture exercises; its three labels
      // must be the template's, character for character.
      LABELS[lang].slice(0, 3).forEach((label) => expect(body).toContain(label));
      // and none of the other language's labels leaked in with them
      LABELS[lang === 'en' ? 'ur' : 'en'].forEach((label) => expect(body).not.toContain(label));
    });
  });
});
