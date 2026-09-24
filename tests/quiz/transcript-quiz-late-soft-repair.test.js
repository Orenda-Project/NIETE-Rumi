'use strict';
/**
 * A question written AFTER the last repair pass gets one of its own.
 *
 * Staging, 24 Sep 2026 (quiz bd00a132): attempt 1 was repaired in place (the
 * rewrite fixed q1's English terms side by side), then the picture step
 * REPLACED q5 and q7 with new picture questions — and the new q5's explanation
 * and feedback had two English terms side by side again ("Quotient whole",
 * "Remainder Numerator"). Nothing validates a question for repair after the
 * picture step, so it shipped with the fault recorded. The same holds for a
 * question the key check or the blind solve rewrote.
 *
 * Now: before the rows are stored, every question written after the author's
 * loop is validated, and its in-place faults (a verb that guesses the child's
 * gender, English terms side by side) get ONE repair call — the worst five.
 * The repair changes only the text its complaint names; the picture, the key
 * and the options' order stay exactly as they are. Anything that goes wrong
 * keeps the set as it was: this pass never costs the teacher the quiz.
 *
 * Mocked at the network boundary (the LLM client) plus supabase, WhatsApp, the
 * queue, R2, the PDF renderer and the picture/card renders.
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
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const QID = 'bd00a132-0000-4000-8000-000000000001';
const SID = 'bd00a132-0000-4000-8000-000000000002';
const DIGEST = {
  topic: 'Comparing fractions', topic_as_taught: 'fractions کا موازنہ', subject: 'maths', grade_band: '4',
  language_of_instruction: 'ur', confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'دو fractions کا موازنہ کریں', statement_ur: 'دو fractions کا موازنہ کریں', taught_level: 'apply' },
    { id: 'S2', statement: 'پٹی کا رنگا ہوا حصہ پہچانیں', statement_ur: 'پٹی کا رنگا ہوا حصہ پہچانیں', taught_level: 'understand' },
  ],
  key_terms: ['numerator', 'denominator'], examples_used: ['دو تہائی اور تین پانچویں کی پٹیاں'], misconceptions_surfaced: [],
};
const SUMMARY = 'آج آپ نے دو fractions کا موازنہ cross multiplication سے کروایا اور پٹیوں پر رنگے ہوئے حصے دکھائے۔';
const F = (a, b) => `$\\frac{${a}}{${b}}$`;
const CTX = { language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 8, lessonSummary: SUMMARY, quizId: QID };

const PAIRS = [[2, 3, 3, 5], [3, 4, 2, 5], [1, 2, 2, 3], [3, 5, 4, 7], [2, 7, 1, 3], [5, 6, 3, 4], [4, 9, 1, 2]];
function step(i) {
  const [a, b, c, d] = PAIRS[i - 1];
  return {
    slo_id: 'S1', level: 'apply',
    question: `اگر ${F(a, b)} اور ${F(c, d)} کا موازنہ cross multiplication سے کریں تو $${a} \\times ${d}$ کا جواب کیا ہوگا؟`,
    options: [String(a * d), String(a * d + 1), String(b * d)], correct_index: 0,
    explanation: `پہلے fraction کے numerator کو دوسرے fraction کے denominator سے ضرب دیں: ${a} ضرب ${d}۔`,
    selected_because: 'سبق میں cross multiplication کی مثال سے لیا گیا',
    distractor_misconceptions: { 1: 'ضرب میں ایک زیادہ جوڑ دینا', 2: 'دونوں denominators کو ضرب دینا' },
    option_feedback: { correct: 'شاباش! یہی درست حاصل ضرب ہے۔', wrong: { 1: 'حاصل ضرب دوبارہ دیکھیں۔', 2: 'یہاں دونوں نیچے والے نمبر ضرب ہو گئے ہیں۔' } },
  };
}
const FIRST = {
  slo_id: 'S2', level: 'understand', question: 'ان میں سے کون سا ایک fraction ہے؟',
  options: [F(2, 3), '23', '2 + 3'], correct_index: 0,
  explanation: 'کسی fraction میں اوپر ایک نمبر اور نیچے ایک نمبر ہوتا ہے۔',
  selected_because: 'سبق میں بورڈ پر لکھے fractions سے لیا گیا',
  distractor_misconceptions: { 1: 'دونوں ہندسوں کو ایک نمبر پڑھنا', 2: 'دونوں نمبروں کو جمع سمجھنا' },
  option_feedback: { correct: 'شاباش! یہ دو بٹا تین ہے۔', wrong: { 1: 'یہ ایک پورا نمبر ہے۔', 2: 'یہ جمع کا سوال ہے۔' } },
};
const CLEAN = [FIRST, ...[1, 2, 3, 4, 5, 6, 7].map(step)];
/** Attempt 1's one fault: two English terms side by side in q1's explanation. */
const ADJ_EXPLANATION = 'پہلے fraction کا numerator denominator سے ضرب ہوتا ہے۔';
const AUTHORED = CLEAN.map((q, i) => (i === 1 ? { ...q, explanation: ADJ_EXPLANATION } : q));

const readOff = (over) => ({
  replace: true, level: 'understand', slo_id: 'S2',
  explanation: 'رنگے ہوئے حصے اور کل حصے گنیں۔',
  selected_because: 'سبق میں پٹیوں پر رنگے ہوئے حصوں سے لیا گیا',
  distractor_misconceptions: { 1: 'سفید حصے گننا', 2: 'نمبروں کی جگہ بدل دینا' },
  option_feedback: { correct: 'شاباش! آپ نے پٹی ٹھیک پڑھی۔', wrong: { 1: 'یہاں سفید حصے گنے گئے ہیں۔', 2: 'کل حصے لکیر کے نیچے لکھے جاتے ہیں۔' } },
  figure_role: 'read_off',
  ...over,
});
/** The picture step's new q5 — and, as on staging, two English terms side by side in its explanation. */
const LATE_ADJ = 'رنگے ہوئے حصے numerator denominator کی جگہ بتاتے ہیں۔';
const PIC5 = readOff({
  index: 5, question: 'پٹی کا کتنا حصہ رنگا ہوا ہے؟', options: [F(3, 5), F(2, 5), F(5, 3)], correct_index: 0,
  explanation: LATE_ADJ,
  figure: { type: 'fraction_bar', bars: [{ parts: 5, shaded: 3 }] },
});
const PIC6 = readOff({
  index: 6, question: 'دونوں پٹیوں میں سے زیادہ رنگی ہوئی پٹی کا کتنا حصہ رنگا ہوا ہے؟', options: [F(2, 3), F(3, 5), F(5, 8)], correct_index: 0,
  figure: { type: 'fraction_bar', bars: [{ parts: 3, shaded: 2 }, { parts: 5, shaded: 3 }] },
});
const PIC7 = readOff({
  index: 7, question: 'اس پٹی کا کتنا حصہ رنگا ہوا ہے؟', options: [F(1, 4), F(3, 4), F(4, 1)], correct_index: 0,
  figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 1 }] },
});

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }], usage: { cost: 0.004 } });
const promptOf = (call) => call.messages[0].content;
const isRewrite = (call) => /REWRITE THESE QUESTIONS/.test(promptOf(call));
const isPictures = (call) => /"pictures"/.test(promptOf(call));
const asked = (p) => ((/REWRITE THESE QUESTIONS: ([^\n]+)/.exec(p) || [])[1] || '').split(', ').map((s) => Number(s.slice(1)));

function llm({ finalRepair } = {}) {
  mockCreate.mockImplementation(async (call) => {
    if (isPictures(call)) return reply({ pictures: [PIC5, PIC6, PIC7] });
    if (isRewrite(call)) {
      const idx = asked(promptOf(call));
      if (idx.includes(1)) return reply({ questions: [{ index: 1, ...CLEAN[1] }] });    // attempt 1's in-place repair
      return finalRepair ? finalRepair(idx) : reply({ questions: [] });
    }
    return reply({ lesson_summary: SUMMARY, questions: AUTHORED });
  });
}
function wire() {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
      id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: DIGEST.topic, subject: 'maths', language: 'ur', status: 'generating',
      meta: { digest: DIGEST, grade: '4', step: 'author' },
    }] }),
    coaching_sessions: { data: [{ id: SID, user_id: 'u-1', transcript_text: 'سبق '.repeat(400), transcript_language: 'ur', created_at: '2026-09-24T04:00:00Z', analysis_data: {}, users: { phone_number: '920000000001', preferred_language: 'ur', name: 'A B' } }] },
    quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
    users: { data: [{ phone_number: '920000000001', preferred_language: 'ur' }] },
  });
}
const storedRows = () => { const ins = supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert'); return ins.length ? ins[0][1] : []; };
const lastMeta = () => {
  const ups = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((c) => c[1]);
  return ups.map((u) => u.meta).filter(Boolean).pop();
};
const rewrites = () => mockCreate.mock.calls.map((c) => c[0]).filter(isRewrite).map(promptOf);
const adjacentFaults = (m) => (m.soft_faults || []).filter((e) => /URDU_ADJACENT_TERMS/.test(e));

beforeEach(() => {
  jest.clearAllMocks(); mockCreate.mockReset();
  process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; delete process.env.TRANSCRIPT_QUIZ_MAX_ATTEMPTS;
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  installAgreeingSolver(Gen);
  jest.spyOn(Gen, 'renderFigures').mockImplementation(async ({ questions }) => Object.fromEntries(
    questions.map((x, i) => (x && x.figure ? [i, `https://r2/q${i}.png`] : null)).filter(Boolean),
  ));
  jest.spyOn(Gen, 'renderCards').mockResolvedValue({});
});

test('the premise: the planted faults are the only ones', () => {
  expect(validate(CLEAN, CTX).errors.filter((e) => !/LEVEL_MIX|at\/below|FIGURE_FEW/.test(e))).toEqual([]);
  expect(validate(AUTHORED, CTX).errors).toEqual([expect.stringMatching(/^q1: URDU_ADJACENT_TERMS/)]);
  const late = CLEAN.map((q, i) => ([5, 6, 7].includes(i) ? [PIC5, PIC6, PIC7][i - 5] : q)).map(({ index, replace, ...q }) => q);
  expect(validate(late, CTX).errors.filter((e) => /URDU_ADJACENT_TERMS/.test(e))).toEqual([expect.stringMatching(/^q5: URDU_ADJACENT_TERMS — explanation/)]);
});

test('a picture question that arrives with English terms side by side is repaired before it ships, its picture and key untouched', async () => {
  const REPAIRED = 'رنگے ہوئے حصے اوپر لکھے جاتے ہیں اور کل حصے نیچے۔';
  llm({ finalRepair: (idx) => reply({ questions: idx.map((i) => ({ index: i, ...PIC5, figure: null, explanation: REPAIRED })) }) });
  wire();

  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  // attempt 1's repair of q1, then ONE more — for the question the picture step wrote
  expect(rewrites().map(asked)).toEqual([[1], [5]]);

  const rows = storedRows();
  expect(rows).toHaveLength(8);
  const q5 = rows.find((r) => r.question_text === PIC5.question);
  expect(q5.explanation).toBe(REPAIRED);
  expect(q5.media && q5.media.figure).toEqual(PIC5.figure);          // the picture stays
  expect(q5[`option_${q5.correct_option.toLowerCase()}`]).toBe(F(3, 5));   // the key stays (the stored order is shuffled)
  expect(adjacentFaults(lastMeta())).toEqual([]);
  expect(lastMeta().final_repair).toEqual(expect.objectContaining({ status: 'fixed', asked: [5], fixed: 1 }));
});

test('a final repair that gives nothing usable keeps the set as it was: the quiz ships, the fault recorded', async () => {
  llm({ finalRepair: () => reply({ questions: [] }) });
  wire();

  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(rewrites().map(asked)).toEqual([[1], [5]]);
  const rows = storedRows();
  expect(rows).toHaveLength(8);
  expect(rows.find((r) => r.question_text === PIC5.question).explanation).toBe(LATE_ADJ);
  expect(adjacentFaults(lastMeta())).toEqual([expect.stringMatching(/URDU_ADJACENT_TERMS/)]);
  expect(lastMeta().final_repair).toEqual(expect.objectContaining({ status: 'unchanged', asked: [5] }));
});

test('a question the author\'s loop already tried to repair is not tried again at the end', async () => {
  // the loop's repairs of q1 give nothing usable (one per attempt, as before): q1 ships with its fault, and the final pass leaves it alone
  mockCreate.mockImplementation(async (call) => {
    if (isPictures(call)) return reply({ pictures: [] });
    if (isRewrite(call)) return reply({ questions: [] });
    return reply({ lesson_summary: SUMMARY, questions: AUTHORED });
  });
  wire();

  const out = await Gen.process(QID);
  expect(out.ok).toBe(true);
  expect(rewrites().length).toBeGreaterThan(0);
  expect(rewrites().map(asked).every((idx) => idx.join() === '1')).toBe(true);
  expect(lastMeta().final_repair).toBeUndefined();
});
