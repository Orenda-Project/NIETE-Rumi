'use strict';
/**
 * The letters lesson (حروف کا جوڑ توڑ) whose quiz, on sandbox, shipped two
 * answer keys a reader of Urdu can see are wrong — and whose class report then
 * taught the wrong one back to the teacher.
 *
 *   - index 6: «لفظ حال کے جوڑ توڑ میں کون سے حروف شامل ہیں؟» keyed «ہ، ا، ل».
 *     حال is spelled ح ا ل; the right option is «ح، ا، ل».
 *   - index 3: «سلام» keyed «س، ل، ا، م» while «س، ا، ل، م» holds the same four
 *     letters in another order — the question asks which letters are IN the
 *     word, so both are right: two correct answers.
 *
 * Neither fault is in any lesson source: it is a spelling fact. Synthetic (this
 * repo is public); the two items are the live ones, verbatim.
 */

const HAAL_STEM = 'لفظ حال کے جوڑ توڑ میں کون سے حروف شامل ہیں؟';
const HAAL_WRONG_KEY = 'ہ، ا، ل';
const HAAL_RIGHT = 'ح، ا، ل';
const SALAAM_STEM = 'لفظ سلام کے جوڑ توڑ میں کون سے حروف شامل ہیں؟';
const SALAAM_KEY = 'س، ل، ا، م';
const SALAAM_TWIN = 'س، ا، ل، م';

const DIGEST = {
  topic: 'Joining and breaking words into letters',
  topic_as_taught: 'حروف کا جوڑ توڑ',
  subject: 'urdu',
  grade_band: '3-5',
  language_of_instruction: 'ur',
  confidence: 0.9,
  slos: [
    { id: 'S1', statement: 'لفظ کے حروف پہچانیں', statement_en: 'Name the letters of a word', statement_ur: 'لفظ کے حروف پہچانیں', evidence_quote: 'حروف', taught_level: 'recall' },
    { id: 'S2', statement: 'حروف جوڑ کر لفظ بنائیں اور لفظ کو حروف میں توڑیں', statement_en: 'Join letters into a word and break a word into letters', statement_ur: 'حروف جوڑ کر لفظ بنائیں اور لفظ کو حروف میں توڑیں', evidence_quote: 'جوڑ توڑ', taught_level: 'understand' },
  ],
  key_terms: [{ term: 'حروف', as_spoken: 'حروف' }, { term: 'جوڑ توڑ', as_spoken: 'جوڑ توڑ' }],
  examples_used: ['سلام', 'حال', 'دعا', 'صبر', 'نماز'],
  misconceptions_surfaced: ['ح اور ہ میں الجھن'],
};

function q(slo, level, question, options, extra = {}) {
  return {
    slo_id: slo,
    level,
    question,
    options,
    correct_index: 0,
    explanation: `درست جواب «${options[0]}» ہے، جیسا سبق میں بتایا گیا۔`,
    selected_because: 'یہ سوال سبق کی حروف کے جوڑ توڑ والی مشق سے لیا گیا',
    distractor_misconceptions: { 1: 'ملتے جلتے حروف میں الجھن', 2: 'حروف کی ترتیب میں الجھن' },
    option_feedback: {
      correct: 'بالکل درست!',
      wrong: { 1: `یہ درست نہیں، درست جواب «${options[0]}» ہے۔`, 2: `یہ درست نہیں، درست جواب «${options[0]}» ہے۔` },
    },
    ...extra,
  };
}

/** What the author returned. Index 3 has two right answers; index 6 is keyed to a misspelling. */
const AUTHORED = [
  q('S1', 'recall', 'حرف «ب» سے کون سا لفظ شروع ہوتا ہے؟', ['بکری', 'مکان', 'قلم']),
  q('S1', 'recall', 'لفظ «نماز» کا پہلا حرف کون سا ہے؟', ['ن', 'م', 'ز']),
  q('S2', 'understand', 'حروف «د، ع، ا» جوڑنے سے کون سا لفظ بنتا ہے؟', ['دعا', 'دانہ', 'عادت']),
  q('S2', 'understand', SALAAM_STEM, [SALAAM_KEY, SALAAM_TWIN, 'ص، ل، ا، م']),
  q('S1', 'recall', 'لفظ «قرآن» کا آخری حرف کون سا ہے؟', ['ن', 'ق', 'ر']),
  q('S2', 'understand', 'حروف «ص، ب، ر» جوڑنے سے کون سا لفظ بنتا ہے؟', ['صبر', 'صاف', 'سبز']),
  q('S2', 'understand', HAAL_STEM, [HAAL_WRONG_KEY, HAAL_RIGHT, 'ح، ل، م']),
  q('S1', 'recall', 'لفظ «مسجد» کا پہلا حرف کون سا ہے؟', ['م', 'س', 'د']),
];

/** The targeted rewrite's answer for index 6: the same question, keyed to the right spelling. */
const HAAL_REKEYED = { index: 6, ...q('S2', 'understand', HAAL_STEM, [HAAL_RIGHT, HAAL_WRONG_KEY, 'ح، ل، م']) };
/** …and for index 3: one option holds the letters of سلام, the other two do not. */
const SALAAM_REWRITTEN = { index: 3, ...q('S2', 'understand', SALAAM_STEM, [SALAAM_KEY, 'ش، ل، ا، م', 'ص، ل، ا، م']) };

const LESSON_SUMMARY = 'آج کے سبق میں آپ نے بچوں کے ساتھ الفاظ کو حروف میں توڑا اور حروف جوڑ کر الفاظ بنائے، جیسے سلام اور دعا۔';

module.exports = {
  HAAL_STEM, HAAL_WRONG_KEY, HAAL_RIGHT, SALAAM_STEM, SALAAM_KEY, SALAAM_TWIN,
  DIGEST, AUTHORED, HAAL_REKEYED, SALAAM_REWRITTEN, LESSON_SUMMARY,
};
