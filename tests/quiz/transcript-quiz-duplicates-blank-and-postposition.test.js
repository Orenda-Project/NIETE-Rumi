'use strict';
/**
 * A fill-in-the-blank and a question on the same fact are the same question.
 *
 * Live, an Urdu quiz on a folk tale asked
 *
 *   Q4  «جام تماچی نے نوری سے شادی کی اور مچھیروں کو __________ سے نوازا۔»   key «انعام و اکرام»
 *   Q8  «جام تماچی نے نوری سے شادی کے بعد مچھیروں کو کس چیز سے نوازا؟»    key «انعام و اکرام سے»
 *
 * — one fact, asked twice. The repeat check missed it twice over: the two
 * answers differ by the trailing postposition «سے», and one stem is a sentence
 * with a blank while the other is a question, so their words never lined up.
 *
 * Now an Urdu answer is compared without a trailing postposition (سے، کو، میں،
 * پر، کا، کی، کے، نے) or punctuation — unless the question is ABOUT the
 * postposition, which shows as two of its own options becoming the same
 * («میز پر» / «میز میں»). And a sentence with a blank is compared with a
 * question by filling the blank with its answer, then comparing the content
 * words of each: the filled sentence against the question and its answer.
 *
 * Fixtures are synthetic apart from the live pair, which is a public folk tale.
 * The validator runs for real.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const { duplicateQuestionErrors } = require('../../bot/shared/services/quiz/transcript-quiz-duplicates');

const dupes = (errs) => errs.filter((e) => /DUPLICATE_QUESTION/.test(e));

const DIGEST = {
  topic: 'نوری جام تماچی', topic_as_taught: 'نوری جام تماچی', subject: 'urdu', grade_band: '3-5',
  slos: [
    { id: 'S1', statement: 'کہانی کے کرداروں اور واقعات کو پہچاننا', statement_en: 'recognise the characters and events of the story', taught_level: 'understand' },
    { id: 'S2', statement: 'کہانی کا سبق سمجھنا', statement_en: 'understand the lesson of the story', taught_level: 'understand' },
  ],
  key_terms: [], examples_used: [], misconceptions_surfaced: [],
};
const CTX = {
  language: 'ur', subject: 'urdu', digest: DIGEST, nExpected: 8, gradeBand: '3-5',
  lessonSummary: 'آج کے سبق میں نوری اور جام تماچی کی کہانی پڑھی گئی اور اس کا سبق سمجھا گیا۔',
};
const uq = ({ slo = 'S1', level = 'recall', question, options, correct = 0 }) => {
  const wrong = [0, 1, 2].filter((k) => k !== correct);
  return {
    slo_id: slo, level, question, options, correct_index: correct,
    selected_because: 'کہانی کے اس حصے پر کلاس میں بات ہوئی',
    distractor_misconceptions: { [wrong[0]]: 'کہانی کا دوسرا واقعہ یاد رکھنا', [wrong[1]]: 'کرداروں کو آپس میں ملا دینا' },
    explanation: 'کہانی میں یہی بات بتائی گئی ہے۔',
    option_feedback: { correct: 'بالکل درست! کہانی میں یہی ہوا۔', wrong: { [wrong[0]]: 'کہانی دوبارہ یاد کریں، یہ بات نہیں ہوئی۔', [wrong[1]]: 'یہ کسی اور حصے کی بات ہے۔' } },
  };
};
function folkTale() {
  return [
    uq({ question: 'نوری کا تعلق کس برادری سے تھا؟', options: ['مچھیروں کی برادری', 'کسانوں کی برادری', 'تاجروں کی برادری'] }),
    uq({ level: 'understand', question: 'جام تماچی کون تھا؟', options: ['ایک بادشاہ', 'ایک مچھیرا', 'ایک سپاہی'] }),
    uq({ question: 'جام تماچی نے نوری کو پہلی بار کہاں دیکھا؟', options: ['جھیل کے کنارے', 'بازار کے بیچ', 'محل کے اندر'] }),
    // Q4 of the live quiz
    uq({ question: 'جام تماچی نے نوری سے شادی کی اور مچھیروں کو __________ سے نوازا۔', options: ['انعام و اکرام', 'سخت سزا', 'نئی کشتیوں'] }),
    uq({ slo: 'S2', level: 'understand', question: 'نوری کی کون سی خوبی جام تماچی کو سب سے زیادہ پسند آئی؟', options: ['سادگی', 'دولت', 'غرور'] }),
    uq({ slo: 'S2', level: 'understand', question: 'اس کہانی سے کیا سبق ملتا ہے؟', options: ['سادگی اور عاجزی کی قدر ہوتی ہے', 'دولت سب سے اہم ہوتی ہے', 'غرور اچھی عادت ہے'] }),
    uq({ level: 'understand', question: 'محل میں رہ کر بھی نوری کیسے کپڑے پہنتی تھی؟', options: ['سادہ کپڑے', 'ریشمی کپڑے', 'سنہری کپڑے'] }),
    // Q8 of the live quiz: the same fact as a question, its answer with a trailing «سے»
    uq({ question: 'جام تماچی نے نوری سے شادی کے بعد مچھیروں کو کس چیز سے نوازا؟', options: ['انعام و اکرام سے', 'سخت سزا سے', 'بھاری ٹیکس سے'] }),
  ];
}

describe('the live pair: a blank and a question on one fact, answers apart by «سے»', () => {
  test('the validator names q7 as asking what q3 asks — and nothing else about the quiz is wrong', () => {
    const errs = validate(folkTale(), CTX).errors;
    expect(dupes(errs)).toEqual([expect.stringMatching(/^q7: DUPLICATE_QUESTION — asks what q3 already asks/)]);
    expect(errs.filter((e) => !/DUPLICATE_QUESTION/.test(e))).toEqual([]);
  });

  test('the targeted rewrite takes q7 alone', () => {
    const errs = validate(folkTale(), CTX).errors.filter((e) => /DUPLICATE_QUESTION/.test(e));
    expect(Rewrite.rewriteTargets(errs).indices).toEqual([7]);
  });

  test('either order: the question first and the blank second is the same repeat', () => {
    const qs = folkTale();
    [qs[3], qs[7]] = [qs[7], qs[3]];
    expect(dupes(validate(qs, CTX).errors)).toEqual([expect.stringMatching(/^q7: DUPLICATE_QUESTION — asks what q3 /)]);
  });
});

test('a blank written as the word «ڈیش», and the question on the same line of the story', () => {
  const blank = { question: 'بلی نے دودھ پیا اور پھر وہ ڈیش میں سو گئی۔', options: ['ٹوکری', 'چھت', 'باغ'], correct_index: 0 };
  const question = { question: 'دودھ پینے کے بعد بلی کہاں سو گئی؟', options: ['ٹوکری میں', 'چھت پر', 'باغ میں'], correct_index: 0 };
  expect(duplicateQuestionErrors([blank, question])).toEqual([expect.stringMatching(/^q1: DUPLICATE_QUESTION — asks what q0 /)]);
});

describe('what stays two questions', () => {
  test('the same sentence, another blank: a different answer is a different question', () => {
    const qs = folkTale();
    qs[3] = uq({ question: 'جام تماچی نے __________ سے شادی کی اور مچھیروں کو انعام و اکرام سے نوازا۔', options: ['نوری', 'سسی', 'ماروی'] });
    expect(dupes(validate(qs, CTX).errors)).toEqual([]);
  });

  test('the same answer once «میں» is gone, on another fact: a blank about where Noori lived, a question about where the boat sailed', () => {
    const qs = [
      uq({ question: 'نوری __________ کے کنارے ایک جھونپڑی میں رہتی تھی۔', options: ['جھیل', 'دریا', 'پہاڑ'] }),
      uq({ question: 'جام تماچی کی کشتی کس جگہ چلتی تھی؟', options: ['جھیل میں', 'دریا میں', 'سمندر میں'] }),
    ];
    expect(duplicateQuestionErrors(qs)).toEqual([]);
  });

  test('a question ABOUT the postposition keeps it: «میز پر» and «میز میں» are two answers', () => {
    const on = { question: 'کتاب __________ رکھی ہے۔ اوپر رکھنے کے لیے کون سا لفظ آئے گا؟', options: ['میز پر', 'میز میں', 'میز سے'], correct_index: 0 };
    const inside = { question: 'کتاب __________ رکھی ہے۔ اندر رکھنے کے لیے کون سا لفظ آئے گا؟', options: ['میز پر', 'میز میں', 'میز سے'], correct_index: 1 };
    expect(duplicateQuestionErrors([on, inside])).toEqual([]);
  });

  test('an answer that is a list of postpositions is not cut to its first one', () => {
    const S = "'علی کا بستہ، زینب کی کتاب، بچوں کے کھلونے'";
    const all = { question: `جملہ ${S} میں کون کون سے حروف اضافت ہیں؟`, options: ['کا، کی، کے', 'بستہ، کتاب', 'علی، زینب'], correct_index: 0 };
    const first = { question: `جملہ ${S} میں سب سے پہلے کون سا حرف اضافت ہے؟`, options: ['کا', 'بستہ', 'علی'], correct_index: 0 };
    expect(duplicateQuestionErrors([all, first])).toEqual([]);
  });

  test('a one-word answer that IS a postposition is never emptied', () => {
    const a = { question: 'احمد __________ کتاب پڑھی۔ خالی جگہ میں کیا آئے گا؟', options: ['نے', 'کو', 'سے'], correct_index: 0 };
    const b = { question: 'علی __________ خط لکھا۔ خالی جگہ میں کیا آئے گا؟', options: ['کو', 'نے', 'سے'], correct_index: 1 };
    expect(duplicateQuestionErrors([a, b])).toEqual([]);
  });
});
