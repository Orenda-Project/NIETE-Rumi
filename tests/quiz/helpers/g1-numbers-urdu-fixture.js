'use strict';
/**
 * A grade 1 maths lesson on the numbers 0 to 4, quizzed in Urdu from its lesson
 * PLAN (quiz_source lp_v8) — the shape of the sandbox quiz that ended
 * `failed / validator_failed` after three attempts on 24 Sep 2026.
 *
 * Everything here is synthetic (this repo is public). What it carries from the
 * real case is the SHAPE of the faults its attempt log recorded:
 *   - one car under "how many cars?" and an empty set under "how many
 *     counters?" — the lesson's own content (count 1, count 0), refused by the
 *     drawing engine's old floor of 2 (FIGURE_RENDER);
 *   - `selected_because` written in English on an Urdu quiz
 *     (URDU_TEACHER_FIELDS), on the author's draft AND on every replacement the
 *     targeted rewrite wrote;
 *   - verbs that speak to the child as a boy («آپ … گنتے ہیں», «… لکھیں گے») in
 *     the stem, the explanation and the feedback (PEDAGOGY_GENDERED_CHILD).
 *
 * `eight()` is a clean set: it passes the real validator as it stands, figure
 * counts 1 and 0 aside. The helpers below derive the recorded bad drafts from it.
 */

const DIGEST = {
  topic: 'Numbers 0 to 4', topic_as_taught: 'اعداد 0 سے 4', subject: 'maths', grade_band: '1',
  language_of_instruction: 'ur', confidence: 0.9, taught_level: 'understand',
  slos: [
    { id: 'S1', statement: 'count objects up to 4, one touch for each', statement_en: 'count objects up to 4, one touch for each', statement_ur: 'چیزوں کو ایک ایک کر کے 4 تک گننا', taught_level: 'understand' },
    { id: 'S2', statement: 'know that zero means no things at all', statement_en: 'know that zero means no things at all', statement_ur: 'صفر کا مطلب ہے کوئی چیز نہیں', taught_level: 'understand' },
    { id: 'S3', statement: 'read and write the numerals 0 to 4', statement_en: 'read and write the numerals 0 to 4', statement_ur: 'اعداد 0 سے 4 پڑھنا اور لکھنا', taught_level: 'recall' },
  ],
  key_terms: [{ term: 'zero', as_spoken: 'صفر' }, { term: 'count', as_spoken: 'گننا' }],
  examples_used: ['one car', 'an empty circle', 'three flowers'],
  misconceptions_surfaced: ['counts the same thing twice'],
};

const SUMMARY = 'آج کے سبق میں بچوں نے چیزوں کو ایک ایک کر کے 4 تک گنا، خالی دائرے سے صفر کو سمجھا اور اعداد 0 سے 4 لکھے۔';

/** A lesson PLAN for the numbers 0 to 4 (slide-script shape, synthetic). */
const SLIDE_SCRIPT = {
  meta: { lessonId: 'grade_1_maths_ch1_seg1', grade: 1, subject: 'maths', topic: 'Numbers 0 to 4', isUrdu: true },
  goal: 'Count quantities from 0 to 4 with one touch for each object.',
  sloFull: 'Children count objects up to 4 and know that zero means no things.',
  bloom: 'understand',
  hook: { board: { content: '0 stars · 1 car · 2 birds · 3 flowers · 4 stars' } },
  iDo: {
    keyFact: 'The last count word tells how many; an empty set is zero, written 0.',
    worked: { problem: 'How many cars? Count and write the numeral.', work: ['Touch the car once: one', 'No more cars'], answer: '1 car', diagram: 'cars: [car]' },
    cfu: 'Why is the empty circle zero and not one?',
    steps: [{ n: 1, say: 'My circle has no counters, so there is nothing to touch: zero.', action: 'Draw an empty circle.' }],
  },
  weDo: { action: 'Count three flowers together, one touch each.', cfu: 'How many flowers?' },
  youDo: { problems: [{ n: 1, prompt: 'Count the stars and write the numeral.', answer: '4' }] },
};

function q(over) {
  return {
    slo_id: 'S1', level: 'understand', correct_index: 0,
    explanation: 'ہر چیز کو ایک بار چھو کر گنا جائے تو آخری عدد بتاتا ہے کہ کتنی چیزیں ہیں۔',
    selected_because: 'سبق میں بچوں نے چیزیں ایک ایک کر کے گنیں',
    distractor_misconceptions: { 1: 'ایک چیز کو دو بار گن لینا', 2: 'ایک چیز کو گننا بھول جانا' },
    option_feedback: {
      correct: 'بہت خوب! ہر چیز ایک بار گنی گئی، اس لیے یہی درست عدد ہے۔',
      wrong: { 1: 'شاید آپ نے ایک چیز دو بار گن لی۔ ہر چیز کو ایک ہی بار چھوئیں۔', 2: 'شاید ایک چیز گننے سے رہ گئی۔ ہر چیز کو ایک ایک کر کے گنیں۔' },
    },
    figure: null,
    ...over,
  };
}

/** The clean set. q1 draws ONE car, q4 an EMPTY set — the lesson's own 1 and 0. */
function eight() {
  return [
    q({ slo_id: 'S3', level: 'recall', question: 'چار کو عدد میں کیسے لکھا جاتا ہے؟', options: ['4', '3', '5'],
      explanation: 'چار کا عدد 4 لکھا جاتا ہے۔', selected_because: 'سبق میں تختے پر اعداد 0 سے 4 لکھے گئے',
      distractor_misconceptions: { 1: 'تین اور چار کے عدد میں الجھن', 2: 'چار کے بعد والا عدد چن لینا' } }),
    q({ question: 'تصویر میں کتنی کاریں ہیں؟', options: ['1', '2', '0'],
      figure: { type: 'count_objects', picto: 'car', count: 1 }, selected_because: 'سبق کی مثال میں ایک کار گنی گئی' }),
    q({ question: 'تصویر میں کتنے پھول ہیں؟', options: ['3', '2', '4'],
      figure: { type: 'count_objects', picto: 'flower', count: 3 }, selected_because: 'بچوں نے مل کر تین پھول گنے' }),
    q({ question: 'گنتی میں آخری بولا گیا عدد کیا بتاتا ہے؟', options: ['کل کتنی چیزیں ہیں', 'پہلی چیز کون سی ہے', 'سب سے بڑی چیز کون سی ہے'],
      explanation: 'گنتی کا آخری عدد بتاتا ہے کہ کل کتنی چیزیں ہیں۔', selected_because: 'سبق کا اہم نکتہ: آخری عدد مقدار بتاتا ہے' }),
    q({ slo_id: 'S2', question: 'ڈبے میں کتنے counter ہیں؟', options: ['0', '1', '2'],
      figure: { type: 'count_objects', picto: 'counter', count: 0 },
      explanation: 'ڈبہ خالی ہے، اس میں کوئی counter نہیں، اس لیے جواب 0 ہے۔', selected_because: 'سبق میں خالی دائرے سے صفر سمجھایا گیا',
      distractor_misconceptions: { 1: 'ڈبے کو بھی ایک چیز گن لینا', 2: 'اندازے سے عدد بتا دینا' } }),
    q({ slo_id: 'S2', level: 'recall', question: 'صفر کا مطلب کیا ہے؟', options: ['کوئی چیز نہیں', 'ایک چیز', 'بہت سی چیزیں'],
      explanation: 'صفر کا مطلب ہے کہ کوئی چیز موجود نہیں۔', selected_because: 'سبق میں صفر کا مطلب سمجھایا گیا',
      distractor_misconceptions: { 1: 'صفر کو ایک سمجھنا', 2: 'صفر کو بڑا عدد سمجھنا' } }),
    q({ slo_id: 'S3', level: 'recall', question: 'تین کے بعد کون سا عدد آتا ہے؟', options: ['4', '2', '5'],
      explanation: 'گنتی میں تین کے بعد چار آتا ہے: 1، 2، 3، 4۔', selected_because: 'بچوں نے 0 سے 4 تک گنتی دہرائی',
      distractor_misconceptions: { 1: 'تین سے پہلے والا عدد چن لینا', 2: 'ایک عدد چھوڑ دینا' } }),
    q({ question: 'چیزیں گنتے وقت ہر چیز کو کتنی بار چھونا چاہیے؟', options: ['ایک بار', 'دو بار', 'ایک بار بھی نہیں'],
      explanation: 'ہر چیز کو ایک ہی بار چھونا چاہیے تاکہ کوئی چیز دو بار نہ گنی جائے۔', selected_because: 'سبق میں ایک چیز، ایک چھونا سکھایا گیا',
      distractor_misconceptions: { 1: 'ایک چیز کو دو بار گن لینا', 2: 'چھوئے بغیر اندازہ لگانا' } }),
  ];
}

/** The English teacher notes the recorded drafts carried (synthetic wording). */
const ENGLISH_WHY = [
  "the lesson's focus on writing the numerals",
  'the car example used for counting',
  'three flowers counted together in class',
  'the last count word tells the quantity',
  'zero represents an empty set',
  'the meaning of zero in the lesson',
  'counting on from three to four',
  'one-to-one correspondence application',
];

/** Every `selected_because` in English, as the author wrote it on each recorded attempt. */
function withEnglishWhy(qs, indices = null) {
  return qs.map((x, i) => ((indices === null || indices.includes(i)) ? { ...x, selected_because: ENGLISH_WHY[i] } : x));
}

/**
 * q5 speaks to the child as a boy in its stem, explanation and feedback —
 * «آپ … گنتے ہیں», «… لکھیں گے» — the recorded habit.
 */
function gendered(x) {
  return {
    ...x,
    question: 'جب آپ صفر گنتے ہیں تو آپ کیا لکھیں گے؟',
    options: ['کوئی چیز نہیں', 'ایک چیز', 'بہت سی چیزیں'],
    explanation: 'جب آپ صفر چیزیں گنتے ہیں تو آپ جانتے ہیں کہ کوئی چیز نہیں۔',
    option_feedback: {
      correct: 'بہت خوب! آپ سمجھ گئے ہیں کہ صفر کا مطلب کوئی چیز نہیں۔',
      wrong: { 1: 'شاید آپ نے صفر کو ایک سمجھا۔ صفر کا مطلب کوئی چیز نہیں۔', 2: 'شاید آپ نے صفر کو بڑا عدد سمجھا۔ صفر کا مطلب کوئی چیز نہیں۔' },
    },
  };
}

/** The same question with its gendered verbs made neutral — what an in-place repair returns. */
function neutral(x) {
  return {
    ...x,
    question: 'صفر گننے پر کیا لکھنا چاہیے؟',
    options: ['کوئی چیز نہیں', 'ایک چیز', 'بہت سی چیزیں'],
    explanation: 'صفر چیزوں کا مطلب ہے کہ کوئی چیز نہیں۔',
    option_feedback: {
      correct: 'بہت خوب! صفر کا مطلب کوئی چیز نہیں۔',
      wrong: { 1: 'شاید آپ نے صفر کو ایک سمجھا۔ صفر کا مطلب کوئی چیز نہیں۔', 2: 'شاید آپ نے صفر کو بڑا عدد سمجھا۔ صفر کا مطلب کوئی چیز نہیں۔' },
    },
  };
}

module.exports = {
  DIGEST, SUMMARY, SLIDE_SCRIPT, eight, withEnglishWhy, gendered, neutral, ENGLISH_WHY,
};
