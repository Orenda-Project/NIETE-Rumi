'use strict';
/**
 * The Grade 3 Urdu singular/plural lesson (واحد اور جمع) whose LP-born quiz, on
 * sandbox, keyed the lesson's OWN planted misconception as the correct answer.
 *
 * The slide script is synthetic (this repo is public) but carries, verbatim, the
 * three places the served lesson says بہار → بہاریں: the vocabulary definition,
 * the We-Do check that plants the misconception («احمد کہتا ہے…»), and the
 * homework answer. The eight questions are what the author returned, item 7
 * (index 6) keyed to «اس کی شکل نہیں بدلے گی» — "its form will not change".
 */

const LESSON_ID = 'grade_3_urdu_ch5_seg5';

const VOCAB_DEF = "بعض الفاظ کے آخر میں 'یں' لگانے سے جمع بنتی ہے، جیسے کتاب سے کتابیں، بہار سے بہاریں۔";
const PLANTED_CFU = "احمد کہتا ہے کہ 'بہار' کی جمع 'بہار' ہی رہے گی، بغیر کسی تبدیلی کے — کیا وہ درست ہے؟ کیوں یا کیوں نہیں؟";
const HOMEWORK_ANSWER = 'بہاریں، بَسْتے؛ اس سال بہاریں آئیں۔';
const WRONG_KEY = 'اس کی شکل نہیں بدلے گی';
const BAHAR_STEM = "اگر آپ کو 'بہار' کی جمع بنانی ہو تو کیا کریں گے؟";

const SLIDE_SCRIPT = {
  meta: {
    lessonId: LESSON_ID, grade: 3, subject: 'urdu', topic: 'طالب علم واحد اور جمع کے فرق کو', language: 'ur',
    sloDescriptions: ['میں واحد سے جمع بنا سکتا ہوں۔'],
  },
  goal: 'طلبہ واحد اور جمع کا فرق پہچانیں اور واحد سے جمع بنائیں۔',
  sloFull: 'طلبہ واحد اور جمع کے فرق کو پہچان کر واحد الفاظ کی جمع بنا سکیں گے۔',
  bloom: 'understand',
  hook: {
    warmUp: { teacherAsks: 'ایک کتاب ہو تو کیا کہیں گے، دو ہوں تو کیا کہیں گے؟', expectedAnswer: 'ایک کتاب، دو کتابیں' },
    keyWords: [
      { term: 'واحد', urdu: 'ایک', def: 'ایک چیز کے لیے آنے والا لفظ، جیسے کتاب، بستہ۔' },
      { term: 'جمع', urdu: 'ایک سے زیادہ', def: VOCAB_DEF },
    ],
  },
  iDo: {
    keyFact: 'ایک چیز کے لیے واحد لفظ آتا ہے، ایک سے زیادہ کے لیے جمع۔',
    worked: { problem: "'گھڑی' کی جمع بنائیں۔", work: ['گھڑی کے آخر میں اں لگائیں'], answer: 'گھڑیاں' },
    cfu: "'کتاب' کی جمع کیا ہو گی؟",
    misconception: {
      slip: 'بچے سمجھتے ہیں کہ جمع بناتے وقت لفظ کی شکل نہیں بدلتی۔',
      why: 'کچھ الفاظ جیسے قلم کی جمع میں شکل نہیں بدلتی، تو بچے ہر لفظ پر یہی اصول لگا دیتے ہیں۔',
      fix: 'ہر لفظ کی جمع بول کر اور لکھ کر دکھائیں۔',
    },
  },
  weDo: {
    action: 'بورڈ پر مل کر واحد سے جمع بنائیں۔',
    modelled: { problem: "'بستہ' کی جمع بنائیں۔", work: ['بستہ کی ہ کو ے سے بدلیں'], answer: 'بستے' },
    cfu: PLANTED_CFU,
  },
  youDo: {
    problems: [
      { n: 1, prompt: "'کتاب' کی جمع لکھیں۔", answer: 'کتابیں' },
      { n: 2, prompt: "'گھڑی' کی جمع لکھیں۔", answer: 'گھڑیاں' },
    ],
  },
  wrap: {
    exitOptions: [
      { form: 'mcq', prompt: "'بستہ' کی جمع کون سی ہے؟", choices: ['بستے', 'بستہ', 'بستیں'], correct: 'A', answer: 'A — بستے' },
    ],
    keyFacts: ['واحد ایک چیز کے لیے، جمع ایک سے زیادہ کے لیے۔', 'جمع بناتے وقت اکثر لفظ کا آخر بدل جاتا ہے۔'],
    homework: [{ prompt: "'بہار' اور 'بستہ' کی جمع لکھیں اور ایک جملہ بنائیں۔", answer: HOMEWORK_ANSWER }],
  },
};

/** What the LP digest model returns for this lesson. */
const MODEL_DIGEST = {
  topic: 'Singular and plural nouns',
  topic_as_taught: 'طالب علم واحد اور جمع کے فرق کو',
  subject: 'urdu',
  grade_band: '3-5',
  language_of_instruction: 'ur',
  confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'واحد اور جمع پہچانیں', statement_en: 'Tell singular from plural', statement_ur: 'واحد اور جمع پہچانیں', evidence_quote: 'واحد', taught_level: 'recall' },
    { id: 'S2', statement: 'واحد سے جمع بنائیں', statement_en: 'Form the plural of a singular noun', statement_ur: 'واحد سے جمع بنائیں', evidence_quote: 'جمع', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'واحد', as_spoken: 'واحد' }, { term: 'جمع', as_spoken: 'جمع' }],
  examples_used: ['کتاب', 'کتابیں', 'بستہ', 'بستے', 'گھڑی', 'گھڑیاں'],
  misconceptions_surfaced: ['جمع بناتے وقت لفظ کی شکل نہیں بدلتی'],
};

function q(slo, level, question, options, extra = {}) {
  return {
    slo_id: slo,
    level,
    question,
    options,
    correct_index: 0,
    explanation: `درست جواب «${options[0]}» ہے، جیسا سبق میں بتایا گیا۔`,
    selected_because: 'یہ سوال سبق کی واحد اور جمع والی مشق سے لیا گیا',
    distractor_misconceptions: { 1: 'واحد اور جمع میں الجھن', 2: 'غلط لاحقہ لگانا' },
    option_feedback: {
      correct: 'بالکل درست!',
      wrong: { 1: `یہ درست نہیں، درست جواب «${options[0]}» ہے۔`, 2: `یہ درست نہیں، درست جواب «${options[0]}» ہے۔` },
    },
    ...extra,
  };
}

/** The eight questions the author returned. Index 6 is the one keyed to the misconception. */
const AUTHORED = [
  q('S1', 'recall', 'ان میں سے کون سا لفظ واحد ہے؟', ['کتاب', 'کتابیں', 'بستے']),
  q('S2', 'understand', "'کتاب' کی جمع کیا ہے؟", ['کتابیں', 'کتابا', 'کتابہ']),
  q('S1', 'recall', 'ایک سے زیادہ چیزوں کے لیے کون سا لفظ آتا ہے؟', ['جمع', 'واحد', 'مذکر']),
  q('S2', 'understand', "'بستہ' کی جمع کیا ہے؟", ['بستے', 'بستیں', 'بستا']),
  q('S1', 'recall', "'گھڑیاں' واحد ہے یا جمع؟", ['جمع', 'واحد', 'مؤنث']),
  q('S2', 'understand', "'گھڑی' کی جمع کیا ہے؟", ['گھڑیاں', 'گھڑیں', 'گھڑے']),
  q('S2', 'understand', BAHAR_STEM, [WRONG_KEY, "آخر میں 'یں' لگائیں گے", "آخر میں 'وں' لگائیں گے"]),
  q('S1', 'recall', 'ان میں سے کون سا لفظ جمع ہے؟', ['بہاریں', 'بہار', 'کتاب']),
];

/** What the targeted rewrite returns for index 6: the same question, keyed to what the lesson teaches. */
const REKEYED = {
  index: 6,
  ...q('S2', 'understand', BAHAR_STEM, ["آخر میں 'یں' لگا کر بہاریں", WRONG_KEY, "آخر میں 'وں' لگا کر بہاروں"]),
};

const LESSON_SUMMARY = 'آج کے سبق میں بچے واحد اور جمع کا فرق پہچانتے ہیں اور کتاب سے کتابیں بناتے ہیں۔';

module.exports = {
  LESSON_ID, VOCAB_DEF, PLANTED_CFU, HOMEWORK_ANSWER, WRONG_KEY, BAHAR_STEM,
  SLIDE_SCRIPT, MODEL_DIGEST, AUTHORED, REKEYED, LESSON_SUMMARY,
};
