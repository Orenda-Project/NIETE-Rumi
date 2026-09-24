'use strict';
/**
 * A Proper Fraction lesson whose quiz, on staging, shipped a WRONG key that the
 * blind solve agreed with.
 *
 *   index 6: «ان میں سے کون سا Proper Fraction نہیں ہے؟» — 1/4 · 4/8 · 2/5, keyed
 *   4/8. All three are proper fractions (each numerator is smaller than its
 *   denominator), so the question has no right answer. The item's own
 *   explanation says so and then sides with the class: «… 4، 8 سے چھوٹا ہے،
 *   لیکن استاد نے کلاس میں 4/8 کو Proper Fraction نہیں مانا تھا». The author
 *   followed a mistake made in class against the fact it states; the solver,
 *   which was shown a lesson summary repeating that mistake, agreed.
 *
 * The live item is verbatim (quiz content, not the recording). Five others are
 * the live quiz's text items, two of them lightly edited; two are written for
 * this fixture, as is the summary (this repo is public) — which, like the live
 * one, repeats the class's mistake.
 */

const TARGET_STEM = 'ان میں سے کون سا Proper Fraction نہیں ہے؟';
const TARGET_OPTIONS = ['$\\frac{1}{4}$', '$\\frac{4}{8}$', '$\\frac{2}{5}$'];
const TARGET_KEY = '$\\frac{4}{8}$';
const TARGET_INDEX = 6;
/** The live explanation, verbatim: the fact, then the class set against it. */
const TARGET_EXPLANATION = '‏Proper Fraction میں numerator denominator سے چھوٹا ہوتا ہے۔ $\\frac{4}{8}$ میں 4، 8 سے چھوٹا ہے، لیکن استاد نے کلاس میں 4/8 کو Proper Fraction نہیں مانا تھا۔';

const DIGEST = {
  topic: 'Proper Fraction',
  topic_as_taught: 'Proper Fraction',
  subject: 'maths',
  grade_band: '3-5',
  language_of_instruction: 'ur',
  confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'fraction کی تعریف بیان کر سکیں', statement_en: 'Recall the definition of a Fraction', statement_ur: 'fraction کی تعریف بیان کر سکیں', evidence_quote: 'fraction', taught_level: 'recall' },
    { id: 'S2', statement: 'fraction میں numerator اور denominator کی شناخت کر سکیں', statement_en: 'Identify the numerator and denominator in a Fraction', statement_ur: 'fraction میں numerator اور denominator کی شناخت کر سکیں', evidence_quote: 'numerator', taught_level: 'recall' },
    { id: 'S3', statement: 'Proper Fraction کی تعریف بیان کر سکیں', statement_en: 'Recall the definition of a Proper Fraction', statement_ur: 'Proper Fraction کی تعریف بیان کر سکیں', evidence_quote: 'proper fraction', taught_level: 'recall' },
    { id: 'S4', statement: 'دی گئی مثالوں سے Proper Fraction کی شناخت کر سکیں', statement_en: 'Identify Proper Fractions from given examples', statement_ur: 'دی گئی مثالوں سے Proper Fraction کی شناخت کر سکیں', evidence_quote: 'proper fraction', taught_level: 'apply' },
  ],
  key_terms: [{ term: 'numerator', as_spoken: 'numerator' }, { term: 'denominator', as_spoken: 'denominator' }, { term: 'Proper Fraction', as_spoken: 'proper fraction' }],
  examples_used: ['A circle divided into 4 parts, with one part colored.', 'Numerical examples: 3/7, 7/3, 3/3, 4/8.'],
  misconceptions_surfaced: ['A student suggested 3/3 is a Proper Fraction.'],
};

function item(slo, level, question, options, correctIndex, explanation, correct, wrong, misc) {
  return {
    slo_id: slo,
    level,
    question,
    options,
    correct_index: correctIndex,
    explanation,
    selected_because: 'یہ سوال سبق میں Proper Fraction کی پہچان والے حصے سے لیا گیا',
    distractor_misconceptions: misc,
    option_feedback: { correct, wrong },
  };
}

const AUTHORED = [
  item('S1', 'recall', 'ایک fraction کیا ہوتا ہے؟',
    ['ایک شکل (shape) کا نام', 'کسی چیز کے حصوں کو دکھانے کا طریقہ', 'ایک نمبر جو ہمیشہ 10 سے بڑا ہو'], 1,
    '‏fraction کسی پوری چیز کے حصوں کو دکھانے کا طریقہ ہے، جیسا کہ کلاس میں دائرے کے حصوں سے سمجھایا گیا تھا۔',
    'بالکل ٹھیک! fraction کسی پوری چیز کے حصوں کو دکھانے کا طریقہ ہوتا ہے، جیسے آپ نے دائرے کے حصے دیکھ کر سمجھا تھا۔',
    { 0: 'آپ نے شاید fraction کو ایک شکل (shape) سمجھا، لیکن fraction کسی چیز کے حصوں کو دکھانے کے لیے استعمال ہوتا ہے، جیسے آپ نے دائرے کے حصے دیکھے تھے۔', 2: '‏fraction صرف بڑے نمبروں کے لیے نہیں ہوتا۔ یہ کسی بھی چیز کے حصوں کو دکھا سکتا ہے، چاہے وہ چھوٹی ہو یا بڑی۔' },
    { 0: 'fraction کو ایک shape سمجھنا', 2: 'fraction کو صرف بڑے نمبروں سے جوڑنا' }),
  item('S2', 'recall', 'ایک fraction $\\frac{2}{7}$ میں، اوپر والے نمبر 2 کو کیا کہتے ہیں؟',
    ['denominator', 'whole number', 'numerator'], 2,
    '‏fraction میں اوپر والے نمبر کو numerator کہتے ہیں، جیسا کہ کلاس میں بتایا گیا تھا۔',
    'صحیح جواب! fraction میں اوپر والے نمبر کو numerator کہتے ہیں۔',
    { 0: '‏denominator نیچے والا نمبر ہوتا ہے۔ اوپر والے نمبر کو numerator کہتے ہیں، جیسا کہ آپ نے کلاس میں سیکھا تھا۔', 1: '‏whole number ایک پورا نمبر ہوتا ہے، جبکہ numerator کسی fraction کا اوپر والا حصہ ہوتا ہے۔' },
    { 0: 'numerator اور denominator میں فرق نہ سمجھنا', 1: 'fraction کے حصے کو whole number سمجھنا' }),
  item('S2', 'recall', 'ایک fraction $\\frac{2}{7}$ میں، نیچے والے نمبر 7 کو کیا کہتے ہیں؟',
    ['numerator', 'denominator', 'part'], 1,
    '‏fraction میں نیچے والے نمبر کو denominator کہتے ہیں، جیسا کہ کلاس میں بتایا گیا تھا۔',
    'بالکل ٹھیک! fraction میں نیچے والے نمبر کو denominator کہتے ہیں۔',
    { 0: '‏numerator اوپر والا نمبر ہوتا ہے۔ نیچے والے نمبر کو denominator کہتے ہیں، جیسا کہ آپ نے کلاس میں سیکھا تھا۔', 2: '‏denominator بتاتا ہے کہ پوری چیز کے کتنے برابر حصے کیے گئے ہیں، یہ صرف ایک حصہ نہیں ہوتا۔' },
    { 0: 'numerator اور denominator میں فرق نہ سمجھنا', 2: 'denominator کو صرف ایک حصہ سمجھنا' }),
  item('S3', 'recall', '‏Proper Fraction کی کیا پہچان ہے؟',
    ['اس کا numerator اور denominator برابر ہوتے ہیں', 'اس کا numerator بڑا اور denominator چھوٹا ہوتا ہے', 'اس کا numerator چھوٹا اور denominator بڑا ہوتا ہے'], 2,
    '‏Proper Fraction وہ ہوتا ہے جس کا numerator (اوپر والا نمبر) denominator (نیچے والے نمبر) سے چھوٹا ہو، جیسا کہ کلاس میں بتایا گیا تھا۔',
    'صحیح جواب! Proper Fraction میں اوپر والا نمبر ہمیشہ نیچے والے نمبر سے چھوٹا ہوتا ہے۔',
    { 0: 'جب numerator اور denominator برابر ہوں تو وہ Proper Fraction نہیں ہوتا، جیسے 3/3۔ Proper Fraction میں اوپر والا نمبر چھوٹا ہوتا ہے۔', 1: 'یہ Improper Fraction کی پہچان ہے۔ Proper Fraction میں اوپر والا نمبر ہمیشہ نیچے والے نمبر سے چھوٹا ہوتا ہے۔' },
    { 0: 'Proper Fraction کو برابر حصوں والا سمجھنا', 1: 'Proper Fraction کی تعریف کو الٹا سمجھنا' }),
  item('S3', 'understand', 'ایک fraction میں اوپر والا نمبر 5 اور نیچے والا نمبر 9 ہے۔ یہ کس قسم کا fraction ہے؟',
    ['Improper Fraction', 'Proper Fraction', 'پورا نمبر'], 1,
    'جب اوپر والا نمبر نیچے والے نمبر سے چھوٹا ہو تو fraction کو Proper Fraction کہتے ہیں، اور 5، 9 سے چھوٹا ہے۔',
    'بالکل ٹھیک! 5، 9 سے چھوٹا ہے، اس لیے یہ Proper Fraction ہے۔',
    { 0: 'اوپر والا نمبر بڑا ہو تو Improper Fraction ہوتا ہے، مگر یہاں 5، 9 سے چھوٹا ہے۔', 2: 'پورا نمبر کسی چیز کے حصے نہیں دکھاتا۔ یہاں 9 میں سے 5 حصے ہیں، اس لیے یہ Proper Fraction ہے۔' },
    { 0: 'بڑے اور چھوٹے نمبر کی جگہ الٹ دینا', 2: 'fraction کو پورا نمبر سمجھنا' }),
  item('S4', 'apply', 'ان میں سے کون سا Proper Fraction ہے؟',
    ['$\\frac{3}{7}$', '$\\frac{7}{3}$', '$\\frac{3}{3}$'], 0,
    '‏Proper Fraction وہ ہوتا ہے جس میں numerator کی قیمت denominator سے کم ہو، اور $\\frac{3}{7}$ میں 3، 7 سے چھوٹا ہے۔',
    'صحیح جواب! $\\frac{3}{7}$ ایک Proper Fraction ہے کیونکہ اس کا numerator (3) denominator (7) سے چھوٹا ہے۔',
    { 1: 'یہ Proper Fraction نہیں ہے کیونکہ اس کا numerator (7) denominator (3) سے بڑا ہے۔ Proper Fraction میں numerator چھوٹا ہوتا ہے۔', 2: 'جب numerator اور denominator برابر ہوں، جیسے $\\frac{3}{3}$ میں، تو وہ Proper Fraction نہیں ہوتا۔ Proper Fraction میں numerator چھوٹا ہوتا ہے۔' },
    { 1: 'numerator کو denominator سے بڑا سمجھنا', 2: 'برابر numerator اور denominator کو Proper Fraction سمجھنا' }),
  // THE LIVE ITEM, verbatim.
  item('S4', 'apply', TARGET_STEM, TARGET_OPTIONS, 1,
    TARGET_EXPLANATION,
    'صحیح جواب! کلاس میں استاد نے بتایا تھا کہ $\\frac{4}{8}$ Proper Fraction نہیں ہے۔',
    { 0: 'یہ ایک Proper Fraction ہے کیونکہ اس کا numerator (1) denominator (4) سے چھوٹا ہے۔', 2: 'یہ ایک Proper Fraction ہے کیونکہ اس کا numerator (2) denominator (5) سے چھوٹا ہے۔' },
    { 0: 'Proper Fraction کی بنیادی تعریف کو نظر انداز کرنا', 2: 'Proper Fraction کی بنیادی تعریف کو نظر انداز کرنا' }),
  item('S4', 'apply', 'ان میں سے کون سا عدد Proper Fraction نہیں ہے؟',
    ['$\\frac{2}{9}$', '$\\frac{9}{4}$', '$\\frac{1}{3}$'], 1,
    '‏Proper Fraction میں numerator کی قیمت denominator سے کم ہوتی ہے، مگر $\\frac{9}{4}$ میں 9، 4 سے بڑا ہے۔',
    'صحیح جواب! $\\frac{9}{4}$ میں اوپر والا نمبر بڑا ہے، اس لیے یہ Proper Fraction نہیں ہے۔',
    { 0: 'یہ Proper Fraction ہے کیونکہ 2، 9 سے چھوٹا ہے۔', 2: 'یہ Proper Fraction ہے کیونکہ 1، 3 سے چھوٹا ہے۔' },
    { 0: 'چھوٹے نمبروں کو Improper سمجھنا', 2: 'ایک کو الگ قسم کا نمبر سمجھنا' }),
];

/**
 * The same live question with an explanation that no longer admits anything:
 * what the blind solve has to catch on its own when the explanation is silent.
 */
const TARGET_SILENT = {
  ...AUTHORED[TARGET_INDEX],
  explanation: '‏$\\frac{4}{8}$ Proper Fraction نہیں ہے۔',
  option_feedback: {
    correct: 'صحیح جواب! $\\frac{4}{8}$ Proper Fraction نہیں ہے۔',
    wrong: AUTHORED[TARGET_INDEX].option_feedback.wrong,
  },
};

/** The targeted rewrite's answer for index 6: a question that is right by the subject. */
const TARGET_FIXED = {
  index: TARGET_INDEX,
  ...item('S4', 'apply', TARGET_STEM, ['$\\frac{1}{4}$', '$\\frac{5}{3}$', '$\\frac{2}{5}$'], 1,
    '‏$\\frac{5}{3}$ میں numerator کی قیمت denominator سے زیادہ ہے، اس لیے یہ Proper Fraction نہیں ہے۔',
    'صحیح جواب! $\\frac{5}{3}$ میں اوپر والا نمبر بڑا ہے، اس لیے یہ Proper Fraction نہیں ہے۔',
    { 0: 'یہ Proper Fraction ہے کیونکہ 1، 4 سے چھوٹا ہے۔', 2: 'یہ Proper Fraction ہے کیونکہ 2، 5 سے چھوٹا ہے۔' },
    { 0: 'چھوٹے نمبروں کو Improper سمجھنا', 2: 'Proper Fraction کی تعریف الٹ دینا' }),
};

/** Written for this fixture. Like the live summary, it repeats the class's mistake about 4/8. */
const LESSON_SUMMARY = 'آج آپ نے بچوں کو Proper Fraction پڑھایا اور بتایا کہ جس fraction میں numerator کی قیمت denominator سے کم ہو وہ Proper Fraction ہوتا ہے۔ آپ نے 3/3 اور 4/8 کی مثالیں دے کر کہا کہ یہ Proper Fraction نہیں ہیں۔';

module.exports = {
  TARGET_STEM, TARGET_OPTIONS, TARGET_KEY, TARGET_INDEX, TARGET_EXPLANATION,
  DIGEST, AUTHORED, TARGET_SILENT, TARGET_FIXED, LESSON_SUMMARY,
};
