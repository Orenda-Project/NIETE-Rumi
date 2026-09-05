'use strict';
/**
 * bd-mg9c7.9 — the deterministic validator that runs before any question row
 * is stored. Pure. This is the bulk of the safety net: the prompt asks for
 * these properties, the validator ENFORCES them (root rule 24c).
 */
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');

const DIGEST = {
  slos: [
    { id: 'S1', statement: 'name the parts of a plant', taught_level: 'recall' },
    { id: 'S2', statement: 'explain what roots do', taught_level: 'understand' },
  ],
};

function q(overrides = {}) {
  return {
    slo_id: 'S1', level: 'recall',
    question: 'Which part of the plant is under the soil?',
    options: ['root', 'leaf', 'flower'], correct_index: 0,
    explanation: 'The root grows down into the soil.',
    distractor_misconceptions: { 1: 'leaves are the base', 2: 'flowers anchor' },
    option_feedback: {
      correct: 'Yes — the root is under the soil, holding the plant and drinking water.',
      wrong: { 1: 'Leaves are up in the air making food; the part under the soil is the root.',
               2: 'Flowers make seeds at the top; the part under the soil is the root.' },
    },
    ...overrides,
  };
}

function eightGood() {
  return [
    q(), q({ slo_id: 'S2', level: 'understand', question: 'What do roots do?', options: ['drink water', 'make seeds', 'catch light'] }),
    q({ question: 'q3', options: ['a', 'b', 'c'] }), q({ slo_id: 'S2', level: 'recall', question: 'q4', options: ['d', 'e', 'f'] }),
    q({ question: 'q5', options: ['g', 'h', 'i'] }), q({ slo_id: 'S2', level: 'understand', question: 'q6', options: ['j', 'k', 'l'] }),
    q({ question: 'q7', options: ['m', 'n', 'o'] }), q({ slo_id: 'S2', level: 'apply', question: 'q8', options: ['p', 'r', 's'] }),
  ];
}

const ctx = { language: 'en', subject: 'science', digest: DIGEST, nExpected: 8 };

describe('validate — structure', () => {
  test('a good 8-question quiz passes', () => {
    const r = V.validate(eightGood(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.questions).toHaveLength(8);
  });

  test('rejects fewer than 6 or more than 10 questions', () => {
    expect(V.validate(eightGood().slice(0, 5), ctx).ok).toBe(false);
    expect(V.validate([...eightGood(), ...eightGood().slice(0, 3)], ctx).ok).toBe(false);
  });

  test('rejects duplicate or missing options and a bad correct_index', () => {
    const qs = eightGood(); qs[0].options = ['root', 'root', 'leaf'];
    expect(V.validate(qs, ctx).errors.some((e) => /duplicate options/.test(e))).toBe(true);
    const qs2 = eightGood(); qs2[1].correct_index = 3;
    expect(V.validate(qs2, ctx).errors.some((e) => /correct_index/.test(e))).toBe(true);
  });

  test('wrong-feedback keys must be exactly the two wrong indices', () => {
    const qs = eightGood();
    qs[0].correct_index = 1;   // feedback still keyed 1,2 — the gemini-3.1 copy-the-example bug
    const r = V.validate(qs, ctx);
    expect(r.errors.some((e) => /wrong-feedback keys/.test(e))).toBe(true);
  });

  test('empty correct feedback is rejected', () => {
    const qs = eightGood(); qs[2].option_feedback.correct = '  ';
    expect(V.validate(qs, ctx).errors.some((e) => /empty correct feedback/.test(e))).toBe(true);
  });

  test('caps: stem ≤ 200 and option ≤ 72 code points, measured in code points', () => {
    const qs = eightGood(); qs[0].options[1] = 'x'.repeat(73);
    expect(V.validate(qs, ctx).errors.some((e) => /option >72/.test(e))).toBe(true);
    const qs2 = eightGood(); qs2[0].options[1] = '👍'.repeat(72);   // 72 code points, 144 UTF-16 units
    expect(V.validate(qs2, ctx).errors.some((e) => /option >72/.test(e))).toBe(false);
  });
});

describe('validate — pedagogy', () => {
  test('every SLO must be covered', () => {
    const qs = eightGood().map((x) => ({ ...x, slo_id: 'S1' }));
    expect(V.validate(qs, ctx).errors.some((e) => /SLOs uncovered: S2/.test(e))).toBe(true);
  });

  test('no question more than one level above its SLO, and ≥60% at or below', () => {
    const qs = eightGood(); qs[0].level = 'apply';   // S1 taught at recall → +2
    expect(V.validate(qs, ctx).errors.some((e) => /level apply > taught recall\+1/.test(e))).toBe(true);
    const qs2 = eightGood().map((x, i) => (i < 4 ? { ...x, slo_id: 'S1', level: 'understand' } : x));
    expect(V.validate(qs2, ctx).errors.some((e) => /at\/below taught level/.test(e))).toBe(true);
  });

  test('letter references in any text are rejected', () => {
    const qs = eightGood(); qs[0].option_feedback.wrong[1] = 'B) is wrong, the answer is A.';
    expect(V.validate(qs, ctx).errors.some((e) => /letter reference/.test(e))).toBe(true);
    const qs2 = eightGood(); qs2[0].explanation = 'Option C is right.';
    expect(V.validate(qs2, ctx).errors.some((e) => /letter reference/.test(e))).toBe(true);
  });
});

describe('validate — Urdu', () => {
  const urCtx = { ...ctx, language: 'ur', subject: 'urdu' };
  const urQ = (over = {}) => q({
    question: 'پودے کا کون سا حصہ مٹی کے نیچے ہوتا ہے؟',
    options: ['جڑ', 'پتا', 'پھول'],
    explanation: 'جڑ مٹی کے اندر ہوتی ہے۔',
    option_feedback: { correct: 'بالکل — جڑ مٹی کے نیچے ہوتی ہے اور پانی لیتی ہے۔',
      wrong: { 1: 'پتا ہوا میں ہوتا ہے؛ مٹی کے نیچے جڑ ہوتی ہے۔', 2: 'پھول اوپر ہوتا ہے؛ مٹی کے نیچے جڑ ہوتی ہے۔' } },
    ...over,
  });
  const urEight = () => eightGood().map((x, i) => urQ({ slo_id: x.slo_id, level: x.level, question: `${x.question} ${i}` }));

  test('a proper Urdu quiz passes, with English technical terms allowed', () => {
    const qs = urEight(); qs[0].options = ['root', 'پتا', 'پھول'];
    expect(V.validate(qs, urCtx).errors).toEqual([]);
  });

  test('Roman Urdu is rejected', () => {
    const qs = urEight(); qs[0].question = 'paude ka kaun sa hissa mitti ke neeche hota hai?';
    expect(V.validate(qs, urCtx).errors.some((e) => /roman urdu/.test(e))).toBe(true);
  });

  test('a Latin-heavy "Urdu" quiz fails the script ratio', () => {
    const qs = urEight().map((x) => ({ ...x, question: 'Which part of the plant is under the soil, really and truly, tell me now?', explanation: 'The root grows down into the soil and drinks the water for the whole plant.' }));
    expect(V.validate(qs, urCtx).errors.some((e) => /urdu script ratio/.test(e))).toBe(true);
  });

  test('a known transliterated English term is rewritten in English letters; an unmapped one is rejected', () => {
    const qs = urEight(); qs[0].options = ['نمبریٹر', 'پتا', 'پھول']; qs[0].question = 'فیکشن کے اوپر والے نمبر کو کیا کہتے ہیں؟';
    const r = V.validate(qs, urCtx);
    expect(r.errors.some((e) => /transliterated English term/.test(e))).toBe(false);
    expect(r.questions[0].options[0]).toBe('numerator');
    expect(r.questions[0].question).toMatch(/^fraction /);
    const qs2 = urEight(); qs2[0].options = ['ریکٹینگل کا ایریا', 'پتا', 'پھول']; qs2[0].explanation = 'ٹائپس دیکھیں';
    expect(V.validate(qs2, urCtx).errors.some((e) => /transliterated English term/.test(e))).toBe(true);
  });

  test('an Urdu stem or feedback that opens with an English word is rejected; an English option is fine', () => {
    const qs = urEight(); qs[0].question = 'fraction میں اوپر والے نمبر کو کیا کہتے ہیں؟';
    expect(V.validate(qs, urCtx).errors.some((e) => /starts with an English word/.test(e))).toBe(true);
    const qs2 = urEight(); qs2[0].question = 'ایک fraction میں اوپر والے نمبر کو کیا کہتے ہیں؟'; qs2[0].options = ['numerator', 'پتا', 'پھول'];
    expect(V.validate(qs2, urCtx).errors.some((e) => /starts with an English word/.test(e))).toBe(false);
  });

  test('feminine-stem address is rejected', () => {
    const qs = urEight(); qs[0].option_feedback.correct = 'آپ سمجھ سکتی ہیں کہ جڑ نیچے ہوتی ہے۔';
    expect(V.validate(qs, urCtx).errors.some((e) => /feminine-stem/.test(e))).toBe(true);
  });

  test('Islamiyat: a Prophet mention without ﷺ fails; with it passes', () => {
    const isl = { ...urCtx, subject: 'islamiat' };
    const qs = urEight(); qs[0].question = 'نبی کریم کس شہر میں پیدا ہوئے؟';
    expect(V.validate(qs, isl).errors.some((e) => /prophet mention without/.test(e))).toBe(true);
    qs[0].question = 'نبی کریم ﷺ کس شہر میں پیدا ہوئے؟';
    expect(V.validate(qs, isl).errors.some((e) => /prophet mention without/.test(e))).toBe(false);
  });
});

describe('normaliseFeedback — the shapes models actually emit', () => {
  test('flat {"correct","1","2"} is lifted into wrong:{}', () => {
    const n = V.normaliseFeedback({ correct_index: 0, option_feedback: { correct: 'c', 1: 'w1', 2: 'w2' } });
    expect(n.option_feedback).toEqual({ correct: 'c', wrong: { 1: 'w1', 2: 'w2' } });
  });

  test('a list of {index,text} or two strings becomes keyed by the wrong indices', () => {
    const a = V.normaliseFeedback({ correct_index: 1, option_feedback: { correct: 'c', wrong: [{ index: 0, text: 'w0' }, { index: 2, text: 'w2' }] } });
    expect(a.option_feedback.wrong).toEqual({ 0: 'w0', 2: 'w2' });
    const b = V.normaliseFeedback({ correct_index: 1, option_feedback: { correct: 'c', wrong: ['w0', 'w2'] } });
    expect(b.option_feedback.wrong).toEqual({ 0: 'w0', 2: 'w2' });
  });

  test('numeric keys are stringified', () => {
    const n = V.normaliseFeedback({ correct_index: 0, option_feedback: { correct: 'c', wrong: { 1: 'a', 2: 'b' } } });
    expect(Object.keys(n.option_feedback.wrong)).toEqual(['1', '2']);
  });
});
