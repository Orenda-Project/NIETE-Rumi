'use strict';
/**
 * A FRACTIONS LESSON WHOSE AUTHOR WROTE ONLY THE METHOD still ends with three
 * pictures — through the generate step, the add-pictures repair REPLACING the
 * questions no picture can answer.
 *
 * The live case (grade 4, comparing unlike fractions): eight questions on the
 * cross products and the rewritten fractions, no picture. Bars bolted onto
 * those were refused by FIGURE_MISMATCH — rightly — and the quiz shipped with
 * none. Now the repair may put a read-off question on the same objective in
 * such a question's place; the merged set is validated in full, a replacement
 * that gives its answer away is reverted to the original question, and the new
 * keys go through the blind solve before a row is stored.
 *
 * Only the network boundary is replaced (the model, supabase, WhatsApp, R2, the
 * renders' browser, and the blind solve's seam — an agreeing solver whose
 * input is asserted).
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'A B', topic: 'Fractions' }),
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

const QID = '66666666-6666-4666-8666-666666666666';
const SID = '55555555-5555-4555-8555-555555555555';
const DIGEST = {
  topic: 'Comparing unlike fractions', topic_as_taught: 'Comparing unlike fractions', subject: 'maths', grade_band: '4',
  language_of_instruction: 'en', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'compare two fractions with different denominators', taught_level: 'apply' },
    { id: 'S2', statement: 'tell which fraction of a whole is shaded', taught_level: 'understand' },
  ],
  key_terms: ['numerator', 'denominator'], examples_used: ['two thirds and three fifths of a bar'], misconceptions_surfaced: ['a bigger denominator means a bigger fraction'],
};
const SUMMARY = 'Today you taught comparing two fractions with different denominators, starting from two thirds and three fifths.';
const F = (a, b) => `$\\frac{${a}}{${b}}$`;

const PAIRS = [[2, 3, 3, 5], [3, 4, 2, 5], [1, 2, 2, 3], [3, 5, 4, 7], [2, 7, 1, 3], [5, 6, 3, 4], [4, 9, 1, 2]];
/** A question about a STEP of the method: no picture can produce its answer. */
function step(i) {
  const [a, b, c, d] = PAIRS[i - 1];
  return {
    slo_id: i % 2 ? 'S1' : 'S2', level: i % 2 ? 'apply' : 'understand',
    question: `To compare ${F(a, b)} and ${F(c, d)} by cross multiplication, what is $${a} \\times ${d}$?`,
    options: [String(a * d), String(a * d + 1), String(b * d)], correct_index: 0,
    explanation: `Multiply the first numerator by the second denominator: ${a} times ${d}.`,
    selected_because: 'the cross multiplication in the worked example',
    distractor_misconceptions: { 1: 'adds one while multiplying', 2: 'multiplies the two denominators' },
    option_feedback: { correct: 'Yes — numerator times the other denominator.', wrong: { 1: 'Check the product again.', 2: 'That multiplies the two denominators.' } },
  };
}
function allMethod() {
  return [{
    slo_id: 'S2', level: 'understand', question: 'Which of these is a fraction?',
    options: [F(2, 3), '23', '2 + 3'], correct_index: 0,
    explanation: 'A fraction has a numerator over a denominator.',
    selected_because: 'the fractions written on the board',
    distractor_misconceptions: { 1: 'reads the digits as one number', 2: 'reads the two numbers as a sum' },
    option_feedback: { correct: 'Yes — two over three.', wrong: { 1: 'That is a whole number.', 2: 'That is a sum.' } },
  }, ...[1, 2, 3, 4, 5, 6, 7].map(step)];
}

const readOff = (over) => ({
  replace: true, level: 'understand',
  explanation: 'Count the shaded parts and all the parts.',
  selected_because: 'the bars drawn to compare fractions',
  distractor_misconceptions: { 1: 'counts the unshaded parts', 2: 'swaps the numbers' },
  option_feedback: { correct: 'Yes — you read the bar.', wrong: { 1: 'That counts the white parts.', 2: 'The number of parts goes under the line.' } },
  figure_role: 'read_off',
  ...over,
});
const SHADED = readOff({
  index: 1, question: 'What fraction of the bar is shaded?', options: [F(3, 5), F(2, 5), F(5, 3)], correct_index: 0,
  figure: { type: 'fraction_bar', bars: [{ parts: 5, shaded: 3 }] },
});
const WHICH_BAR = readOff({
  index: 2, question: `Which bar shows ${F(2, 3)}?`, options: ['A', 'B', 'C'], correct_index: 0,
  distractor_misconceptions: { 1: 'matches the numerator only', 2: 'matches one shaded part' },
  option_feedback: { correct: 'Yes — bar A has 2 of its 3 parts shaded.', wrong: { 1: 'Bar B has 2 of 5 parts shaded.', 2: 'Bar C has 1 of 4 parts shaded.' } },
  figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2, label: 'A' }, { parts: 5, shaded: 2, label: 'B' }, { parts: 4, shaded: 1, label: 'C' }] },
});
const MORE_SHADED = readOff({
  index: 3, question: 'Both bars are the same length. What fraction of the bar with more shaded is shaded?',
  options: [F(2, 3), F(3, 5), F(5, 8)], correct_index: 0,
  figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2 }, { parts: 5, shaded: 3 }] },
});

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.004 } });
const authored = (questions) => reply({ lesson_summary: SUMMARY, lesson_summary_short: 'Comparing unlike fractions.', checks_summary: 'This quiz checks comparing fractions.', questions });

function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'maths', language: 'en', status: 'generating',
      meta: { digest: DIGEST, grade: '4', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'lesson '.repeat(400), transcript_language: 'en', created_at: '2026-09-07T04:00:00Z', analysis_data: {}, users: { phone_number: '920000000001', preferred_language: 'en', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '920000000001', preferred_language: 'en' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const densityEvents = () => logEvent.mock.calls.filter((c) => c[0] === 'transcript_quiz.figure_density').map((c) => c[1]);
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((c) => c[1]);
  return ups.map((u) => u.meta).filter(Boolean).pop();
};

let solver;
beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  solver = installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockImplementation(async ({ questions }) => Object.fromEntries(
    questions.map((x, i) => (x && x.figure ? [i, `https://r2/q${i}.png`] : null)).filter(Boolean),
  ));
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

test('the premise: eight method questions are a valid quiz with no picture', () => {
  const v = validate(allMethod(), { language: 'en', subject: 'maths', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY });
  expect(v.errors.filter((e) => !/LEVEL_MIX|at\/below|FIGURE_FEW/.test(e))).toEqual([]);
  expect(v.questions.filter((x) => x.figure)).toHaveLength(0);
});

test('three method questions are replaced by read-off picture questions, and their keys are solved blind', async () => {
  wire();
  mockCreate
    // the live shape: no picture on attempt 1 (sent back, FIGURE_REQUIRED) and none again on attempt 2
    .mockResolvedValueOnce(authored(allMethod()))
    .mockResolvedValueOnce(authored(allMethod()))
    .mockResolvedValueOnce(reply({ pictures: [SHADED, WHICH_BAR, MORE_SHADED] }));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);

  const rows = storedRows();
  expect(rows).toHaveLength(8);
  const pictured = rows.filter((r) => r.media && r.media.figure);
  expect(pictured).toHaveLength(3);
  expect(pictured.map((r) => r.question_text)).toEqual([SHADED.question, WHICH_BAR.question, MORE_SHADED.question]);

  expect(densityEvents()).toEqual([expect.objectContaining({
    quizId: QID, before: 0, after: 3, target: 3, repaired: true, added: [1, 2, 3], replaced: [1, 2, 3],
  })]);
  expect(lastMeta().figure_density).toMatchObject({ before: 0, after: 3, replaced: [1, 2, 3] });

  // the blind solve saw the NEW questions and their pictures, not the method steps
  const solved = solver.mock.calls[0][0].questions;
  expect(solved[1]).toMatchObject({ question: SHADED.question, correct_index: 0, figure: SHADED.figure });
  expect(solved[2]).toMatchObject({ question: WHICH_BAR.question, figure_role: 'read_off' });
});

test('a replacement that gives its answer away is reverted to the original question', async () => {
  wire();
  const leaky = { ...MORE_SHADED, figure: { ...MORE_SHADED.figure, showLabels: true } }; // prints "2/3" beside the bar
  mockCreate
    .mockResolvedValueOnce(authored(allMethod()))
    .mockResolvedValueOnce(authored(allMethod()))
    .mockResolvedValueOnce(reply({ pictures: [SHADED, WHICH_BAR, leaky] }));
  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);

  const rows = storedRows();
  expect(rows.filter((r) => r.media && r.media.figure)).toHaveLength(2);
  expect(rows[3].question_text).toBe(allMethod()[3].question);
  expect(densityEvents()[0]).toMatchObject({ before: 0, after: 2, added: [1, 2], replaced: [1, 2], reverted: [3] });
  expect(lastMeta().soft_faults).toEqual(expect.arrayContaining([expect.stringMatching(/^FIGURE_FEW — 2\/8/)]));
});
