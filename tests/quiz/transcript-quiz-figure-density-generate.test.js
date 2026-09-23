'use strict';
/**
 * PICTURE DENSITY through the generate step — a grade 1-5 maths quiz that came
 * back with one picture gets ONE "add a picture" repair, validated in full,
 * and ships either way.
 *
 * The whole chain runs for real — author, validator, the add-pictures rewrite,
 * rows — with only the network boundary replaced: `llm-client` (the model),
 * supabase, WhatsApp, R2, the renders' browser, and the blind solve on its own
 * seam (an agreeing solver, as every suite that is not about it does).
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'Adding' }),
  botNumber: jest.fn().mockReturnValue('920000000000'),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClientForModel: (model) => ({ client: { chat: { completions: { create: (...a) => mockCreate(...a) } } }, model }),
}));

const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { logEvent } = require('../../bot/shared/utils/structured-logger');

const QID = '77777777-7777-4777-8777-777777777777';
const SID = '88888888-8888-4888-8888-888888888888';
const DIGEST = (band = '1-2', subject = 'maths') => ({
  topic: 'Adding within 10', topic_as_taught: 'Adding within 10', subject, grade_band: band,
  language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'add two numbers within 10', taught_level: 'understand' },
    { id: 'S2', statement: 'find how many more', taught_level: 'understand' },
  ],
  key_terms: ['add', 'more'], examples_used: ['3 + 4 with counters'], misconceptions_surfaced: ['counts the first number again'],
});
const SUMMARY = 'Today you taught adding within ten with counters, starting from 3 and 4 and counting on.';

function q(i, over = {}) {
  const a = (i % 4) + 2;
  return {
    slo_id: i % 2 ? 'S2' : 'S1', level: 'understand',
    question: `A row has ${a} counters and another row has 3 more. How many counters are there in all?`,
    options: [String(a + 3), String(a + 2), String(a + 4)], correct_index: 0,
    explanation: `${a} and 3 more make ${a + 3}.`,
    selected_because: 'the class counted on from the bigger number with counters',
    distractor_misconceptions: { 1: 'counts one too few', 2: 'counts the first number again' },
    option_feedback: { correct: 'Yes — count on three from the first row.', wrong: { 1: 'You stopped one too soon; count on again.', 2: 'The first number was counted twice; count on from it.' } },
    ...over,
  };
}
const COUNTERS = { type: 'count_objects', picto: 'counter', count: 6 };
function eightWithOne() {
  return [
    q(0, { question: 'Which of these is a way to put two groups together?', options: ['adding', 'sorting', 'drawing'] }),
    q(1, { figure: COUNTERS, figure_role: 'count_compare', question: 'How many counters are in the picture?', options: ['6', '5', '7'] }),
    ...[2, 3, 4, 5, 6, 7].map((i) => q(i)),
  ];
}
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.004 } });
const authored = (questions) => reply({ lesson_summary: SUMMARY, lesson_summary_short: 'Adding within ten with counters.', checks_summary: 'This quiz checks adding within ten.', questions });

function wire(digest = DIGEST()) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: digest.topic, subject: digest.subject, language: 'en', status: 'generating',
      meta: { digest, grade: '2', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en', created_at: '2026-09-07T04:00:00Z', analysis_data: {}, users: { phone_number: '920000000001', preferred_language: 'en', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '920000000001', preferred_language: 'en' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const promptOf = (call) => call[0].messages[0].content;
const densityEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.figure_density').map((c) => c[1]);
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((c) => c[1]);
  return ups.map((u) => u.meta).filter(Boolean).pop();
};

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  // a URL for every figure the set carries, so the rows keep their pictures
  jest.spyOn(Gen, 'renderFigures').mockImplementation(async ({ questions }) => Object.fromEntries(
    questions.map((x, i) => (x && x.figure ? [i, `https://r2/q${i}.png`] : null)).filter(Boolean),
  ));
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

test('the authored fixture is a valid quiz with one picture (the premise)', () => {
  const v = validate(eightWithOne(), { language: 'en', subject: 'maths', digest: DIGEST(), nExpected: 8, lessonSummary: SUMMARY });
  expect(v.errors.filter((e) => !/LEVEL_MIX|at\/below/.test(e))).toEqual([]);
});

test('one picture of eight: ONE add-pictures call, and the quiz ships with three', async () => {
  wire();
  mockCreate
    .mockResolvedValueOnce(authored(eightWithOne()))
    .mockImplementationOnce(async (req) => {
      // the repair is offered only questions without a picture, and asked for two
      expect(promptOf([req])).toMatch(/ADDING PICTURES/);
      expect(promptOf([req])).toMatch(/exactly 2 of/);
      return reply({ pictures: [
        { index: 2, figure: { type: 'count_objects', rows: [{ picto: 'counter', count: 4 }, { picto: 'counter', count: 3 }] }, figure_role: 'model' },
        { index: 3, figure: { type: 'count_objects', rows: [{ picto: 'counter', count: 5 }, { picto: 'counter', count: 3 }] }, figure_role: 'model' },
      ] });
    });
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  const rows = storedRows();
  expect(rows).toHaveLength(8);
  expect(rows.filter((r) => r.media && r.media.figure)).toHaveLength(3);
  expect(densityEvents()).toEqual([expect.objectContaining({ quizId: QID, before: 1, after: 3, target: 3, repaired: true, added: [2, 3] })]);
  expect(lastMeta().figure_density).toMatchObject({ before: 1, after: 3, repaired: true });
});

test('a picture that gives the answer away is reverted, the good one kept', async () => {
  wire();
  mockCreate
    .mockResolvedValueOnce(authored(eightWithOne()))
    .mockResolvedValueOnce(reply({ pictures: [
      // the numberline arc lands on the answer (7) — FIGURE_LEAK
      { index: 2, figure: { type: 'numberline', from: 0, to: 10, step: 1, points: [{ at: 4 }], arcs: [{ from: 4, to: 7 }] }, figure_role: 'model' },
      { index: 3, figure: { type: 'count_objects', rows: [{ picto: 'counter', count: 5 }, { picto: 'counter', count: 3 }] }, figure_role: 'model' },
    ] }));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(storedRows().filter((r) => r.media && r.media.figure)).toHaveLength(2);
  expect(densityEvents()[0]).toMatchObject({ before: 1, after: 2, repaired: true, added: [3] });
  expect(lastMeta().figure_density.reverted).toEqual([2]);
  // still short of three: recorded as a SOFT fault, never a failure
  expect(lastMeta().soft_faults).toEqual(expect.arrayContaining([expect.stringMatching(/^FIGURE_FEW — 2\/8/)]));
});

test('a repair call that fails costs nothing: the quiz ships as authored, and FIGURE_FEW is recorded', async () => {
  wire();
  mockCreate
    .mockResolvedValueOnce(authored(eightWithOne()))
    .mockRejectedValueOnce(new Error('provider down'));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(storedRows().filter((r) => r.media && r.media.figure)).toHaveLength(1);
  expect(densityEvents()[0]).toMatchObject({ before: 1, after: 1, repaired: false });
  expect(lastMeta().soft_faults).toEqual(expect.arrayContaining([expect.stringMatching(/^FIGURE_FEW/)]));
});

test('a quiz that already has three pictures makes no extra call', async () => {
  wire();
  const three = eightWithOne();
  three[2] = q(2, { figure: { type: 'count_objects', picto: 'counter', count: 5 }, figure_role: 'count_compare', question: 'How many counters are in the picture?', options: ['5', '4', '6'] });
  three[3] = q(3, { figure: { type: 'count_objects', picto: 'tile', count: 8 }, figure_role: 'count_compare', question: 'How many tiles are in the picture?', options: ['8', '7', '9'] });
  mockCreate.mockResolvedValueOnce(authored(three));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(densityEvents()[0]).toMatchObject({ before: 3, after: 3, repaired: false, reason: 'enough' });
});

test('a grade 7 maths quiz is not measured at all', async () => {
  wire(DIGEST('6-8'));
  mockCreate.mockResolvedValueOnce(authored(eightWithOne()));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(densityEvents()).toEqual([]);
});
