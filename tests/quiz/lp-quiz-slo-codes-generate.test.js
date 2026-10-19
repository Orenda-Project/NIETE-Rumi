'use strict';
/**
 * bd-v0toag.9 — generate stamps quizzes.meta.slo_codes from the slide script, only when
 * app_settings quiz_slo_retest_enabled is on. Set-up copied from lp-quiz-generate.test.js.
 *
 * (original notes) generate a quiz for a lesson that was PLANNED, not recorded.
 *
 * An `lp_v8` quiz row has no coaching session (`coaching_session_id = null`):
 * the quiz is written from the slide script of the exact lesson version the
 * teacher was served. Before this change `process()` looked the session up
 * first and failed every such row as `session_missing`.
 *
 * The network boundary is mocked (supabase, WhatsApp, the queue, the LLM-backed
 * digest and author, R2, the PDF renderer) and so is the slide-script store,
 * which lane S owns — by its contract `resolveSlideScript({lessonId,
 * versionStamp, contentHash}) → {slideScript, verified, assetId} | null`.
 * The generate step itself runs for real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-digest.service', () => ({ run: jest.fn(), normaliseDigest: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn(), lessonExcerpts: jest.fn().mockReturnValue('WHAT THE CLASS WAS TO LEARN: add with carrying'),
  lessonDrewBlock: jest.fn().mockReturnValue('WHAT THE LESSON DREW — bundles of ten sticks and loose sticks'),
}));
jest.mock('../../bot/shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-author.service', () => ({
  author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'Carrying' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Digest = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const { logEvent } = require('../../bot/shared/utils/structured-logger');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
// The blind solve is not this suite's subject: an agreeing solver on its seam (see the helper).
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
// Nor is the grade 1-5 maths picture repair (see the helper).
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-444444444444';
const LESSON = {
  lesson_id: 'grade_2_math_ch9_seg3', asset_id: 'a-1', version_stamp: 'v8-20260901', content_hash: 'h-abc', delivered_at: '2026-09-22T04:10:00Z',
};
const LP_QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Add a 3-digit and a 2-digit number',
  subject: 'maths', language: 'en', status: 'generating', grade: '2',
  meta: {
    step: 'generating', source: 'lp_offer', nudge_id: 'n-1', lessons: [LESSON], class: { grade: 2, subject: 'maths' }, lesson_date: '2026-09-22',
  },
};
const USER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' };
const SLIDE_SCRIPT = { meta: { lessonId: LESSON.lesson_id, grade: 2, subject: 'math' }, goal: 'Add with carrying', bloom: 'apply', sloCode: 'M-02-NO-04' };
const DIGEST = {
  topic: 'Adding with carrying', topic_as_taught: 'Adding with carrying', subject: 'maths', grade_band: '1-2', confidence: 0.9,
  taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['146 + 27'], misconceptions_surfaced: ['carries out of every column'],
};

function goodQuestion(i, slo, level) {
  return {
    slo_id: slo, level, question: `Question ${i}: what is ${100 + i} + ${20 + i}?`,
    options: [`${120 + 2 * i}`, `${130 + 2 * i}`, `${110 + 2 * i}`], correct_index: 0,
    explanation: `Add the ones, then the tens: ${120 + 2 * i}.`,
    selected_because: `Question ${i} checks adding two numbers in columns.`,
    distractor_misconceptions: { 1: 'carried when no column reached ten', 2: 'dropped a ten' },
    option_feedback: { correct: 'Yes — ones first, then tens.', wrong: { 1: 'No column reached ten, so nothing carries.', 2: 'A ten was lost from the tens column.' } },
  };
}
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => goodQuestion(i, i % 2 ? 'S1' : 'S2', i % 2 ? 'apply' : 'understand'));

beforeEach(() => {
  jest.clearAllMocks();
  require('../../bot/shared/services/quiz/quiz-v21-flag')._reset();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: SLIDE_SCRIPT, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({
    digest: DIGEST, grade: '2', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10,
  });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned column addition.' });
});

function wire({ quiz = LP_QUIZ, flag = false } = {}) {
  installFrom(supabase.from, ({
    app_settings: (calls) => {
      const keys = (calls.find((c) => c[0] === 'in') || [])[2] || [];
      return { data: flag && keys.includes('quiz_slo_retest_enabled') ? [{ key: 'quiz_slo_retest_enabled', value: true }] : [] };
    },
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    coaching_sessions: () => { throw new Error('an lp_v8 quiz must never query coaching_sessions'); },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);

const readyMeta = () => quizUpdates().filter((u) => u.status === 'ready').map((u) => u.meta).pop();

test('switch off (default) → no slo_codes on the quiz, nothing logged about codes', async () => {
  wire();
  const r = await Gen.process(QID, {});
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const meta = readyMeta();
  expect(meta).toBeTruthy();
  expect(meta).not.toHaveProperty('slo_codes');
  expect(meta).not.toHaveProperty('slo_code_status');
  expect(logEvent).not.toHaveBeenCalledWith('quiz.slo_code_missing', expect.anything());
});

test('switch on → the ready quiz carries the slide script code on every SLO', async () => {
  wire({ flag: true });
  const r = await Gen.process(QID, {});
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  expect(readyMeta()).toEqual(expect.objectContaining({
    slo_codes: { S1: 'M-02-NO-04', S2: 'M-02-NO-04' }, slo_code_status: 'one_code',
  }));
});

test('switch on, slide script with no code → no codes, the miss is logged', async () => {
  wire({ flag: true });
  Store.resolveSlideScript.mockResolvedValue({ slideScript: { ...SLIDE_SCRIPT, sloCode: '' }, verified: 'upload', assetId: 'a-1' });
  await Gen.process(QID, {});
  expect(readyMeta()).toEqual(expect.objectContaining({ slo_codes: {}, slo_code_status: 'missing' }));
  expect(logEvent).toHaveBeenCalledWith('quiz.slo_code_missing', expect.objectContaining({ quizId: QID, reason: 'missing' }));
});

describe('bd-v0toag.10 day-3 retest: the author is told which questions not to reuse', () => {
  test('a normal quiz → no avoid list reaches the author', async () => {
    wire();
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalled();
    Author.author.mock.calls.forEach(([args]) => expect(args).not.toHaveProperty('avoidQuestions'));
  });

  test('a retest quiz → the original questions reach the author as the avoid list', async () => {
    const avoid = ['Question 1: what is 101 + 21?', 'Question 2: what is 102 + 22?'];
    wire({ quiz: { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, digest: DIGEST, step: 'author', remakes: 1, retest_of: 'q-orig', retest_avoid: avoid } } });
    await Gen.process(QID, {});
    expect(Author.author).toHaveBeenCalledWith(expect.objectContaining({ avoidQuestions: avoid }));
  });
});
