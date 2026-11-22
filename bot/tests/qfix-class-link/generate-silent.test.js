'use strict';
/**
 * A quiz_generate job for an evening round (quizzes.meta.source 'evening_round') runs the real generate step
 * (transcript-quiz-generate.service process) and then the round's own hand-off, never the teacher's:
 *   - WhatsApp is called 0 times (no "quiz ready", no PDF, no paced messages, no failure line);
 *   - no PDF render, no report scheduled, the teacher's daily quiz cap untouched;
 *   - the questions are written, the round's share code carries the class, the quiz is `ready`;
 *   - the recall pool is ONE model call, its items marked with what they recall; a reading item reaches the page
 *     with read.self === true (web-quiz.service questionPayload).
 * Boundaries faked: Supabase (in memory), Redis, SQS, WhatsApp, the PDF renderer, R2, the model client (the LLM-backed
 * digest/author seams, as the generate suites do, and the recall rewrite's completeJson). Invented fixtures.
 */
jest.mock('openchemlib', () => ({}));
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../shared/services/quiz/lp-quiz-digest.service', () => ({
  run: jest.fn(), lessonExcerpts: jest.fn().mockReturnValue('WHAT THE CLASS WAS TO LEARN: reading short sentences'),
  lessonDrewBlock: jest.fn().mockReturnValue(''), lessonDrewFor: jest.fn().mockReturnValue(''),
}));
jest.mock('../../shared/services/quiz/lp-asset-source.store', () => ({ resolveSlideScript: jest.fn() }));
jest.mock('../../shared/services/quiz/transcript-quiz-author.service', () => ({ author: jest.fn(), excerptsFor: jest.fn().mockReturnValue('…') }));
jest.mock('../../shared/services/quiz/transcript-quiz-llm', () => {
  const actual = jest.requireActual('../../shared/services/quiz/transcript-quiz-llm');
  return { ...actual, completeJson: jest.fn() };
});
jest.mock('../../shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../shared/storage/r2', () => ({ uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store,
    isAvailable: () => true,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    set: async (k, v) => { store.set(k, v); return true; },
    setNX: async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; },
    delete: async (k) => store.delete(k),
    evalScript: jest.fn(async () => 1),
  };
});

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const SQS = require('../../shared/services/queue/sqs-queue.service');
const redis = require('../../shared/services/cache/railway-redis.service');
const Author = require('../../shared/services/quiz/transcript-quiz-author.service');
const LpDigest = require('../../shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../shared/services/quiz/lp-asset-source.store');
const Llm = require('../../shared/services/quiz/transcript-quiz-llm');
const { htmlToPdf } = require('../../shared/utils/html-to-pdf');
const { logEvent } = require('../../shared/utils/structured-logger');
const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('../../../tests/quiz/helpers/key-verify-agree');
const { installNoPictureRepair } = require('../../../tests/quiz/helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-0000000000e1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const ORIG1 = '99999999-0000-4000-8000-000000000001';
const ORIG2 = '99999999-0000-4000-8000-000000000002';
const DAY = '2026-11-24';
const LESSON = { lesson_id: 'grade_3_english_ch4_seg2', asset_id: 'a-1', version_stamp: 'v8-20261101', content_hash: 'h-1', delivered_at: '2026-11-24T04:10:00Z' };
const DIGEST = {
  topic: 'Reading short sentences', topic_as_taught: 'Reading short sentences', subject: 'english', grade_band: '3-5', confidence: 0.9, taught_level: 'apply',
  slos: [{ id: 'S1', statement: 'a', statement_en: 'a', statement_ur: 'ا', taught_level: 'apply' }, { id: 'S2', statement: 'b', statement_en: 'b', statement_ur: 'ب', taught_level: 'understand' }],
  key_terms: [], examples_used: ['The cat sat on the mat.'], misconceptions_surfaced: [],
};
const STEMS = ['Which word names an animal?', 'Which word is a colour?', 'Which word rhymes with cat?', 'Which word means big?',
  'Which word is a number?', 'Which word names a fruit?', 'Which word is an action?', 'Which word names a place?'];
const ANSWERS = [['dog', 'run', 'blue'], ['red', 'sit', 'cup'], ['hat', 'dog', 'sun'], ['large', 'tiny', 'slow'], ['seven', 'tree', 'jump'], ['apple', 'chair', 'sing'], ['jump', 'book', 'green'], ['school', 'happy', 'eat']];
const EIGHT = STEMS.map((q, i) => ({
  slo_id: i % 2 ? 'S2' : 'S1', level: i % 2 ? 'understand' : 'apply', question: q, options: ANSWERS[i], correct_index: 0,
  explanation: `${ANSWERS[i][0]} is the answer to "${q}"`, selected_because: `Question ${i + 1} checks a word meaning from the lesson.`,
  distractor_misconceptions: { 1: 'a word from another group', 2: 'a word from another group' },
  option_feedback: { correct: 'Yes.', wrong: { 1: 'That word is from another group.', 2: 'That word is from another group.' } },
}));

let db;
function seed({ step = 'digest', recallSrc = null } = {}) {
  db = {
    app_settings: [],
    users: [{ id: TEACHER, name: 'Rifat Test', phone_number: '+92300FIXTURE99', preferred_language: 'en', grades_taught: null, subjects_taught: null }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }],
    quizzes: [{
      id: QID, teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Reading short sentences', subject: 'english', language: 'en',
      status: 'generating', grade: '3',
      meta: {
        step, source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: 'K7Q2MXTRAB', lessons: [LESSON], class: { grade: 3, subject: 'english' },
        lesson_date: DAY, teachers_with_lp: 1, subjects_with_lp: 1, chosen: 'earliest',
        recall_src: recallSrc || [
          { qid: ORIG1, n: 2, kids: [ZARA, ALI], subject: 'english', grade: '3' },
          { qid: ORIG2, n: 1, kids: [ALI], subject: 'english', grade: '3' },
        ],
      },
    }],
    quiz_questions: [
      { id: ORIG1, quiz_id: 'qold', question_text: 'Read the sentence: "The big dog ran fast." Who ran?', option_a: 'the dog', option_b: 'the cat', option_c: 'the boy', correct_option: 'A', explanation: 'The sentence says the dog ran.', sort_order: 1, external_id: 'tq:qold:S1:1' },
      { id: ORIG2, quiz_id: 'qold', question_text: 'Which word is a colour?', option_a: 'red', option_b: 'run', option_c: 'cup', correct_option: 'A', explanation: 'Red is a colour.', sort_order: 2, external_id: 'tq:qold:S1:2' },
    ],
    quiz_share_codes: [],
  };
  const fake = makeFake(db);
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return db;
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
  process.env.QUIZ_LP_CACHE = 'off';
  require('../../shared/services/quiz/quiz-v21-flag')._reset();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: { meta: { lessonId: LESSON.lesson_id, grade: 3, subject: 'english', language: 'en' }, goal: 'Read short sentences' }, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '3', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned reading short sentences.' });
  Llm.completeJson.mockResolvedValue({
    json: { items: [
      { i: 0, question: 'Read the sentence: "A small bird sang a song." Who sang?', options: ['the bird', 'the fish', 'the girl'], correct: 'A', explanation: 'The sentence says the bird sang.', reading: true },
      { i: 1, question: 'Which word is a colour: green, sing or chair?', options: ['green', 'sing', 'chair'], correct: 'A', explanation: 'Green is a colour.', reading: false },
    ] },
    model: 'google/gemini-2.5-flash', costUsd: 0.0011, latencyMs: 900, usage: { prompt_tokens: 812, completion_tokens: 240 },
  });
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.QUIZ_LP_CACHE; });

const quiz = () => db.quizzes.find((q) => q.id === QID);
const rows = () => db.quiz_questions.filter((q) => q.quiz_id === QID);

test('quiz_generate for an evening round: WhatsApp 0 times, no PDF, no report, no teacher cap; questions written; ready', async () => {
  seed();
  const r = await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(0);
  expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(0);
  expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(0);
  expect(htmlToPdf).not.toHaveBeenCalled();
  expect(SQS.queueJob).not.toHaveBeenCalled();
  expect(redis.evalScript).not.toHaveBeenCalled();
  expect(r).toEqual(expect.objectContaining({ ok: true, round: true }));
  expect(quiz().status).toBe('ready');
  expect(rows().filter((q) => q.media && q.media.round === 'lesson')).toHaveLength(8);
});

test('the round\'s share code carries the class and the chosen teacher; the quiz row names it', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(db.quiz_share_codes).toHaveLength(1);
  const sc = db.quiz_share_codes[0];
  expect(sc).toMatchObject({ quiz_id: QID, class_id: CLASS, teacher_user_id: TEACHER });
  expect(quiz().meta).toMatchObject({ share_code_id: sc.id, round_code: sc.code, n_recall: 2, n_items: 7, recall_done: true, step: 'ready' });
  // The recall items went through the generate step's own verifyKeys seam (the stub solver), without a lesson.
  expect(quiz().meta.recall_key_verify).toMatchObject({ status: 'ok', checked: 2, dropped: 0, model: 'stub-solver' });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_written', expect.objectContaining({
    class_link_code: 'K7Q2MXTRAB', round_code: sc.code, n_items: 7, n_recall: 2, teachers_with_lp: 1, chosen: 'earliest',
  }));
});

test('the recall pool: ONE model call, NEW items (never the same stem), each marked with the original it recalls', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(Llm.completeJson).toHaveBeenCalledTimes(1);
  const recall = rows().filter((q) => q.media && q.media.round === 'recall').sort((a, b) => a.sort_order - b.sort_order);
  expect(recall.map((q) => q.media.recall.of)).toEqual([ORIG1, ORIG2]);
  expect(recall.map((q) => q.media.recall.rank)).toEqual([1, 2]);
  expect(recall[0].question_text).not.toBe(db.quiz_questions.find((q) => q.id === ORIG1).question_text);
  // the children are stored only as one-way keys and chips: no id, no name
  expect(JSON.stringify(recall)).not.toContain(ZARA);
  expect(quiz().meta.recall_cost_usd).toBeCloseTo(0.0011);
});

test('a reading item comes out of the page payload with read.self === true; a non-reading item does not', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  const WQ = require('../../shared/services/quiz/web-quiz.service');
  const recall = rows().filter((q) => q.media && q.media.round === 'recall').sort((a, b) => a.sort_order - b.sort_order);
  const p0 = WQ.questionPayload(recall[0], 0, 'RND234', null, false);
  const p1 = WQ.questionPayload(recall[1], 1, 'RND234', null, false);
  expect(p0.read).toEqual(expect.objectContaining({ self: true }));
  expect(p1.read && p1.read.self).toBeFalsy();
});

test('a round that cannot be written (no lesson source) fails silently: no WhatsApp line to the teacher', async () => {
  seed();
  Store.resolveSlideScript.mockResolvedValue(null);
  const r = await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(r).toEqual(expect.objectContaining({ failed: true, reason: 'source_missing' }));
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(0);
});

test('a redelivered job on a ready round mints no second code and makes no second recall call', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(db.quiz_share_codes).toHaveLength(1);
  expect(Llm.completeJson).toHaveBeenCalledTimes(1);
  expect(rows().filter((q) => q.media && q.media.round === 'recall')).toHaveLength(2);
  expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(0);
});

test('an ordinary lp_v8 quiz still gets the teacher hand-off (the round path is the round\'s only)', async () => {
  seed();
  quiz().meta = { ...quiz().meta, source: 'lp_offer' };
  await Gen.process(QID, { quizId: QID, phone: '+92300FIXTURE99' });
  expect(WhatsAppService.sendMessage.mock.calls.length + WhatsAppService.sendDocument.mock.calls.length).toBeGreaterThan(0);
});

test('the report lane\'s isReportableShareCode is asked with the round\'s share code ID; the row stays meta.source evening_round', async () => {
  seed();
  const Report = require('../../shared/services/quiz/video-quiz-report.service');
  const had = Report.isReportableShareCode;
  Report.isReportableShareCode = jest.fn().mockResolvedValue(false);
  try {
    await Gen.process(QID, { quizId: QID, source: 'evening_round' });
    const sc = db.quiz_share_codes[0];
    expect(Report.isReportableShareCode).toHaveBeenCalledWith(sc.id);
    expect(quiz().meta.source).toBe('evening_round');
    expect(logEvent).not.toHaveBeenCalledWith('web_quiz.round_reportable', expect.anything());
  } finally {
    if (had) Report.isReportableShareCode = had; else delete Report.isReportableShareCode;
  }
});
