'use strict';
/**
 * Generate a quiz for a Grades 6-12 lesson the teacher was served (lp612).
 *
 * An lp612 quiz row has no coaching session and no K-5 slide script: it names
 * the delivered lesson by its render's version triple in meta.lessons[0]
 * ({segment_id, lang, template_version}). The generate step must read THAT
 * document (R2, exact version), adapt it to the slide-script shape, and run the
 * one LP path — digest, author, key check, the teacher PDF saying "What you
 * planned" — exactly as it does for an lp_v8 quiz. Before this change an lp612
 * row was read as a transcript quiz and failed `session_missing`.
 *
 * Mocked at the boundary: supabase, WhatsApp, the queue, R2, the PDF renderer,
 * the share-code minter and the LLM-backed digest/author/key-check seams. The
 * adapter and the generate step run for real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => {
  const real = jest.requireActual('../../bot/shared/services/quiz/lp-quiz-digest.service');
  return { ...real, run: jest.fn() };
});
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Test Teacher', topic: 'Matrices' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('PNG')),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const r2 = require('../../bot/shared/storage/r2');
const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const Source = require('../../bot/shared/services/quiz/lp612-quiz-source');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');
const DOC = require('../lp612/__fixtures__/v9_gate_base.lp.json');

const QID = '55555555-5555-4555-8555-555555555555';
const LESSON = {
  segment_id: 'grade_9_mathematics.c01.p024-025', lang: 'en', template_version: 'v9.6', render_id: 'r-1',
  delivered_at: '2026-09-22T04:10:00Z', title: 'Multiplying two 2×2 matrices',
};
const LP612_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp612', topic: LESSON.title,
  subject: 'maths', language: 'en', status: 'generating', grade: '9',
  meta: { step: 'digest', source: 'quiz_menu', lessons: [LESSON], class: { grade: 9, subject: 'maths' }, lesson_date: '2026-09-22' },
};
const USER = { id: 'u-1', name: 'Test Teacher', phone_number: '923001234567', preferred_language: 'en' };
const DIGEST = {
  topic: 'Matrix multiplication', topic_as_taught: LESSON.title, subject: 'maths', grade_band: '9-10', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['2×2 matrices'], misconceptions_surfaced: ['multiplies matching positions'],
};

function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: is the product of a 2×${i} and a ${i}×2 matrix defined?`,
    options: ['Yes, the inner orders match', 'No, the outer orders differ', 'Only if the matrices are equal'], correct_index: 0,
    explanation: 'A product is defined when the inner orders match.',
    selected_because: `Question ${i} checks when a product is defined.`,
    distractor_misconceptions: { 1: 'reads the outer orders', 2: 'confuses defined with equal' },
    option_feedback: { correct: 'Yes — inner orders match.', wrong: { 1: 'Look at the inner orders.', 2: 'Equality is not needed.' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.QUIZ_LP612_SOURCE = 'on';
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  jest.spyOn(Gen, 'checkKeys').mockImplementation(async ({ questions }) => ({
    verdicts: questions.map((_, index) => ({ index, verdict: 'consistent', quote: '' })), model: 'kc', costUsd: 0, latencyMs: 1,
  }));
  r2.downloadFromR2.mockResolvedValue(Buffer.from(JSON.stringify(DOC)));
  LpDigest.run.mockResolvedValue({
    digest: DIGEST, grade: '9', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10,
  });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned matrix multiplication.' });
});

function wire({ quiz = LP612_QUIZ } = {}) {
  installFrom(supabase.from, ({
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp612 quiz must never query coaching_sessions'); },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);

describe('process — an lp612 quiz is written from the 6-12 lesson the teacher was served', () => {
  test('reads that exact document, digests it through the LP path, authors, checks keys and ships', async () => {
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(supabase.from.callsFor('coaching_sessions')).toHaveLength(0);
    expect(Store.resolveSlideScript).not.toHaveBeenCalled();
    expect(r2.downloadFromR2).toHaveBeenCalledWith('lp612/v9.6/en/grade_9_mathematics.c01.p024-025.lp.json');

    const expected = Source.toSlideScript(DOC, { lang: 'en' });
    expect(Digest.run).not.toHaveBeenCalled();
    expect(LpDigest.run).toHaveBeenCalledWith(expect.objectContaining({
      slideScript: expected, grade: '9', subject: 'maths', lessonName: LESSON.title, quizSource: 'lp612',
    }));
    const authorArgs = Author.author.mock.calls[0][0];
    expect(authorArgs.transcript).toBeNull();
    expect(authorArgs.lessonPlan).toContain(DOC.objectives.outcome);
    // The key check holds every key against the 6-12 lesson's own answers.
    expect(Gen.checkKeys).toHaveBeenCalledWith(expect.objectContaining({ slideScript: expected }));

    const updates = quizUpdates();
    expect(updates[updates.length - 1].status).toBe('sent');
    const ready = logEvent.mock.calls.find((c) => c[0] === 'transcript_quiz.ready');
    expect(ready[1].quiz_source).toBe('lp612');
  });

  test('the teacher\'s PDF says what was PLANNED, and the caption does too', async () => {
    wire();
    await Gen.process(QID, {});
    const html = htmlToPdf.mock.calls[0][0];
    expect(html).toContain('What you planned');
    expect(html).toContain('Made from your lesson plan');
    expect(html).not.toContain('Made from your lesson recording');
    const caption = WhatsAppService.sendDocument.mock.calls[0][3];
    expect(caption).toContain('what you planned');
  });

  test('the forwardable message is dated by the lesson date', async () => {
    wire({ quiz: { ...LP612_QUIZ, meta: { ...LP612_QUIZ.meta, lesson_date: '2026-09-18' } } });
    await Gen.process(QID, {});
    const forwardable = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(forwardable).toMatch(/18 Sep/);
  });

  test('no document for that version → failed / source_missing, told with the lesson-plan copy', async () => {
    r2.downloadFromR2.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }));
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_missing' }));
    expect(quizUpdates().find((u) => u.status === 'failed').meta.error).toBe('source_missing');
    expect(LpDigest.run).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.tqFailedLpSource.en);
  });

  test('an R2 outage is not source_missing: the job throws so SQS redelivers it', async () => {
    r2.downloadFromR2.mockRejectedValue(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' }));
    wire();
    await expect(Gen.process(QID, {})).rejects.toThrow(/socket hang up/);
    expect(quizUpdates().some((u) => u.status === 'failed')).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });
});

// THE KILL SWITCH (operator, 24 Sep 2026: "everything must be easy to switch off in production").
// QUIZ_LP612_SOURCE not `on` = no 6-12 quiz is written; a quiz already made keeps going.
describe('QUIZ_LP612_SOURCE off', () => {
  afterEach(() => { process.env.QUIZ_LP612_SOURCE = 'on'; });

  test.each([[undefined], ['off'], ['']])('a queued lp612 quiz is not written (switch %j): failed source_off, told it could not start, nothing read', async (value) => {
    if (value === undefined) delete process.env.QUIZ_LP612_SOURCE; else process.env.QUIZ_LP612_SOURCE = value;
    wire();
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_off' }));
    expect(quizUpdates().find((u) => u.status === 'failed').meta.error).toBe('source_off');
    expect(r2.downloadFromR2).not.toHaveBeenCalled();
    expect(LpDigest.run).not.toHaveBeenCalled();
    expect(Author.author).not.toHaveBeenCalled();
    // Never the 15:00 offer's "the next lessons you plan will get a new offer": a
    // 6-12 quiz is only ever asked for from /quiz, and while the source is off
    // here it cannot be made again yet — so, "try again from /quiz later".
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.lpQuizCouldNotStartLater.en);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalledWith(USER.phone_number, UX_STRINGS.lpQuizCouldNotStart.en);
  });

  test('a quiz already written (ready, resuming at the hand-off) still goes out', async () => {
    process.env.QUIZ_LP612_SOURCE = 'off';
    const stored = [{
      external_id: `tq:${QID}:S1:1`, question_text: 'q', option_a: 'a', option_b: 'b', option_c: 'c', correct_option: 'A',
      explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} }, media: null, render_pattern: 'P1', sort_order: 0,
    }];
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : {
        data: [{ ...LP612_QUIZ, status: 'ready', meta: { ...LP612_QUIZ.meta, step: 'ready', digest: DIGEST } }],
      }),
      quiz_questions: { data: stored },
      users: { data: [USER] },
    }));
    const r = await Gen.process(QID, {});
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(WhatsAppService.sendDocument).toHaveBeenCalled();
    expect(r2.downloadFromR2).not.toHaveBeenCalledWith(expect.stringMatching(/\.lp\.json$/));
  });
});
