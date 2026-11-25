'use strict';
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


jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => {
  const actual = jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-llm');
  return { ...actual, completeJson: jest.fn() };
});
const supabase = require('../../bot/shared/config/supabase');
const Author = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../bot/shared/services/quiz/lp-asset-source.store');
const Llm = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

/**
 * bd-0q8b4x — an English lesson quiz is stored with Urdu word help (media.word_help) only
 * while app_settings quiz_word_help is on; the meaning comes from the book's glossary and
 * the key checker approves it. Off: the stored rows carry no word help and no extra call.
 */
const QID = '55555555-5555-4555-8555-555555555555';
const LESSON = { lesson_id: 'grade_4_english_ch3_seg2', asset_id: 'a-1', version_stamp: 'v8-1', content_hash: 'h-1', delivered_at: '2026-11-20T04:10:00Z' };
const QUIZ = {
  id: QID, teacher_id: 'u-1', coaching_session_id: null, quiz_source: 'lp_v8', topic: 'The farmer', subject: 'english',
  language: 'en', status: 'generating', grade: '4',
  meta: { step: 'generating', source: 'lp_offer', lessons: [LESSON], class: { grade: 4, subject: 'english' }, lesson_date: '2026-11-20' },
};
const USER = { id: 'u-1', name: 'Rifat Noor', phone_number: '923001234567', preferred_language: 'en' };
const SLIDE_SCRIPT = {
  meta: { lessonId: LESSON.lesson_id, grade: 4, subject: 'english' }, goal: 'Read a story about a farmer',
  hook: { keyWords: [{ term: 'harvest', urdu: 'فصل کاٹنا', def: 'to cut and gather crops' }] },
};
const DIGEST = {
  topic: 'The farmer', topic_as_taught: 'The farmer', subject: 'english', grade_band: '3-5', confidence: 0.9, taught_level: 'understand',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'understand' },
    { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'recall' }],
  key_terms: ['harvest'], examples_used: [], misconceptions_surfaced: [],
};
const STEMS = ['When does the farmer harvest the wheat?', 'Who helps the farmer?', 'Where is the farm?', 'What does the farmer sell?',
  'Why is the farmer happy?', 'What colour is the wheat?', 'How many cows are there?', 'What does the farmer harvest first?'];
const OPTS = [['in April', 'in June', 'in May'], ['his son', 'a doctor', 'a teacher'], ['near a river', 'in a city', 'on a hill'],
  ['milk', 'shoes', 'books'], ['the rain came', 'he lost a cow', 'the shop closed'], ['gold', 'blue', 'pink'],
  ['three', 'nine', 'twelve'], ['wheat', 'stones', 'toys']];
const EIGHT = STEMS.map((s, i) => ({
  slo_id: i % 2 ? 'S2' : 'S1', level: i % 2 ? 'recall' : 'understand', question: s, options: OPTS[i], correct_index: 0,
  explanation: `The story says ${OPTS[i][0]}.`, selected_because: `Question ${i + 1} checks the story.`,
  distractor_misconceptions: { 1: 'guessed', 2: 'guessed' },
  option_feedback: { correct: 'Yes, the story says so.', wrong: { 1: 'Read the story again.', 2: 'Look at the story again.' } },
}));

let FLAG = false;
beforeEach(() => {
  jest.clearAllMocks();
  require('../../bot/shared/services/quiz/quiz-v21-flag')._reset();
  require('../../bot/shared/services/quiz/quiz-word-help-flag').resetCache();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: SLIDE_SCRIPT, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '4', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned a story.' });
  Llm.completeJson.mockImplementation(async ({ label }) => {
    if (label === 'quiz.word_help.propose') return { json: { items: [] }, costUsd: 0 };
    if (label === 'quiz.word_help.check') return { json: { words: Array.from({ length: 10 }, (_, index) => ({ index, en: 'harvest', ok: true })) }, costUsd: 0 };
    if (label === 'lp_quiz.key_check') return { json: { verdicts: EIGHT.map((_, index) => ({ index, verdict: 'consistent', quote: '' })) }, costUsd: 0 };
    throw new Error(`unexpected call ${label}`);
  });
  installFrom(supabase.from, ({
    app_settings: (calls) => {
      const keys = (calls.find((c) => c[0] === 'in') || [])[2] || [];
      return { data: FLAG && keys.includes('quiz_word_help') ? [{ key: 'quiz_word_help', value: true }] : [] };
    },
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [USER] },
  }));
});
const inserted = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert').map((c) => c[1]).pop();
const labels = () => Llm.completeJson.mock.calls.map(([a]) => a.label);

test('switch off: rows stored with no word help, no word-help call', async () => {
  FLAG = false;
  const r = await Gen.process(QID, {});
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  inserted().forEach((row) => expect((row.media || {}).word_help).toBeUndefined());
  expect(labels()).not.toContain('quiz.word_help.propose');
});

test('switch on: the harvest questions carry the book\'s Urdu meaning, approved by the key checker', async () => {
  FLAG = true;
  const r = await Gen.process(QID, {});
  expect(r).toEqual(expect.objectContaining({ ok: true }));
  const rows = inserted();
  const helped = rows.filter((row) => row.media && row.media.word_help);
  expect(helped.length).toBeGreaterThan(0);
  helped.forEach((row) => expect(row.question_text).toMatch(/harvest/));
  rows.filter((row) => !/harvest/.test(row.question_text)).forEach((row) => expect((row.media || {}).word_help).toBeUndefined());
  helped.forEach((row) => expect(row.media.word_help).toEqual([{ en: 'harvest', ur: 'فصل کاٹنا', from: 'book' }]));
  expect(labels()).toEqual(expect.arrayContaining(['quiz.word_help.propose', 'quiz.word_help.check']));
});
