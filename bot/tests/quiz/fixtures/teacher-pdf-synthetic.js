'use strict';
/**
 * A synthetic eight-question Urdu quiz for the teacher's pre-send PDF, written by
 * hand for the layout tests — no real lesson, teacher or class behind it.
 *
 * `lastStemLines` grows the LAST question's stem one clause at a time. Each
 * clause adds about one line of Nastaliq, which is less than the footer's own
 * height, so sweeping it walks the last card down page 3 in steps smaller than
 * the footer: somewhere in the sweep the card still fits and the footer does
 * not. That is the page this suite exists to stop.
 */

const SLOS = [
  { id: 'S1', statement: 'بیمار کی عیادت کے آداب یاد کرنا', taught_level: 'recall' },
  { id: 'S2', statement: 'عیادت میں مناسب وقت کی اہمیت سمجھنا', taught_level: 'understand' },
  { id: 'S3', statement: 'عیادت کے آداب کا عملی مظاہرہ کرنا', taught_level: 'apply' },
  { id: 'S4', statement: 'اردو الفاظ کے حروف پہچاننا', taught_level: 'recall' },
];

const BASE = [
  ['S1', 'عیادت کے آداب میں سے کون سا کام مناسب وقت کی اہمیت کو ظاہر کرتا ہے؟', ['بیمار کے پاس بہت دیر تک بیٹھنا', 'بیمار کے پاس تھوڑی دیر بیٹھ کر واپس آنا', 'بیمار سے اس کی بیماری کے بارے میں بار بار پوچھنا'], 'B'],
  ['S4', 'تصویر میں "سلام" لفظ کے حروف دکھائے گئے ہیں۔ اس میں کتنے حرف ہیں؟', ['پانچ', 'تین', 'چار'], 'C'],
  ['S1', 'عیادت کے آداب میں سے کون سا کام کرنا ضروری ہے؟', ['بیمار کے ساتھ کھیلنا', 'بیمار سے حال چال پوچھنا', 'بیمار کے گھر سونا'], 'B'],
  ['S2', 'بیمار کے گھر زیادہ دیر تک کیوں نہیں بیٹھنا چاہیے؟', ['تاکہ جلدی گھر پہنچا جائے', 'تاکہ بیمار آرام کر سکے', 'تاکہ بھوک نہ لگے'], 'B'],
  ['S3', 'اگر کسی دوست کی عیادت کو جایا جائے تو اسے حوصلہ دینے کے لیے کیا کہا جائے؟', ['آپ جلد ٹھیک ہو جائیں، اللہ آپ کو صحت دے', 'کب تک ٹھیک ہونے کی امید ہے؟', 'آپ کو کیا ہوا ہے؟'], 'A'],
  ['S4', 'لفظ "حال" میں کون سے حروف شامل ہیں؟', ['خ، ا، ل', 'ہ، ا، ل', 'ح، ا، ل'], 'C'],
  ['S1', 'عیادت کے آداب میں سے ایک اہم ادب کیا ہے؟', ['بیمار کو کھانا کھلانا', 'بیمار کو تحفہ دینا', 'بیمار کے لیے دعا کرنا'], 'C'],
  ['S2', 'عیادت کے دوران "مناسب وقت" پر واپس آنے کا کیا مطلب ہے؟', ['بیمار کو آرام کرنے کا موقع دینا', 'اپنے گھر کے کام کرنا', 'دوسرے دوستوں سے ملنا'], 'A'],
];

// One clause of about a line of Nastaliq at the stem's size.
const CLAUSE = 'اور سبق میں بتائی گئی بات کو یاد رکھتے ہوئے';

function questions(lastStemLines = 0) {
  return BASE.map(([slo, stem, opts, key], i) => {
    const last = i === BASE.length - 1;
    const text = last && lastStemLines > 0
      ? `${Array(lastStemLines).fill(CLAUSE).join('، ')}، ${stem}`
      : stem;
    return {
      id: `q${i + 1}`,
      external_id: `tq:quiz-1:${slo}:${i + 1}`,
      sort_order: i,
      question_text: text,
      option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: null,
      correct_option: key,
      media: {},
    };
  });
}

function teacherPdfArgs(lastStemLines = 0) {
  return {
    quiz: { id: 'quiz-1', topic: 'تیمارداری کے آداب', language: 'ur', quiz_source: 'transcript' },
    questions: questions(lastStemLines),
    digest: { slos: SLOS },
    teacherName: '',
    grade: null,
    lessonSummary: 'آپ نے بچوں کو تیمارداری کے آداب سکھائے اور ایک بچے کو بیمار بنا کر عملی مظاہرہ کیا۔',
    language: 'ur',
    contentLanguage: 'ur',
    date: '14 ستمبر 2026',
    link: '',
  };
}

module.exports = { teacherPdfArgs, questions, SLOS };
