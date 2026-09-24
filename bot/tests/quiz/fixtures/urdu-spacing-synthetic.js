'use strict';
/**
 * Synthetic Urdu quizzes for the line-spacing tests, written by hand: no real
 * lesson, teacher or child behind any of it.
 *
 * Shaped like the quizzes that showed the defect: stems that wrap to two and
 * three lines of Nastaliq, options that wrap inside their row, a learning goal
 * long enough to fill the line above the stem, a maths quiz whose stems and
 * options carry typeset fractions, and a picture question. The names are the
 * hard case for a clipped one-line label: each opens with a letter whose
 * stroke rises far above the line (ک گ).
 */

const SOCIAL_SLOS = [
  { id: 'S1', statement: 'بیمار کی عیادت کے آداب یاد کرنا اور ان پر عمل کرنے کے طریقے بیان کرنا', taught_level: 'recall' },
  { id: 'S2', statement: 'عیادت میں مناسب وقت کی اہمیت سمجھنا', taught_level: 'understand' },
  { id: 'S3', statement: 'عیادت کے آداب کا عملی مظاہرہ کرنا', taught_level: 'apply' },
];

const SOCIAL = [
  ['S2', 'جب کوئی ہم جماعت بیمار ہو کر کئی دن اسکول نہ آ سکے اور اس کے گھر والے بتائیں کہ ڈاکٹر نے اسے آرام کرنے کو کہا ہے تو اس کی عیادت کے لیے جاتے وقت کون سا کام سب سے زیادہ مناسب ہوگا؟',
    ['اس کے گھر جا کر دیر تک ساتھ بیٹھے رہنا اور کھیلنا', 'تھوڑی دیر کے لیے جا کر حال پوچھنا، دعا دینا اور جلد واپس آ جانا تاکہ وہ آرام کر سکے', 'اسے فون کر کے اسکول کا سارا کام فوراً ختم کرنے کو کہنا'], 'B'],
  ['S1', 'عیادت کے آداب میں سے کون سا کام مناسب وقت کی اہمیت کو ظاہر کرتا ہے؟',
    ['بیمار کے پاس بہت دیر تک بیٹھنا', 'بیمار کے پاس تھوڑی دیر بیٹھ کر واپس آنا', 'بیمار سے اس کی بیماری کے بارے میں بار بار پوچھنا'], 'B'],
  ['S3', 'اگر کسی دوست کی عیادت کو جایا جائے تو اسے حوصلہ دینے کے لیے کیا کہا جائے؟',
    ['آپ جلد ٹھیک ہو جائیں، اللہ آپ کو صحت دے', 'کب تک ٹھیک ہونے کی امید ہے؟', 'آپ کو کیا ہوا ہے؟'], 'A'],
  ['S2', 'بیمار کے گھر زیادہ دیر تک کیوں نہیں بیٹھنا چاہیے، جبکہ ہم اس سے ملنے کے لیے بہت دور سے آئے ہوں اور ہمارے پاس بہت سی باتیں ہوں؟',
    ['تاکہ جلدی گھر پہنچا جائے', 'تاکہ بیمار آرام کر سکے اور اس کی تکلیف نہ بڑھے', 'تاکہ بھوک نہ لگے'], 'B'],
  ['S1', 'لفظ "حال" میں کون سے حروف شامل ہیں؟', ['خ، ا، ل', 'ہ، ا، ل', 'ح، ا، ل'], 'C'],
  ['S3', 'کلاس میں عیادت کا عملی مظاہرہ کرتے ہوئے ایک بچہ بیمار بنا۔ دوسرے بچے نے دروازہ کھٹکھٹائے بغیر کمرے میں داخل ہو کر اونچی آواز میں بات شروع کر دی۔ اس نے کون سا ادب نہیں نبھایا؟',
    ['اجازت لے کر اندر آنا اور دھیمی آواز میں بات کرنا', 'تحفہ لے کر جانا', 'بیمار کے ساتھ کھانا کھانا'], 'A'],
];

const MATHS_SLOS = [
  { id: 'M1', statement: 'ایک جیسے نسب نما والی کسروں کو جمع کرنا', taught_level: 'apply' },
  { id: 'M2', statement: 'کسر کے حصوں (شمار کنندہ اور نسب نما) کی پہچان کرنا', taught_level: 'understand' },
];

const MATHS = [
  ['M1', '$\\frac{2}{7} + \\frac{3}{7}$ کا جواب کیا ہوگا؟ جواب کو سادہ ترین شکل میں لکھیں۔', ['$\\frac{5}{7}$', '$\\frac{5}{14}$', '$\\frac{6}{7}$'], 'A'],
  ['M2', 'تصویر میں ایک پٹی کے چار برابر حصے کیے گئے ہیں اور ان میں سے تین حصے رنگے ہوئے ہیں۔ رنگا ہوا حصہ کون سی کسر ظاہر کرتا ہے؟',
    ['$\\frac{3}{4}$', '$\\frac{1}{4}$', '$\\frac{4}{3}$'], 'A', { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] }],
  ['M1', 'ایک بچے کے پاس روٹی کا $\\frac{1}{5}$ حصہ تھا اور گھر سے مزید $\\frac{2}{5}$ حصہ مل گیا۔ اب اس کے پاس روٹی کا کتنا حصہ ہے؟',
    ['$\\frac{3}{5}$ حصہ، کیونکہ نسب نما ایک جیسے ہیں اس لیے صرف شمار کنندہ جمع ہوں گے', '$\\frac{3}{10}$ حصہ', '$\\frac{2}{25}$ حصہ'], 'A'],
  ['M2', 'کسر $\\frac{4}{9}$ میں نیچے والا عدد کیا کہلاتا ہے؟', ['شمار کنندہ', 'نسب نما', 'حاصل جمع'], 'B'],
  ['M1', 'اگر $12 \\div 3 = 4$ ہو تو $\\frac{12}{3}$ کس کے برابر ہے؟', ['$3$', '$4$', '$9$'], 'B'],
];

const SCIENCE_SLOS = [
  { id: 'C1', statement: 'پودوں کی ضروریات پہچاننا', taught_level: 'recall' },
  { id: 'C2', statement: 'پودے اپنی خوراک کیسے بناتے ہیں، یہ سمجھنا', taught_level: 'understand' },
];

const SCIENCE = [
  ['C1', 'تصویر میں کتنے بستے ہیں؟', ['دو بستے', 'تین بستے', 'چار بستے'], 'B', { type: 'count_objects', count: 3, picto: 'bag_school' }],
  ['C2', 'پودے اپنی خوراک کہاں سے حاصل کرتے ہیں، جبکہ ان کے پاس کھانے کے لیے منہ نہیں ہوتا اور وہ ایک جگہ سے دوسری جگہ جا بھی نہیں سکتے؟',
    ['پتے سورج کی روشنی، پانی اور ہوا سے اپنی خوراک خود بناتے ہیں', 'پودے مٹی سے بنی بنائی خوراک کھاتے ہیں', 'پودوں کو خوراک کی ضرورت نہیں ہوتی'], 'A'],
  ['C1', 'اگر گملے کے پودے کو کئی دن تک پانی نہ دیا جائے تو کیا ہوگا؟', ['پودا مرجھا جائے گا', 'پودا تیزی سے بڑھے گا', 'پودے پر پھل لگ جائیں گے'], 'A'],
];

function rows(list, quizId) {
  return list.map(([slo, stem, opts, key, figure], i) => ({
    id: `q${i + 1}`,
    external_id: `tq:${quizId}:${slo}:${i + 1}`,
    sort_order: i,
    question_text: stem,
    option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: opts[3] || null,
    correct_option: key,
    media: figure ? { figure } : {},
  }));
}

/** The three Urdu quizzes, each as the teacher-PDF template's arguments minus figure SVGs. */
const QUIZZES = {
  social: {
    quizSource: 'transcript', topic: 'تیمارداری کے آداب اور بیمار کی عیادت کا صحیح طریقہ', slos: SOCIAL_SLOS, list: SOCIAL,
    lessonSummary: 'آپ نے بچوں کو تیمارداری کے آداب سکھائے، ایک بچے کو بیمار بنا کر کلاس میں عملی مظاہرہ کیا اور بتایا کہ بیمار کے پاس تھوڑی دیر بیٹھ کر دعا دے کر واپس آنا چاہیے۔',
    checks: 'یہ quiz دیکھتا ہے کہ بچے عیادت کے آداب یاد رکھتے ہیں، مناسب وقت کی اہمیت سمجھتے ہیں اور انہیں عملی طور پر برت سکتے ہیں۔',
  },
  maths: {
    quizSource: 'lp_v8', topic: 'ایک جیسے نسب نما والی کسروں کی جمع', slos: MATHS_SLOS, list: MATHS,
    lessonSummary: 'اس سبق کے منصوبے میں بچے پٹیوں اور روٹی کی مثال سے ایک جیسے نسب نما والی کسریں جمع کرنا سیکھتے ہیں۔',
  },
  science: {
    quizSource: 'transcript', topic: 'پودوں کی ضروریات', slos: SCIENCE_SLOS, list: SCIENCE,
    lessonSummary: 'آپ نے پودوں کی ضروریات — پانی، روشنی اور ہوا — پر بات کی اور گملوں کی مدد سے دکھایا کہ پودے اپنی خوراک خود بناتے ہیں۔',
  },
};

/** Names and topics that open on a letter whose stroke rises far above the line. */
const TALL_NAMES = ['کشف', 'کنول', 'گل مینا', 'کلثوم', 'سکینہ', 'مہک'];
const TALL_TOPIC = 'صحیح طریقہ اور گنتی';

module.exports = { QUIZZES, rows, TALL_NAMES, TALL_TOPIC };
