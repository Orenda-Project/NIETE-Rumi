'use strict';
/**
 * The evening round never rewrites a flagged key. Nobody reviews a round before a child plays it,
 * so an item the blind solve flags is DROPPED from the round and QUEUED for a person, never repaired and served:
 *   - a LESSON item runKeyVerify flags is stored as authored, marked 'held' (never served), and queued under
 *     blind_solve (status open; key_at_flag = the grader's key; top_wrong_option = the solver's pick, by stored slot);
 *     the fix path's rewrite is never called for it;
 *   - a RECALL rewrite the round's own solve flags is stored 'held' and queued the same way (the queue's FK needs a
 *     real quiz_questions row; it has one);
 *   - web_quiz.round_written carries n_dropped, the round's row stores it; a redelivered job queues nothing twice.
 * Runs the real generate step (Gen.process) with the model boundary mocked: the solver (Gen.verifyKeys), the fix
 * path's rewrite (Gen.rewriteRejected), the digest/author seams and completeJson (the recall rewrite). Invented fixtures.
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
const redis = require('../../shared/services/cache/railway-redis.service');
const Author = require('../../shared/services/quiz/transcript-quiz-author.service');
const LpDigest = require('../../shared/services/quiz/lp-quiz-digest.service');
const Store = require('../../shared/services/quiz/lp-asset-source.store');
const Llm = require('../../shared/services/quiz/transcript-quiz-llm');
const { logEvent } = require('../../shared/utils/structured-logger');
const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const Round = require('../../shared/services/quiz/web-quiz-evening-round');
const { pktDate } = require('../../shared/services/nudges/pkt-time');
const { installNoPictureRepair } = require('../../../tests/quiz/helpers/no-picture-repair');

const QID = '44444444-4444-4444-8444-0000000000d1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000d1';
const TEACHER = '7e000000-0000-4000-8000-0000000000d1';
const ZARA = 'c0000001-0000-4000-8000-0000000000d1';
const ALI = 'c0000001-0000-4000-8000-0000000000d2';
const ORIG1 = '99999999-0000-4000-8000-0000000000d1';
const ORIG2 = '99999999-0000-4000-8000-0000000000d2';
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
const asQuestion = (q, i, answers) => ({
  slo_id: i % 2 ? 'S2' : 'S1', level: i % 2 ? 'understand' : 'apply', question: q, options: answers, correct_index: 0,
  explanation: `${answers[0]} is the answer to "${q}"`, selected_because: `Question ${i + 1} checks a word meaning from the lesson.`,
  distractor_misconceptions: { 1: 'a word from another group', 2: 'a word from another group' },
  option_feedback: { correct: 'Yes.', wrong: { 1: 'That word is from another group.', 2: 'That word is from another group.' } },
});
const EIGHT = STEMS.map((q, i) => asQuestion(q, i, ANSWERS[i]));
const FLAGGED_STEM = STEMS[2];
// What the fix path would ship in its place today: a rewrite the solver then agrees with.
const REWRITE_STEM = 'Which word rhymes with bat?';
const RECALL_GREEN = 'Which word is a colour: green, sing or chair?';

let db;
function seed() {
  db = {
    app_settings: [],
    users: [{ id: TEACHER, name: 'Rifat Test', phone_number: '+92300FIXTURE99', preferred_language: 'en', grades_taught: null, subjects_taught: null }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }],
    quizzes: [{
      id: QID, teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Reading short sentences', subject: 'english', language: 'en',
      status: 'generating', grade: '3',
      meta: {
        step: 'digest', source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: 'K7Q2MXTRAB', lessons: [LESSON], class: { grade: 3, subject: 'english' },
        lesson_date: DAY, teachers_with_lp: 1, subjects_with_lp: 1, chosen: 'earliest',
        recall_src: [
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
    quiz_item_reviews: [],
  };
  const fake = makeFake(db, { uniques: { quiz_answers: ['session_id', 'question_id'], quiz_share_codes: ['code'], quiz_item_reviews: ['question_id', 'reason'] } });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return db;
}

/**
 * The solver: lesson item 2 ("rhymes with cat", keyed "hat") is answered "dog" with the lesson; recall rewrite 1
 * (keyed "green") is answered "chair" on both looks. Every other item, and any rewrite, is agreed.
 */
function solver({ questions, indices = null, again }) {
  const idx = Array.isArray(indices) ? indices : questions.map((_, i) => i);
  const isRecall = /small bird/.test(String(questions[0] && questions[0].question));
  return {
    verdicts: idx.map((index) => {
      const q = questions[index];
      const keyed = [Number(q.correct_index)];
      if (!isRecall && q.question === FLAGGED_STEM) return { index, verdict: 'disagree', keyed, blind: [1], note: 'dog' };
      if (isRecall && index === 1) return { index, verdict: 'disagree', keyed, blind: [2], note: again ? 'second look: chair' : 'chair' };
      return { index, verdict: 'agree', keyed, blind: keyed, note: '' };
    }),
    model: 'stub-solver', costUsd: 0, latencyMs: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'evening-round-test-secret';
  process.env.QUIZ_LP_CACHE = 'off';
  require('../../shared/services/quiz/quiz-v21-flag')._reset();
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  if (typeof Gen.checkSummaryTruth === 'function') jest.spyOn(Gen, 'checkSummaryTruth').mockImplementation(async ({ lessonSummary = '', extras = {}, slos = [] }) => ({ lessonSummary, extras, slos, checked: 0, flagged: 0, rewritten: 0, dropped: 0, missing: 0, lines: [], model: 'stub-truth', costUsd: 0, latencyMs: 0 }));
  jest.spyOn(Gen, 'verifyKeys').mockImplementation(async (args) => solver(args));
  jest.spyOn(Gen, 'rewriteRejected').mockImplementation(async ({ questions, errors }) => {
    const i = questions.findIndex((q) => q.question === FLAGGED_STEM);
    if (i < 0 || !(errors || []).some((e) => /KEY_/.test(e))) return { attempted: false, indices: [], merged: null, replaced: [] };
    const merged = questions.map((q, k) => (k === i ? asQuestion(REWRITE_STEM, k, ['cat', 'dog', 'sun']) : q));
    return { attempted: true, indices: [i], merged, replaced: [i], model: 'stub-rewrite', costUsd: 0, latencyMs: 0 };
  });
  installNoPictureRepair(Gen);
  Store.resolveSlideScript.mockResolvedValue({ slideScript: { meta: { lessonId: LESSON.lesson_id, grade: 3, subject: 'english', language: 'en' }, goal: 'Read short sentences' }, verified: 'upload', assetId: 'a-1' });
  LpDigest.run.mockResolvedValue({ digest: DIGEST, grade: '3', gradeSource: 'catalog', lpHint: null, model: 'dm', costUsd: 0.002, latencyMs: 10 });
  Author.author.mockResolvedValue({ questions: EIGHT, model: 'm', costUsd: 0.01, latencyMs: 100, lessonSummary: 'You planned reading short sentences.' });
  Llm.completeJson.mockResolvedValue({
    json: { items: [
      { i: 0, question: 'Read the sentence: "A small bird sang a song." Who sang?', options: ['the bird', 'the fish', 'the girl'], correct: 'A', explanation: 'The sentence says the bird sang.', reading: true },
      { i: 1, question: RECALL_GREEN, options: ['green', 'sing', 'chair'], correct: 'A', explanation: 'Green is a colour.', reading: false },
    ] },
    model: 'google/gemini-2.5-flash', costUsd: 0.0011, latencyMs: 900, usage: { prompt_tokens: 812, completion_tokens: 240 },
  });
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.QUIZ_LP_CACHE; });

const quiz = () => db.quizzes.find((q) => q.id === QID);
const rows = () => db.quiz_questions.filter((q) => q.quiz_id === QID);
const slotOf = (row, text) => ['A', 'B', 'C', 'D'].find((s) => row[`option_${s.toLowerCase()}`] === text) || null;

test('a flagged lesson item is stored as authored and held, never rewritten; a flagged recall rewrite is held; both queued', async () => {
  seed();
  const r = await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(r).toEqual(expect.objectContaining({ ok: true, round: true }));

  // the lesson item: as authored, held, no rewrite stored
  expect(rows().some((q) => q.question_text === REWRITE_STEM)).toBe(false);
  const lessonHeld = rows().find((q) => q.question_text === FLAGGED_STEM);
  expect(lessonHeld).toBeTruthy();
  expect(lessonHeld.media.round).toBe('held');
  expect(rows().filter((q) => q.media && q.media.round === 'lesson')).toHaveLength(7);

  // the recall rewrite the solve flagged: stored held, not served; the other one served
  const recallHeld = rows().find((q) => q.question_text === RECALL_GREEN);
  expect(recallHeld).toBeTruthy();
  expect(recallHeld.media.round).toBe('held');
  expect(rows().filter((q) => q.media && q.media.round === 'recall').map((q) => q.media.recall.of)).toEqual([ORIG1]);
  const served = Round.selectRoundItems(rows(), { studentId: ALI }).map((q) => q.id);
  expect(served).not.toContain(lessonHeld.id);
  expect(served).not.toContain(recallHeld.id);

  // the queue: two blind_solve rows, open, the grader's key and the solver's pick by stored slot
  const day = pktDate(new Date());
  expect(db.quiz_item_reviews).toHaveLength(2);
  expect(db.quiz_item_reviews.find((x) => x.question_id === lessonHeld.id)).toMatchObject({
    reason: 'blind_solve', status: 'open', key_at_flag: slotOf(lessonHeld, 'hat'), top_wrong_option: slotOf(lessonHeld, 'dog'),
    answers_n: 0, top_wrong_n: 0, right_n: 0, first_flagged_on: day, last_seen_on: day,
  });
  expect(db.quiz_item_reviews.find((x) => x.question_id === recallHeld.id)).toMatchObject({
    reason: 'blind_solve', status: 'open', key_at_flag: 'A', top_wrong_option: 'C', first_flagged_on: day, last_seen_on: day,
  });

  // telemetry: on the round's row and on round_written
  expect(quiz().meta).toMatchObject({ n_dropped: 2, n_lesson: 7, n_recall: 1 });
  expect(logEvent).toHaveBeenCalledWith('web_quiz.round_written', expect.objectContaining({ n_dropped: 2 }));
});

test('the fix path\'s rewrite is never asked to repair a round\'s flagged key', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  const keyCalls = Gen.rewriteRejected.mock.calls.filter(([a]) => (a.errors || []).some((e) => /KEY_/.test(e)));
  expect(keyCalls).toHaveLength(0);
  expect(quiz().meta.key_verify).toMatchObject({ status: 'held', fixed: 0, dropped: 0 });
  expect(quiz().meta.key_verify.disagreements).toEqual([expect.objectContaining({ index: 2, outcome: 'held' })]);
});

test('a redelivered job queues nothing twice', async () => {
  seed();
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  await Gen.process(QID, { quizId: QID, source: 'evening_round' });
  expect(db.quiz_item_reviews).toHaveLength(2);
  expect(quiz().meta.n_dropped).toBe(2);
});

test('an ordinary lp_v8 quiz still has its flagged key rewritten (the non-round path is unchanged)', async () => {
  seed();
  quiz().meta = { ...quiz().meta, source: 'lp_offer' };
  await Gen.process(QID, { quizId: QID, phone: '+92300FIXTURE99' });
  expect(rows().some((q) => q.question_text === REWRITE_STEM)).toBe(true);
  expect(rows().some((q) => q.question_text === FLAGGED_STEM)).toBe(false);
  expect(db.quiz_item_reviews).toHaveLength(0);
  expect(quiz().meta.key_verify).toMatchObject({ status: 'fixed', fixed: 1 });
});
