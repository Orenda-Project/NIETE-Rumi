'use strict';
/**
 * bd-chz35n.10.3 — the generate step asks a retest's anchor questions again, word for word, in the last
 * slots (the quiz keeps its length), and records them on meta.anchor_items {key, external_id,
 * from_question_id}. Only with app_settings quiz_anchor_items on. Set-up copied from
 * lp-quiz-slo-codes-generate.test.js (the generate step runs for real; the network boundary is mocked).
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

const SRC = [
  { id: 'src-a', quiz_id: 'q-orig', sort_order: 1, external_id: 'tq:q-orig:S1:2', question_text: 'Anchor one: what is 7 + 8?',
    option_a: '16', option_b: '15', option_c: '14', correct_option: 'B', explanation: 'Seven and eight make fifteen.',
    difficulty_level: 3, render_pattern: 'P1', media: { display_order: [0, 1, 2] } },
  { id: 'src-b', quiz_id: 'q-orig', sort_order: 3, external_id: 'tq:q-orig:S2:4', question_text: 'Anchor two: which is more, 31 or 13?',
    option_a: '13', option_b: '31', option_c: 'same', correct_option: 'B', explanation: 'Three tens beat one ten.',
    difficulty_level: 2, render_pattern: 'P1', media: { display_order: [2, 0, 1] } },
];
const RETEST = { ...LP_QUIZ, meta: { ...LP_QUIZ.meta, digest: DIGEST, step: 'author', remakes: 1, retest_of: 'q-orig', retest_avoid: [], anchor_from: ['src-a', 'src-b'] } };

function wire({ quiz = RETEST, anchors = false } = {}) {
  installFrom(supabase.from, ({
    app_settings: (calls) => {
      const keys = (calls.find((c) => c[0] === 'in') || [])[2] || [];
      return { data: anchors && keys.includes('quiz_anchor_items') ? [{ key: 'quiz_anchor_items', value: true }] : [] };
    },
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quiz] }),
    quiz_questions: (calls) => {
      if (calls.some((c) => c[0] === 'insert')) return { data: null, error: null };
      if (calls.some((c) => c[0] === 'in')) return { data: SRC };
      return { data: [] };
    },
    users: { data: [USER] },
  }));
}
const quizUpdates = () => supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
const readyMeta = () => quizUpdates().filter((u) => u.status === 'ready').map((u) => u.meta).pop();
const inserted = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert').map((c) => c[1]).pop();

beforeEach(() => require('../../bot/shared/services/quiz/quiz-anchors')._reset());

test('switch on, a retest naming two anchors → the last two of its 8 questions are the anchors, word for word', async () => {
  wire({ anchors: true });
  const r = await Gen.process(QID, {});
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const rows = inserted();
  expect(rows).toHaveLength(8);
  const [a, b] = rows.slice(6);
  ['question_text', 'option_a', 'option_b', 'option_c', 'correct_option', 'explanation', 'media'].forEach((k) => {
    expect(a[k]).toEqual(SRC[0][k]);
    expect(b[k]).toEqual(SRC[1][k]);
  });
  expect(a.external_id).toBe(`tq:${QID}:S1:7`);
  expect(b.external_id).toBe(`tq:${QID}:S2:8`);
  const Anchors = require('../../bot/shared/services/quiz/quiz-anchors');
  expect(readyMeta().anchor_items).toEqual([
    { key: Anchors.itemKey(SRC[0]), external_id: `tq:${QID}:S1:7`, from_question_id: 'src-a' },
    { key: Anchors.itemKey(SRC[1]), external_id: `tq:${QID}:S2:8`, from_question_id: 'src-b' },
  ]);
  expect(logEvent).toHaveBeenCalledWith('quiz.anchors_carried', expect.objectContaining({ quizId: QID, carried: 2 }));
});

test('switch off → the retest ships its 8 authored questions, no anchors', async () => {
  wire({ anchors: false });
  await Gen.process(QID, {});
  const rows = inserted();
  expect(rows).toHaveLength(8);
  expect(rows.map((r) => r.question_text)).not.toContain(SRC[0].question_text);
  expect(readyMeta()).not.toHaveProperty('anchor_items');
});

test('switch on, a quiz that names no anchors → untouched', async () => {
  wire({ quiz: LP_QUIZ, anchors: true });
  await Gen.process(QID, {});
  expect(inserted()).toHaveLength(8);
  expect(readyMeta()).not.toHaveProperty('anchor_items');
});
