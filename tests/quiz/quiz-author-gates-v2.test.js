'use strict';
/**
 * Quiz author gates v2 (app_settings quiz_author_gates_v2): faults a pedagogy
 * review found in shipped rows, each now a q-named validator complaint, so the
 * existing targeted rewrite repairs the question instead of shipping it.
 *
 * Every case runs through the REAL validator (validate), the real blind-solve
 * prompt and the real web item normaliser. Supabase, the logger and the LLM
 * call are the boundaries and are faked. With the flag off (the default),
 * every case must produce exactly today's complaints.
 */
const mockSettings = { rows: [] };
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({
    select: () => ({
      in: async () => ({ data: mockSettings.rows, error: null }),
      eq: (_col, key) => ({ maybeSingle: async () => ({ data: mockSettings.rows.find((r) => r.key === key) || null, error: null }) }),
    }),
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
const mockComplete = jest.fn();
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => {
  const actual = jest.requireActual('../../bot/shared/services/quiz/transcript-quiz-llm');
  return { ...actual, completeJson: (...a) => mockComplete(...a) };
});

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const KeyVerify = require('../../bot/shared/services/quiz/transcript-quiz-key-verify.service');
const W = require('../../bot/shared/services/quiz/web-quiz-items');

const DIGEST = { subject: 'maths', slos: [{ id: 'S1', statement: 'subtract hundreds and tens', taught_level: 'apply' }] };
const q = (i, over = {}) => ({
  slo_id: 'S1', level: 'apply',
  question: `Which number has ${i + 2} tens?`,
  options: [`${i + 2}0`, `${i + 3}`, `${i + 4}00`],
  correct_index: 0,
  explanation: `${i + 2} tens make ${i + 2}0.`,
  selected_because: 'the class counted tens on the board',
  option_feedback: { correct: 'Yes, that is right.', wrong: { 1: 'That is ones.', 2: 'That is hundreds.' } },
  ...over,
});
const six = (over) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
const run = (over, authorGates, ctx = {}) => validate(six(over), {
  language: 'en', subject: 'maths', digest: DIGEST, authorGates, ...ctx,
}).errors.filter((e) => /^q0: /.test(e));
const codes = (errs) => errs.map((e) => e.replace(/^q\d+: /, '').split(/\s/)[0]);

describe('a well-formed set gains no complaint with the gates on', () => {
  test('clean', () => {
    expect(validate(six({}), { language: 'en', subject: 'maths', digest: DIGEST, authorGates: true }).errors).toEqual([]);
  });
});

describe('maths: every number in the key and the why is recomputed', () => {
  test('a stem sum whose key is not its answer is KEY_ARITHMETIC', () => {
    const over = { question: 'What is 490 − 80?', options: ['410', '310', '570'], correct_index: 1, explanation: 'Take 8 tens from 49 tens.' };
    expect(codes(run(over, true))).toContain('KEY_ARITHMETIC');
    expect(codes(run(over, false))).not.toContain('KEY_ARITHMETIC');
  });
  test('a wrong "a op b = c" in the why is WHY_ARITHMETIC (Urdu digits too)', () => {
    const over = { question: 'What is 25 − 14?', options: ['11', '9', '39'], explanation: '۲۵ − ۱۴ = ۱۲, so the answer is 11.' };
    expect(codes(run(over, true))).toContain('WHY_ARITHMETIC');
    expect(codes(run(over, undefined))).not.toContain('WHY_ARITHMETIC');
  });
  test('a why that lands on a wrong option is WHY_CONTRADICTS_KEY', () => {
    const over = {
      question: 'Ali has 1200 beads. How many must go so 875 are left?', options: ['325', '875', '2075'], correct_index: 0,
      explanation: 'Take away 8 hundreds, 7 tens and 5 ones: that is 875.',
    };
    expect(codes(run(over, true))).toContain('WHY_CONTRADICTS_KEY');
    expect(codes(run(over, false))).not.toContain('WHY_CONTRADICTS_KEY');
  });
  test('"may need regrouping" on 490 − 80 is REGROUP_CLAIM; a sum that does need it is not', () => {
    const over = { question: 'What is 490 − 80?', options: ['410', '310', '570'], correct_index: 0, explanation: 'Subtract the tens. This may need regrouping.' };
    expect(codes(run(over, true))).toContain('REGROUP_CLAIM');
    const needs = { question: 'What is 412 − 80?', options: ['332', '492', '432'], correct_index: 0, explanation: 'Borrow one hundred to subtract the tens.' };
    expect(codes(run(needs, true))).not.toContain('REGROUP_CLAIM');
  });
});

describe('the recompute reads worded sums and does not cry wolf', () => {
  test('«490 میں سے 80 تفریق» with "may need regrouping" is REGROUP_CLAIM', () => {
    const over = { question: '490 میں سے 80 تفریق کرنے پر کیا جواب آئے گا؟', options: ['400', '570', '410'], correct_index: 2,
      explanation: '490 میں سے 80 تفریق کرنے کے لیے regrouping کی ضرورت پڑ سکتی ہے، جس کا نتیجہ 410 ہے۔' };
    expect(codes(run(over, true))).toContain('REGROUP_CLAIM');
  });
  test('a three-term sum is not read as its first two terms (no KEY_ARITHMETIC, no WHY_ARITHMETIC)', () => {
    const over = { question: 'What is the sum of $123 + 456 + 789$?', options: ['1368', '579', '1268'], correct_index: 0, explanation: '123 + 456 + 789 = 1368.' };
    const c = codes(run(over, true));
    expect(c).not.toContain('KEY_ARITHMETIC');
    expect(c).not.toContain('WHY_ARITHMETIC');
  });
  test('"the sum of 2345 and 123" keyed 2478 is KEY_ARITHMETIC', () => {
    const over = { question: 'What is the sum of 2345 and 123?', options: ['2468', '2478', '2358'], correct_index: 1, explanation: 'Add the ones first.' };
    expect(codes(run(over, true))).toContain('KEY_ARITHMETIC');
  });
  test('a TeX fraction step ("\\frac{12}{10} \\times 20 = 24") and a question about a wrong step are not WHY_ARITHMETIC', () => {
    const frac = { question: 'If 12 men take 20 days, how long will 10 men take?', options: ['24 days', '18 days', '16 days'],
      explanation: 'So $x = \\frac{12}{10} \\times 20 = 24$ days.' };
    expect(codes(run(frac, true))).not.toContain('WHY_ARITHMETIC');
    const step = { question: 'For 46 × 18, which partial product is wrong?', options: ['8 × 40 = 32', '8 × 6 = 48', '10 × 46 = 460'],
      explanation: '8 × 40 = 32 is wrong: it should be 320.' };
    expect(codes(run(step, true))).not.toContain('WHY_ARITHMETIC');
  });
  test('"64 ÷ 7 = 9 with a remainder of 1" is not WHY_ARITHMETIC', () => {
    const over = { question: 'How many chairs in each of 7 rows if there are 64?', options: ['9 chairs', '8 chairs', '7 chairs'],
      explanation: '$64 \\div 7 = 9$ with a remainder of 1, because $7 \\times 9 = 63$.' };
    expect(codes(run(over, true))).not.toContain('WHY_ARITHMETIC');
  });
  test('a key that is one of the sum\'s own numbers ("which is the whole in 18 − 7?") is not KEY_ARITHMETIC', () => {
    const over = { question: 'In 18 − 7, which number is the whole?', options: ['18', '7', '11'], correct_index: 0, explanation: '18 is the whole.' };
    expect(codes(run(over, true))).not.toContain('KEY_ARITHMETIC');
  });
  test('"the subtraction in the picture" whose why works on 425 − 312 needs both drawn', () => {
    const over = { question: 'Does the subtraction in the picture need regrouping?', options: ['Yes', 'No', 'Only in tens'], correct_index: 1,
      explanation: '425 - 312 needs no regrouping: every top digit is bigger.', figure: { type: 'base_ten', hundreds: 4, tens: 2, ones: 5 } };
    expect(run(over, true).find((e) => /FIGURE_NUMBERS/.test(e))).toMatch(/312/);
  });
});

describe('a 10 × 10 grid carries 100 (no false alarm on a good grid item)', () => {
  test('"What fraction of the grid is shaded?" over a 10x10 grid with 8 shaded passes', () => {
    const over = { question: 'What fraction of the grid is shaded?', options: ['8/100', '100/8', '8/10'], correct_index: 0,
      explanation: 'The grid has 100 small squares and 8 are shaded: $\\frac{8}{100}$.', figure: { type: 'grid', rows: 10, cols: 10, shaded: 8 } };
    expect(codes(run(over, true))).not.toContain('FIGURE_NUMBERS');
  });
});

describe('a stem that points at a picture needs that picture, with the stem\'s numbers', () => {
  test('"the clock" with no figure is PICTURE_MISSING', () => {
    const over = { question: 'What time does the clock show?', options: ['3 o\'clock', '4 o\'clock', '5 o\'clock'], explanation: 'The short hand is on 3.' };
    expect(codes(run(over, true))).toContain('PICTURE_MISSING');
    expect(codes(run(over, false))).not.toContain('PICTURE_MISSING');
  });
  test('Urdu «خالی خانے» with no figure is PICTURE_MISSING', () => {
    const over = { question: 'خالی خانے میں کون سا عدد آئے گا؟ 5, 10, __, 20', options: ['15', '12', '25'], explanation: 'ہر بار 5 بڑھتا ہے۔' };
    expect(codes(run(over, true))).toContain('PICTURE_MISSING');
  });
  test('a base_ten picture that draws 425 for "425 − 312" is FIGURE_NUMBERS (312 missing)', () => {
    const over = {
      question: 'Use the blocks: what is 425 − 312?', options: ['113', '737', '123'], correct_index: 0, explanation: '425 − 312 = 113.',
      figure: { type: 'base_ten', hundreds: 4, tens: 2, ones: 5 },
    };
    const errs = run(over, true).filter((e) => /FIGURE_NUMBERS/.test(e));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/312/);
    expect(errs[0]).not.toMatch(/425/);
  });
});

describe('board follow-ups: emoji pictures, the clock, a key the lesson never gave', () => {
  test('"Look at the pictures" with emoji options is not PICTURE_MISSING (the options are the pictures)', () => {
    const over = { question: 'Look at the pictures. Which one is a leaf?', options: ['🌸', '🍃', '🥕'], correct_index: 1, explanation: 'A leaf is green and flat.' };
    expect(codes(run(over, true))).not.toContain('PICTURE_MISSING');
  });
  test('"The clock shows 4 o\'clock. After 1 hour…" states the time and needs no picture; "What time does the clock show?" does', () => {
    const stated = { question: 'The clock shows 4 o\'clock. After 1 hour, what time is it?', options: ['5 o\'clock', '3 o\'clock', '6 o\'clock'], explanation: 'One hour after 4 is 5.' };
    expect(codes(run(stated, true))).not.toContain('PICTURE_MISSING');
    const asks = { question: 'What time does the clock show?', options: ['3 o\'clock', '4 o\'clock', '5 o\'clock'], explanation: 'The short hand is on 3.' };
    expect(codes(run(asks, true))).toContain('PICTURE_MISSING');
  });
  test('a why that says the lesson never gave the answer is KEY_NOT_IN_LESSON (en + ur)', () => {
    const en = { question: 'What was Pinky told not to eat?', options: ['Nothing was forbidden', 'Sweets', 'Rice'], correct_index: 0,
      explanation: 'No specific food was mentioned in the lesson, so nothing was forbidden.' };
    expect(codes(run(en, true))).toContain('KEY_NOT_IN_LESSON');
    expect(codes(run(en, false))).not.toContain('KEY_NOT_IN_LESSON');
    const ur = { question: 'پنکی کو کیا کھانے سے منع کیا گیا؟', options: ['کچھ بھی منع نہیں کیا گیا', 'مٹھائی', 'چاول'], correct_index: 0,
      explanation: 'سبق میں کسی خاص چیز کا ذکر نہیں کیا گیا۔' };
    expect(codes(run(ur, true))).toContain('KEY_NOT_IN_LESSON');
    const ur2 = { ...ur, explanation: 'سبق میں پینکی کو کسی خاص چیز کے کھانے سے منع کرنے کا ذکر نہیں تھا۔' };
    expect(codes(run(ur2, true))).toContain('KEY_NOT_IN_LESSON');
    const named = { question: 'Which word does NOT belong with these tricky words: she, he, we, fish?', options: ['fish', 'she', 'we'],
      explanation: 'Fish was not named as a tricky word.' };
    expect(codes(run(named, true))).not.toContain('KEY_NOT_IN_LESSON');
  });
});

describe('the prose rules as code', () => {
  test('a question about the teacher is ABOUT_TEACHER', () => {
    const over = { question: 'Why did the teacher predict the 20 tens?', options: ['20', '3', '400'], explanation: 'Two tens.' };
    expect(codes(run(over, true))).toContain('ABOUT_TEACHER');
    expect(codes(run(over, false))).not.toContain('ABOUT_TEACHER');
  });
  test('«استاد نے کیا کہا؟» is ABOUT_TEACHER; a word problem that names a teacher is not', () => {
    expect(codes(run({ question: 'استاد نے 20 دہائیوں کے بارے میں کیا کہا؟', options: ['20', '3', '400'] }, true))).toContain('ABOUT_TEACHER');
    const word = { question: 'Zainab has 452 rupees. The teacher spends 236 of them. How much is left?', options: ['216', '688', '226'], explanation: '452 − 236 = 216.' };
    expect(codes(run(word, true))).not.toContain('ABOUT_TEACHER');
  });
  test('a digit or a Latin letter among Urdu letter options is THROWAWAY_OPTION', () => {
    const DIG_UR = { subject: 'urdu', slos: [{ id: 'S1', statement: 'حروف تہجی پہچاننا', taught_level: 'recall' }] };
    const ur = (i, over = {}) => ({
      slo_id: 'S1', level: 'recall', question: 'بکری کس حرف سے شروع ہوتا ہے؟', options: ['ب', 'پ', 'ت'], correct_index: 0,
      explanation: 'بکری کا پہلا حرف ب ہے۔', selected_because: 'کلاس میں حروف دہرائے گئے',
      option_feedback: { correct: 'شاباش، ب درست ہے۔', wrong: { 1: 'یہ پ ہے، ب نہیں۔', 2: 'یہ ت ہے، ب نہیں۔' } },
      ...over,
    });
    const set = (over) => [0, 1, 2, 3, 4, 5].map((i) => ur(i, i === 0 ? over : { question: `بکری کا حرف نمبر ${i} کون سا ہے؟` }));
    const over = { options: ['ب', '1', 'A'] };
    const on = validate(set(over), { language: 'ur', subject: 'urdu', digest: DIG_UR, authorGates: true }).errors.filter((e) => /^q0: /.test(e));
    const off = validate(set(over), { language: 'ur', subject: 'urdu', digest: DIG_UR }).errors.filter((e) => /^q0: /.test(e));
    expect(codes(on)).toContain('THROWAWAY_OPTION');
    expect(codes(off)).not.toContain('THROWAWAY_OPTION');
  });
});

describe('key correctness: the blind solve is told "fully correct, never the closest"', () => {
  const drink = {
    question: 'What is the past tense of "drink"?', options: ['Drinking', 'Drinked', 'Drunk'], correct_index: 2,
    explanation: 'The simple past tense is drank.', option_feedback: { correct: 'Yes', wrong: { 0: 'no', 1: 'no' } },
  };
  beforeEach(() => {
    mockComplete.mockReset();
    mockComplete.mockResolvedValue({ json: { answers: [{ index: 0, correct: [], unsure: false, note: 'drank is not offered' }] }, model: 'm', costUsd: 0.001, latencyMs: 5 });
  });
  test('with the gates on, the prompt carries the rule and "none correct" flags the item', async () => {
    const out = await KeyVerify.verifyKeys({ questions: [drink], language: 'en', grade: '4', subject: 'english', strictKey: true });
    expect(mockComplete.mock.calls[0][0].prompt).toContain('FULLY CORRECT, NEVER THE CLOSEST');
    expect(out.verdicts[0].verdict).toBe('none_correct');
  });
  test('with the gates off the prompt is today\'s', async () => {
    await KeyVerify.verifyKeys({ questions: [drink], language: 'en', grade: '4', subject: 'english' });
    expect(mockComplete.mock.calls[0][0].prompt).not.toContain('FULLY CORRECT, NEVER THE CLOSEST');
  });
});

describe('web items: no "A: " letter prefix in the read-aloud text', () => {
  const TRANSCRIPT = '[03:40] Teacher: Water is a liquid. It flows and takes the shape of the glass.';
  const row = {
    question_text: 'Which of these is a liquid?', option_a: 'stone', option_b: 'milk', option_c: 'air', correct_option: 'B',
    explanation: 'A liquid flows.', option_feedback: { correct: 'Yes, milk flows.', wrong: { 0: 'A stone keeps its shape.', 2: 'Air is a gas.' } },
    media: {}, render_pattern: 'P1', external_id: 'tq:q:S1:1',
  };
  const raw = {
    type: 'single', read: { stem: 'Which of these is a liquid?', opts: ['A: stone', 'B: milk', 'C: air'] },
    source_quote: 'Water is a liquid. It flows and takes the shape of the glass', why: 'A liquid flows and takes the shape of its cup.',
  };
  const ctx = (authorGates) => ({ language: 'en', source: { kind: 'transcript', text: TRANSCRIPT }, gradeBand: '3-5', authorGates });
  // Measured on a real run (10 lessons): when the model copies the prompt's "A: stone" option format into
  // read.opts it does so for EVERY item, and refusing them cost two quizzes all their web items (and hints).
  test('gates on: a prefix that names the option\'s OWN slot is stripped and the item kept', () => {
    const out = W.normaliseItem(raw, row, 1, ctx(true));
    expect(out.item).toBeTruthy();
    expect(out.item.read.opts).toEqual(['stone', 'milk', 'air']);
    expect(out.item.options.map((o) => o.name)).toEqual(['stone', 'milk', 'air']);
  });
  test('gates on: a prefix that names ANOTHER slot is refused (the spoken options would be out of order)', () => {
    const swapped = { ...raw, read: { ...raw.read, opts: ['B: stone', 'A: milk', 'C: air'] } };
    expect(W.normaliseItem(swapped, row, 1, ctx(true))).toEqual({ item: null, reason: 'read_letter_prefix' });
  });
  test('gates on: a stem read as "A: …" is still refused', () => {
    const stem = { ...raw, read: { stem: 'A: Which of these is a liquid?', opts: ['stone', 'milk', 'air'] } };
    expect(W.normaliseItem(stem, row, 1, ctx(true))).toEqual({ item: null, reason: 'read_letter_prefix' });
  });
  test('gates off: today\'s behaviour', () => {
    expect(W.normaliseItem(raw, row, 1, ctx(false)).item).not.toBeNull();
  });
});

describe('the flag: app_settings quiz_author_gates_v2, off by default', () => {
  const Gates = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
  beforeEach(() => Gates.resetForTests());
  test('no row: off, and the validator stays as today', async () => {
    mockSettings.rows = [];
    expect(await Gates.refreshFlag()).toBe(false);
    const over = { question: 'Why did the teacher predict the 20 tens?', options: ['20', '3', '400'] };
    expect(codes(run(over, undefined))).not.toContain('ABOUT_TEACHER');
  });
  test('generate hands over its one read: setEnabled(true) turns the gates on for validate()', () => {
    Gates.setEnabled(true);
    expect(codes(run({ question: 'Why did the teacher predict the 20 tens?', options: ['20', '3', '400'] }, undefined))).toContain('ABOUT_TEACHER');
    Gates.setEnabled(false);
    expect(codes(run({ question: 'Why did the teacher predict the 20 tens?', options: ['20', '3', '400'] }, undefined))).not.toContain('ABOUT_TEACHER');
  });
  test('row true: on, and a validator call with no explicit choice applies the gates', async () => {
    mockSettings.rows = [{ key: 'quiz_author_gates_v2', value: true }];
    expect(await Gates.refreshFlag()).toBe(true);
    const over = { question: 'Why did the teacher predict the 20 tens?', options: ['20', '3', '400'] };
    expect(codes(run(over, undefined))).toContain('ABOUT_TEACHER');
  });
});
