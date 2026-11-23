'use strict';
/**
 * Hold, never rewrite: app_settings `quiz_key_hold_on_disagree` (a missing row is off).
 *
 * The blind solve answers every generated item without its key. Today an item it disagrees with is re-authored by the
 * targeted rewrite, so whichever key the rewrite lands on reaches children, and on a hand-read sample the rewrite was
 * wrong in some cases and the author in others. With the switch on, every quiz holds a disputed key the way a class's
 * evening round already does:
 *   - the item is stored as authored (the author's key kept, nothing rewritten), marked media.key_held;
 *   - it gets ONE quiz_item_reviews row: blind_solve, open, key_at_flag the grader's key, top_wrong_option the solver's
 *     pick by stored slot, counts 0, both dates the Pakistan date;
 *   - the web quiz never serves it (web-quiz.service loadQuestions), and the teacher's PDF does not print it;
 *   - quiz_keys.held is logged once for the quiz;
 *   - a repeat the solver confirms keeps today's targeted rewrite (it moves no key), unless it is itself held;
 *   - a failed queue write never fails the quiz.
 * Off (no row): today's rewrite exactly. An evening round is unchanged either way (it queues its own items).
 *
 * Runs the real generate step (Gen.process) and the real web quiz read (WQ.getQuiz → loadQuestions) on a fake Supabase,
 * with only the model boundary mocked: the solver (Gen.verifyKeys), the rewrite (Gen.rewriteRejected), the digest and
 * author seams and completeJson. Invented fixtures.
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
jest.mock('../../shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(), getPresignedUrl: jest.fn(async (u) => u),
}));
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
const { htmlToPdf } = require('../../shared/utils/html-to-pdf');
const { logEvent } = require('../../shared/utils/structured-logger');
const { logToFile } = require('../../shared/utils/logger');
const Gen = require('../../shared/services/quiz/transcript-quiz-generate.service');
const WQ = require('../../shared/services/quiz/web-quiz.service');
const { pktDate } = require('../../shared/services/nudges/pkt-time');
const { installNoPictureRepair } = require('../../../tests/quiz/helpers/no-picture-repair');

const SWITCH = 'quiz_key_hold_on_disagree';
const QID = '44444444-4444-4444-8444-0000000000e1';
const CLASS = 'c1a55000-0000-4000-8000-0000000000e1';
const TEACHER = '7e000000-0000-4000-8000-0000000000e1';
const ZARA = 'c0000001-0000-4000-8000-0000000000e1';
const ALI = 'c0000001-0000-4000-8000-0000000000e2';
const ORIG1 = '99999999-0000-4000-8000-0000000000e1';
const ORIG2 = '99999999-0000-4000-8000-0000000000e2';
const DAY = '2026-11-24';
const PHONE = '+92300FIXTURE98';
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
// The one item the solver disputes: keyed "hat", the solver answers "dog" (index 1).
const FLAGGED_STEM = STEMS[2];
// What today's fix path stores in its place: the rewrite writes a new item and its key.
const REWRITE_STEM = 'Which word rhymes with bat?';

let db;
let fake;
/** An ordinary lesson-plan quiz (lp_v8, offered from the lesson): not an evening round. */
function seed({ hold = true, round = false } = {}) {
  db = {
    app_settings: hold === null ? [] : [{ key: SWITCH, value: hold }],
    users: [{ id: TEACHER, name: 'Rifat Test', phone_number: PHONE, preferred_language: 'en', grades_taught: null, subjects_taught: null }],
    classes: [{ id: CLASS, grade_code: 'grade_3', section: 'B', is_active: true }],
    quizzes: [{
      id: QID, teacher_id: TEACHER, coaching_session_id: null, quiz_source: 'lp_v8', topic: 'Reading short sentences', subject: 'english', language: 'en',
      status: 'generating', grade: '3',
      meta: round
        ? {
          step: 'digest', source: 'evening_round', class_id: CLASS, round_day: DAY, class_link_code: 'K7Q2MXTRAE', lessons: [LESSON], class: { grade: 3, subject: 'english' },
          lesson_date: DAY, teachers_with_lp: 1, subjects_with_lp: 1, chosen: 'earliest',
          recall_src: [{ qid: ORIG1, n: 2, kids: [ZARA, ALI], subject: 'english', grade: '3' }, { qid: ORIG2, n: 1, kids: [ALI], subject: 'english', grade: '3' }],
        }
        : { step: 'digest', source: 'lp_offer', lessons: [LESSON], lesson_date: DAY },
    }],
    quiz_questions: [
      { id: ORIG1, quiz_id: 'qold', question_text: 'Read the sentence: "The big dog ran fast." Who ran?', option_a: 'the dog', option_b: 'the cat', option_c: 'the boy', correct_option: 'A', explanation: 'The sentence says the dog ran.', sort_order: 1, external_id: 'tq:qold:S1:1' },
      { id: ORIG2, quiz_id: 'qold', question_text: 'Which word is a colour?', option_a: 'red', option_b: 'run', option_c: 'cup', correct_option: 'A', explanation: 'Red is a colour.', sort_order: 2, external_id: 'tq:qold:S1:2' },
    ],
    quiz_share_codes: [],
    quiz_sessions: [], students: [], quiz_answers: [],
    quiz_item_reviews: [],
  };
  fake = makeFake(db, { uniques: { quiz_answers: ['session_id', 'question_id'], quiz_share_codes: ['code'], quiz_item_reviews: ['question_id', 'reason'] } });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
  return db;
}

/** The solver: the "rhymes with cat" item (keyed "hat") is answered "dog"; every other item, and any rewrite, is agreed. */
function solver({ questions, indices = null }) {
  const idx = Array.isArray(indices) ? indices : questions.map((_, i) => i);
  const isRecall = /small bird/.test(String(questions[0] && questions[0].question));
  return {
    verdicts: idx.map((index) => {
      const q = questions[index];
      const keyed = [Number(q.correct_index)];
      if (!isRecall && q.question === FLAGGED_STEM) return { index, verdict: 'disagree', keyed, blind: [1], note: 'dog' };
      return { index, verdict: 'agree', keyed, blind: keyed, note: '' };
    }),
    model: 'stub-solver', costUsd: 0, latencyMs: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  redis._store.clear();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'key-hold-test-secret';
  process.env.QUIZ_LP_CACHE = 'off';
  require('../../shared/services/quiz/quiz-v21-flag')._reset();
  try { require('../../shared/services/quiz/key-hold-flag').reset(); } catch (_) { /* red run: absent */ }
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
      { i: 1, question: 'Which word is a colour: green, sing or chair?', options: ['green', 'sing', 'chair'], correct: 'A', explanation: 'Green is a colour.', reading: false },
    ] },
    model: 'google/gemini-2.5-flash', costUsd: 0.0011, latencyMs: 900, usage: { prompt_tokens: 812, completion_tokens: 240 },
  });
});
afterEach(() => { jest.restoreAllMocks(); delete process.env.QUIZ_LP_CACHE; });

const quiz = () => db.quizzes.find((q) => q.id === QID);
const rows = () => db.quiz_questions.filter((q) => q.quiz_id === QID);
const slotOf = (row, text) => ['A', 'B', 'C', 'D'].find((s) => row[`option_${s.toLowerCase()}`] === text) || null;
const keyCalls = () => Gen.rewriteRejected.mock.calls.filter(([a]) => (a.errors || []).some((e) => /KEY_/.test(e)));
const heldEvents = () => logEvent.mock.calls.filter(([name]) => name === 'quiz_keys.held');
/** The quiz as the web page serves it (getQuiz → loadQuestions), by the code the hand-off minted. */
async function served() {
  const sc = db.quiz_share_codes.find((s) => s.quiz_id === QID);
  expect(sc).toBeTruthy();
  if (sc.active === undefined) sc.active = true; // the column's default, which the fake does not apply
  const out = await WQ.getQuiz(sc.code, {});
  return out.quiz.questions;
}
/** The teacher's PDF, as the HTML the renderer was handed. */
const pdfHtml = () => String((htmlToPdf.mock.calls[htmlToPdf.mock.calls.length - 1] || [])[0] || '');

describe('switch on (quiz_key_hold_on_disagree = true)', () => {
  test('a lesson quiz keeps the author\'s key, holds the item, queues it once, and the web quiz serves 7 of 8', async () => {
    seed({ hold: true });
    const r = await Gen.process(QID, { quizId: QID, phone: PHONE });
    expect(r).toEqual(expect.objectContaining({ ok: true }));

    // the author's key, never a rewrite
    expect(keyCalls()).toHaveLength(0);
    expect(rows().some((q) => q.question_text === REWRITE_STEM)).toBe(false);
    const held = rows().find((q) => q.question_text === FLAGGED_STEM);
    expect(held).toBeTruthy();
    expect(held.correct_option).toBe(slotOf(held, 'hat'));
    expect(held.media.key_held).toEqual(expect.objectContaining({ reason: 'blind_solve', verdict: 'disagree', picks: ['dog'] }));
    expect(rows()).toHaveLength(8);
    expect(rows().filter((q) => q.media && q.media.key_held)).toHaveLength(1);
    expect(quiz().status).toBe('sent'); // the quiz went out: held is not failed
    expect(quiz().meta.key_verify).toMatchObject({ status: 'held', fixed: 0, dropped: 0 });
    expect(quiz().meta.key_verify.disagreements).toEqual([expect.objectContaining({ index: 2, outcome: 'held' })]);

    // one queue row: blind_solve, open, the author's key and the solver's pick by stored slot, counts 0, PKT dates
    const day = pktDate(new Date());
    expect(db.quiz_item_reviews).toHaveLength(1);
    expect(db.quiz_item_reviews[0]).toMatchObject({
      question_id: held.id, reason: 'blind_solve', status: 'open', key_at_flag: slotOf(held, 'hat'), top_wrong_option: slotOf(held, 'dog'),
      answers_n: 0, top_wrong_n: 0, right_n: 0, first_flagged_on: day, last_seen_on: day,
    });

    // the web quiz serves the other 7, and never the held one
    const page = await served();
    expect(page).toHaveLength(7);
    expect(page.map((q) => q.qid)).not.toContain(held.id);

    // the teacher's PDF does not print it either
    expect(pdfHtml()).toContain(STEMS[0]);
    expect(pdfHtml()).not.toContain(FLAGGED_STEM);

    // one event for the quiz
    expect(heldEvents()).toHaveLength(1);
    expect(heldEvents()[0][1]).toEqual(expect.objectContaining({ n_held: 1, n_items: 8, lang: 'en', quiz_source: 'lp_v8', queued: 1 }));
  });

  test('a failed queue write never fails the quiz: the item still ships held and unserved, logged', async () => {
    seed({ hold: true });
    const from = fake.from;
    supabase.from = (table) => {
      if (table !== 'quiz_item_reviews') return from(table);
      return { insert: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) };
    };
    const r = await Gen.process(QID, { quizId: QID, phone: PHONE });
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    const held = rows().find((q) => q.question_text === FLAGGED_STEM);
    expect(held.media.key_held).toBeTruthy();
    expect(db.quiz_item_reviews).toHaveLength(0);
    expect((await served()).map((q) => q.qid)).not.toContain(held.id);
    expect(logToFile).toHaveBeenCalledWith(expect.stringMatching(/not queued for review/), expect.objectContaining({ quizId: QID }), 'warn');
    expect(heldEvents()[0][1]).toEqual(expect.objectContaining({ n_held: 1, queued: 0 }));
  });

  test('an evening round is unchanged: it queues its own held item, and the generate step adds no second row', async () => {
    seed({ hold: true, round: true });
    const r = await Gen.process(QID, { quizId: QID, source: 'evening_round' });
    expect(r).toEqual(expect.objectContaining({ ok: true, round: true }));
    const lessonHeld = rows().find((q) => q.question_text === FLAGGED_STEM);
    expect(lessonHeld.media.round).toBe('held');
    expect(db.quiz_item_reviews.filter((x) => x.question_id === lessonHeld.id)).toHaveLength(1);
    expect(heldEvents()).toHaveLength(0);
  });
});

describe('switch off: today\'s rewrite exactly', () => {
  test.each([['no row', null], ['false', false], ['the string "true"', 'true']])('%s: the solver\'s disagreement is rewritten, nothing is held or queued, all 8 served', async (_label, value) => {
    seed({ hold: value });
    await Gen.process(QID, { quizId: QID, phone: PHONE });
    expect(keyCalls()).toHaveLength(1);
    expect(rows().some((q) => q.question_text === REWRITE_STEM)).toBe(true);
    expect(rows().some((q) => q.question_text === FLAGGED_STEM)).toBe(false);
    expect(rows().some((q) => q.media && q.media.key_held)).toBe(false);
    expect(db.quiz_item_reviews).toHaveLength(0);
    expect(quiz().meta.key_verify).toMatchObject({ status: 'fixed', fixed: 1 });
    expect(await served()).toHaveLength(8);
    expect(pdfHtml()).toContain(REWRITE_STEM);
    expect(heldEvents()).toHaveLength(0);
  });
});

describe('runKeyVerify, switch on: a confirmed repeat keeps its targeted rewrite (it moves no key)', () => {
  const sq = (question, options) => ({
    slo_id: 'S1', level: 'understand', question, options, correct_index: 0,
    explanation: 'In a physical change the substance stays the same substance.',
    selected_because: 'the class sorted everyday changes into physical and chemical',
    distractor_misconceptions: { 1: 'thinks every change makes something new', 2: 'confuses a change of shape with a new substance' },
    option_feedback: { correct: 'Well done!', wrong: { 1: 'Think about whether a new substance was made.', 2: 'Look again at what changed.' } },
  });
  const SCI = {
    topic: 'Physical and chemical changes', topic_as_taught: 'Physical and chemical changes', subject: 'science', grade_band: '6-8', language_of_instruction: 'en', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'tell a physical change from a chemical change', statement_en: 'tell a physical change from a chemical change', taught_level: 'understand' }],
    key_terms: [{ term: 'physical change' }], examples_used: ['melting ice'], misconceptions_surfaced: [],
  };
  const SET = [
    sq('Which of these is a physical change?', ['Melting ice', 'Burning paper', 'Rusting iron']),
    sq('Which of these is a chemical change?', ['Burning wood', 'Cutting paper', 'Melting butter']),
    sq('What is formed in a physical change?', ['No new substance is formed.', 'A different form of the same substance is formed.', 'A completely new substance is formed.']),
    sq('What happens to the particles of ice when it melts?', ['They move more freely', 'They disappear', 'They turn into new particles']),
    sq('Which sign shows that a chemical change has happened?', ['A new colour or gas appears', 'The shape changes', 'The size changes']),
    sq('Can melted chocolate become solid again?', ['Yes, by cooling it', 'No, never', 'Only by adding water']),
    sq('What is true about a physical change?', ['No new substance is formed.', 'It cannot be reversed.', 'A new substance is always formed.']),
    sq('Why is cooking an egg a chemical change?', ['A new substance is formed', 'It gets hot', 'It changes shape']),
  ];
  const REPLACEMENT = sq('Which of these is a sign of a physical change?', ['Only the shape changes', 'A new gas is made', 'A new colour appears']);
  // q4's key is disputed; q6 repeats q2's fact with the same answer.
  const api = () => ({
    verifyKeys: jest.fn(async ({ questions, indices = null }) => {
      const idx = Array.isArray(indices) ? indices : questions.map((_, i) => i);
      return {
        verdicts: idx.map((index) => (questions[index] === SET[4]
          ? { index, verdict: 'disagree', keyed: [0], blind: [1], note: 'the shape' }
          : { index, verdict: 'agree', keyed: [0], blind: [0], note: '' })),
        sameFact: indices ? [] : [[2, 6]], model: 'stub-solver', costUsd: 0, latencyMs: 0,
      };
    }),
    rewriteRejected: jest.fn(async ({ questions, errors }) => {
      const at = (errors || []).filter((e) => /DUPLICATE_QUESTION/.test(e)).map((e) => Number(/^q(\d+)/.exec(e)[1]));
      if (!at.length) return { attempted: false, indices: [], merged: null, replaced: [] };
      return { attempted: true, indices: at, merged: questions.map((q, k) => (at.includes(k) ? REPLACEMENT : q)), replaced: at, model: 'stub-rewrite', costUsd: 0 };
    }),
    renderFigures: jest.fn(async () => ({})),
    renderCards: jest.fn(async () => ({})),
  });
  const run = (a) => Gen.runKeyVerify(a, {
    questions: SET, digest: SCI, language: 'en', quizId: QID, teacherId: TEACHER, lessonSummary: 'You taught physical and chemical changes, using melting ice.',
    gradeBand: '6-8', grade: '7', quizSource: 'transcript', attempts: [],
  });

  test('switch on: the disputed key is held (no KEY_ complaint sent), the repeat is rewritten, the held item stays as authored', async () => {
    seed({ hold: true });
    const a = api();
    const kv = await run(a);
    expect(a.rewriteRejected).toHaveBeenCalledTimes(1);
    const { errors } = a.rewriteRejected.mock.calls[0][0];
    expect(errors.some((e) => /KEY_/.test(e))).toBe(false);
    expect(errors.some((e) => /^q6: DUPLICATE_QUESTION/.test(e))).toBe(true);
    expect(kv.record.status).toBe('held');
    expect(kv.held).toEqual([expect.objectContaining({ index: 4, verdict: 'disagree', picks: ['The shape changes'] })]);
    expect(kv.changed).toBe(true);
    expect(kv.questions[6]).toEqual(REPLACEMENT);
    expect(kv.questions[4]).toEqual(expect.objectContaining({ question: SET[4].question, options: SET[4].options, correct_index: 0 }));
    expect(kv.record.same_fact.fixed).toEqual([6]);
  });

  test('switch off: the disputed key and the repeat go to the rewrite together, as today', async () => {
    seed({ hold: null });
    const a = api();
    const kv = await run(a);
    const { errors } = a.rewriteRejected.mock.calls[0][0];
    expect(errors.some((e) => /^q4: KEY_/.test(e))).toBe(true);
    expect(errors.some((e) => /^q6: DUPLICATE_QUESTION/.test(e))).toBe(true);
    expect(kv.held).toBeUndefined();
    expect(kv.record.status).not.toBe('held');
  });
});

describe('a released hold: the reviewer\'s key_ok writes media.key_held.released_at, and the item serves again', () => {
  const KeyHold = require('../../shared/services/quiz/key-hold-flag');
  const RELEASED_AT = '2026-11-25T09:30:00.000Z';
  /** The teacher's PDF for the stored rows, through the same renderPdf the hand-off calls. */
  const printRows = () => Gen.renderPdf({
    quiz: quiz(), questions: rows(), digest: DIGEST, teacherName: 'Rifat Test', grade: '3', lessonSummary: 'You planned reading short sentences.',
    language: 'en', contentLanguage: 'en', date: DAY, link: null,
  });

  test('isHeld: a hold with released_at is not held; without it (or with it empty) it still is', () => {
    expect(KeyHold.isHeld({ media: { key_held: { reason: 'blind_solve', verdict: 'disagree', picks: ['dog'] } } })).toBe(true);
    expect(KeyHold.isHeld({ media: { key_held: { reason: 'blind_solve', verdict: 'disagree', picks: ['dog'], released_at: RELEASED_AT } } })).toBe(false);
    expect(KeyHold.isHeld({ media: { key_held: { reason: 'blind_solve', released_at: null } } })).toBe(true);
    expect(KeyHold.isHeld({ media: { key_held: { reason: 'blind_solve', released_at: '' } } })).toBe(true);
    expect(KeyHold.isHeld({ media: {} })).toBe(false);
  });

  test('switch on: a released item is served by loadQuestions and printed by renderPdf; an unreleased one stays out of both', async () => {
    seed({ hold: true });
    await Gen.process(QID, { quizId: QID, phone: PHONE });
    const held = rows().find((q) => q.question_text === FLAGGED_STEM);
    expect(held.media.key_held).toBeTruthy();

    // not released: still held at both doors
    expect((await served()).map((q) => q.qid)).not.toContain(held.id);
    await printRows();
    expect(pdfHtml()).not.toContain(FLAGGED_STEM);

    // the reviewer's key_ok: released_at on the hold, nothing else on the row changes
    held.media = { ...held.media, key_held: { ...held.media.key_held, released_at: RELEASED_AT } };
    const page = await served();
    expect(page).toHaveLength(8);
    expect(page.map((q) => q.qid)).toContain(held.id);
    await printRows();
    expect(pdfHtml()).toContain(FLAGGED_STEM);

    // the reviewer's rollback removes exactly released_at: held again
    const { released_at: _gone, ...hold } = held.media.key_held;
    held.media = { ...held.media, key_held: hold };
    expect((await served()).map((q) => q.qid)).not.toContain(held.id);
  });
});
