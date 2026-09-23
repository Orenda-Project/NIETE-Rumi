'use strict';
/**
 * An LP-born quiz says PLANNED, never TAUGHT.
 *
 * The quiz is written from the lesson plan a teacher was served. Nobody heard
 * the lesson, so nothing the bot says about it may claim it happened (PLAN_R8
 * §2.3: "You planned…", never "You taught…"). Two places said taught:
 *
 *  1. the hand-off caption on the PDF (`tqHandoffIntro`: "This PDF is for you:
 *     what you taught, …" / «آپ نے کیا پڑھایا») — shared with the transcript
 *     quiz, where it IS true;
 *  2. the lesson summary printed at the top of that PDF — live on sandbox it
 *     read «آپ نے … سکھایا» ("you taught …"). The LP author rule asked for "you
 *     planned", but the gender rule beside it offers «آپ نے … پڑھایا» as THE
 *     neutral Urdu form, and the targeted rewrite of a rejected summary asked
 *     for "what you taught" outright, whatever the quiz's source.
 *
 * The transcript path keeps "taught" everywhere — that lesson WAS taught.
 *
 * Mocked at the boundary: supabase, WhatsApp, the queue, the LLM client, R2,
 * the PDF renderer and the share-code minter. Hand-off, author, rewrite and
 * generate run for real.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const r2 = require('../../bot/shared/storage/r2');
const { installFrom } = require('./helpers/supabase-chain');
const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { lessonLabel } = require('../../bot/shared/services/quiz/transcript-quiz-language');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const QID = '66666666-6666-4666-8666-666666666666';
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries out of every column'],
};
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};
/** A quiz whose code and PDF already exist, so the hand-off only captions and sends. */
const SENT_META = {
  digest: DIGEST, share_code: 'XYZ999', share_code_id: 'sc-old', link: 'https://wa.me/923000000000?text=QUIZ-XYZ999',
  student_message: 'forward me', pdf_key: 'transcript_quizzes/u-1/q.pdf', lesson_date: '2026-09-22',
};

function prepared({ quizSource, teacherLang }) {
  return {
    quiz: {
      id: QID, teacher_id: 'u-1', topic: 'Adding with carrying', subject: 'maths', language: 'en', grade: '2',
      status: 'sent', quiz_source: quizSource, coaching_session_id: quizSource === 'lp_v8' ? null : 's-1', meta: SENT_META,
    },
    session: { created_at: '2026-09-22T07:00:00Z' }, questions: null, qRows: [ROW], digest: DIGEST,
    teacherName: 'Rifat Noor', meta: SENT_META, language: 'en', teacherLang,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  r2.downloadFromR2.mockResolvedValue(Buffer.from('%PDF-1.4 stored'));
  installFrom(supabase.from, { quizzes: { data: [{ id: QID }] } });
});

// ── 1. the hand-off caption ───────────────────────────────────────────────────

describe('the PDF caption of an lp_v8 quiz says planned', () => {
  test.each(['en', 'ur'])('in %s it never says the lesson was taught', async (teacherLang) => {
    await Handoff.sendHandoff(QID, '923001234567', { prepared: prepared({ quizSource: 'lp_v8', teacherLang }) });
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).not.toMatch(/what you taught|you taught/i);
    expect(caption).not.toMatch(/پڑھایا|سکھایا/);
    expect(caption).toMatch(teacherLang === 'en' ? /planned/ : /منصوبہ/);
  });

  test('it is the lp caption key, filled like the transcript one', async () => {
    await Handoff.sendHandoff(QID, '923001234567', { prepared: prepared({ quizSource: 'lp_v8', teacherLang: 'en' }) });
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    const lesson = lessonLabel({ digest: DIGEST, quizLanguage: 'en', teacherLanguage: 'en' });
    expect(caption).toBe(resolveUx('tqHandoffIntroLp', { language: 'en', params: { lesson, n: 1 } }));
  });

  test('a transcript quiz keeps "what you taught" — that lesson was taught', async () => {
    await Handoff.sendHandoff(QID, '923001234567', { prepared: prepared({ quizSource: 'transcript', teacherLang: 'en' }) });
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toMatch(/what you taught/);
  });
});

// ── 2. the lesson summary the author writes ──────────────────────────────────

/** The prompt of the n-th LLM call. */
const promptOf = (n = 0) => completeJson.mock.calls[n][0].prompt;
/** The summary instruction of an author prompt: from its heading to the checks line. */
const summaryRule = (prompt) => prompt.slice(prompt.indexOf('LESSON SUMMARY.'), prompt.indexOf('"checks_summary"'));

describe('the author asks an lp_v8 summary to describe the plan, with the lesson as its subject', () => {
  beforeEach(() => {
    completeJson.mockResolvedValue({ json: { questions: [], lesson_summary: '' }, model: 'm', costUsd: 0, latencyMs: 1 });
  });

  test('the LP rule opens the summary on the lesson in both languages and bans "you taught" in both', async () => {
    await Author.author({ digest: DIGEST, language: 'ur', lessonPlan: 'WHAT THE CLASS WAS TO LEARN: carrying' });
    const rule = summaryRule(promptOf());
    expect(rule.length).toBeGreaterThan(50);
    expect(rule).toContain('Today\'s lesson plans');
    expect(rule).toContain('آج کے سبق میں');
    expect(rule).toMatch(/never[^.]*"you taught"/i);
    expect(rule).toMatch(/آپ نے … پڑھایا/);   // named as banned, not offered
    expect(rule).not.toMatch(/say what you taught/);
    expect(rule).not.toMatch(/say what you planned/);
  });

  test('a transcript quiz\'s summary rule is untouched — "you taught" is true there', async () => {
    await Author.author({ digest: DIGEST, language: 'ur', transcript: 'x'.repeat(2000) });
    const rule = summaryRule(promptOf());
    expect(rule).toMatch(/say what you taught and in the order you taught it/);
    expect(rule).not.toContain('آج کے سبق میں');
  });
});

// ── 3. the targeted rewrite of a rejected summary ────────────────────────────

const GOOD = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
  slo_id: i % 2 ? 'S1' : 'S2', level: i % 2 ? 'apply' : 'understand', question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
  options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
  explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
  selected_because: `Question ${i} checks adding two numbers in columns.`,
  distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
  option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
}));
const GENDERED = 'PEDAGOGY_GENDERED_TEACHER — "lesson_summary" refers to the teacher with a gendered word ("She").';

describe('the targeted rewrite of an lp_v8 summary keeps the plan voice', () => {
  beforeEach(() => {
    completeJson.mockResolvedValue({ json: { lesson_summary: 'Today\'s lesson plans column addition.' }, model: 'm', costUsd: 0, latencyMs: 1 });
  });

  test('planned: the rewrite asks for the lesson-as-subject summary, never "what you taught"', async () => {
    await Rewrite.rewriteRejected({
      questions: GOOD, errors: [GENDERED], digest: DIGEST, language: 'ur', lessonSummary: 'She planned carrying.', planned: true,
    });
    const prompt = promptOf();
    expect(prompt).not.toMatch(/say what you taught/);
    expect(prompt).toContain('آج کے سبق میں');
    expect(prompt).toContain('Today\'s lesson plans');
  });

  test('a transcript summary rewrite still asks for what was taught', async () => {
    await Rewrite.rewriteRejected({
      questions: GOOD, errors: [GENDERED], digest: DIGEST, language: 'ur', lessonSummary: 'She taught carrying.',
    });
    expect(promptOf()).toMatch(/say what you taught and in the order you taught it/);
  });

  test('generate tells the rewrite an lp_v8 quiz was planned', async () => {
    const slideScript = { meta: { grade: 2, subject: 'math' }, goal: 'Add with carrying', bloom: 'apply' };
    const lpQuiz = {
      id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Carrying',
      subject: 'maths', language: 'en', status: 'generating', grade: '2',
      meta: {
        step: 'author', digest: DIGEST, lesson_date: '2026-09-22',
        lessons: [{ lesson_id: 'grade_2_math_ch9_seg3', version_stamp: 'v', content_hash: 'h' }],
      },
    };
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [lpQuiz] }),
      niete_lp_asset_sources: { data: [{ asset_id: 'a', lesson_id: 'grade_2_math_ch9_seg3', version_stamp: 'v', content_hash: 'h', slide_script: slideScript, verified: 'upload' }] },
      quiz_questions: { data: [] },
      users: { data: [{ id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' }] },
    }));
    // The author's summary names the teacher "She": the validator rejects the
    // summary, and the targeted rewrite is asked to repair it.
    completeJson.mockResolvedValue({
      json: { lesson_summary: 'She planned column addition with carrying for the class.', questions: GOOD },
      model: 'm', costUsd: 0, latencyMs: 1,
    });
    const spy = jest.spyOn(Gen, 'rewriteRejected').mockResolvedValue({ attempted: false });
    process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS = '2';
    try {
      await Gen.process(QID, {});
    } finally {
      delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
    }
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toEqual(expect.objectContaining({ planned: true }));
    spy.mockRestore();
  });
});
