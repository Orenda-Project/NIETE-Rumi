'use strict';
/**
 * A synthetic class for the class-results report — twelve children, three
 * questions worth reteaching, a full "For tomorrow" box — in both documents
 * the report ships in. Written by hand for the layout tests: nothing here comes
 * from a real class, a real lesson or a real child.
 *
 * The shape is deliberately the hard case. The Urdu correct answers are long
 * enough to wrap inside their chip; the class column holds the spellings children
 * really type into the join form ("Class 4", "grade 4", "4th", Urdu digits, …);
 * the names mix both scripts, as a real roster does.
 */

const CLASSES_ONE = ['4', 'Class 4', 'Grade 4', 'class 4', 'جماعت ۴', '۴', '4', 'grade 4', '4th', 'جماعت 4', 'Class-4', '٤'];
const CLASSES_MIXED = ['3', 'Class 4', 'Grade 5', 'class 5', 'جماعت ۴', '۳', '4', 'grade 3', '5th', 'جماعت 5', 'Class-4', '٥'];

const NAMES = ['نور', 'Anmol', 'شاہین', 'Roshan', 'اختر', 'Iman', 'عرش', 'Rayan', 'فردوس', 'Zara', 'کشف', 'Hina'];
const SCORES = [8, 8, 7, 6, 6, 5, 5, 4, 4, 3, 2, 1];

function students(classes = CLASSES_ONE, total = 8) {
  return NAMES.map((name, i) => ({
    student_name: name,
    student_class: classes[i % classes.length],
    correct_answers: SCORES[i],
    total_questions_answered: total,
    mastery_percentage: Math.round((SCORES[i] / total) * 100),
  }));
}

const UR_HARDEST = [
  {
    question_text: 'جب کوئی ہم جماعت بیمار ہو کر کئی دن اسکول نہ آ سکے تو اس کی مدد کا سب سے اچھا طریقہ کون سا ہے؟',
    wrong: 10, total: 12,
    top_wrong_text: 'اس کے گھر جا کر دیر تک ساتھ بیٹھے رہنا',
    correct_text: 'اسے روز کے سبق کے نوٹس بھیجنا اور جلد صحت یابی کی دعا کرنا',
    explanation: 'بیمار ہم جماعت کو آرام کی ضرورت ہوتی ہے، اس لیے مختصر رابطہ اور سبق میں مدد سب سے زیادہ کام آتی ہے۔',
    misconception: 'بچے سمجھتے ہیں کہ زیادہ دیر ساتھ رہنا ہی ہمدردی ہے، جبکہ بیمار کو آرام اور خاموشی چاہیے۔',
    slo: 'بیمار کی عیادت کے آداب بیان کرنا',
  },
  {
    question_text: 'لفظ "صحت" کو توڑ کر لکھیں تو کون سے حروف بنتے ہیں؟',
    wrong: 9, total: 11,
    top_wrong_text: 'ص، ح، ط',
    correct_text: 'ص، ح، ت',
    explanation: 'لفظ "صحت" کے آخر میں "ت" ہے، "ط" نہیں؛ دونوں کی آواز ملتی جلتی ہے مگر شکل الگ ہے۔',
    misconception: 'آواز ایک جیسی ہونے کی وجہ سے بچے "ت" اور "ط" کو ایک ہی حرف سمجھ لیتے ہیں۔',
    slo: 'ملتی جلتی آواز والے حروف میں فرق پہچاننا',
  },
  {
    question_text: 'ان میں سے کون سا کام عیادت کے آداب میں شامل نہیں ہے؟',
    wrong: 4, total: 11,
    top_wrong_text: null,
    correct_text: 'بیمار کے کمرے میں اونچی آواز میں باتیں کرنا',
    explanation: 'بیمار کے پاس دھیمی آواز میں بات کی جاتی ہے اور تھوڑی دیر بیٹھا جاتا ہے، جیسا کہ سبق میں بتایا گیا۔',
    misconception: null,
    slo: 'عیادت کے وقت کیے جانے والے کاموں کی پہچان کرنا',
  },
];

const UR_GUIDANCE = {
  muddled: 'بچے سمجھتے ہیں کہ بیمار دوست کے پاس جتنی دیر بیٹھا جائے اتنا ہی اچھا ہے۔',
  board: 'بورڈ پر دو خانے بنائیں: "بیمار کو کیا چاہیے" اور "ہم کیا کر سکتے ہیں"، اور بچوں سے باری باری ایک ایک بات لکھوائیں۔ '
    + 'پھر لفظ "صحت" اور "صحیح" کے حروف الگ الگ لکھ کر "ت" اور "ط" کی شکل کا فرق بچوں سے انگلی سے ہوا میں بنوائیں۔ '
    + 'آخر میں بچے جوڑیوں میں ایک مختصر پیغام لکھیں جو کسی بیمار ہم جماعت کو بھیجا جا سکے۔',
  check: 'اگر آپ کا کوئی ہم جماعت کل بیمار ہو جائے تو آپ اس کے لیے کون سے دو کام کریں جن سے اسے آرام بھی ملے اور سبق بھی نہ رہے؟',
};

const EN_HARDEST = [
  {
    question_text: 'To order 2/9, 1/6 and 2/3 from greatest to smallest, what is the best first step?',
    wrong: 10, total: 12,
    top_wrong_text: 'Cross-multiply 2/9 and 1/6',
    correct_text: 'Find one common denominator for all three fractions before comparing them',
    explanation: 'For three or more fractions, one common denominator lets every numerator be compared at once.',
    misconception: 'Cross multiplication compares two fractions at a time, so with three it has to be repeated and is easy to muddle.',
    slo: 'Order unlike fractions using a common denominator.',
  },
  {
    question_text: 'What is the smallest common denominator of 2/9, 1/6 and 2/3?',
    wrong: 9, total: 11,
    top_wrong_text: '36',
    correct_text: '18',
    explanation: 'The smallest common multiple of 9, 6 and 3 is 18.',
    misconception: '36 is a common multiple, but not the smallest one.',
    slo: 'Find the least common denominator.',
  },
  {
    question_text: 'Look at the fraction bars. Which fraction is represented by the shaded parts?',
    wrong: 4, total: 11,
    top_wrong_text: null,
    correct_text: '3/4',
    explanation: 'The bar is divided into 4 equal parts and 3 of them are shaded.',
    misconception: null,
    slo: 'Read a fraction from a bar model.',
  },
];

const EN_GUIDANCE = {
  muddled: 'They think cross-multiplying two fractions is the first step for ordering three unlike fractions.',
  board: 'Write 2/9, 1/6 and 2/3 on the board and have the children list the multiples of 9, 6 and 3 until they find 18. '
    + 'Rewrite each fraction over 18 together, then let them say the order from greatest to smallest. '
    + 'Finish by showing why cross-multiplying only ever compares two fractions at a time.',
  check: 'If you want to order 3/8, 1/4 and 5/6 from greatest to smallest, what is the best first step and why?',
};

/**
 * A "For tomorrow" box as long as the longest the model writes: the reteach move
 * runs to two paragraphs' worth. With the box and the footer held together, a
 * box this long pushed the pair past a page and the footer landed alone.
 */
function longGuidance(g) {
  return { ...g, board: `${g.board} ${g.board}` };
}

function reportData(language, { classes = CLASSES_ONE, long = false } = {}) {
  const ur = language === 'ur';
  const kids = students(classes);
  const guidance = ur ? UR_GUIDANCE : EN_GUIDANCE;
  return {
    topic: ur ? 'عیادت کے آداب' : 'Comparing and ordering unlike fractions',
    teacherName: ur ? 'آپ کے استاد' : 'Your teacher',
    started: 13,
    finished: 12,
    average: Math.round(kids.reduce((s, k) => s + k.mastery_percentage, 0) / kids.length),
    students: kids,
    hardest: ur ? UR_HARDEST : EN_HARDEST,
    guidance: long ? longGuidance(guidance) : guidance,
    unfinished: ['Nayyar'],
    // The service hands the template the children's classes; the template
    // names them in the hero.
    classes: kids.map((k) => k.student_class),
    generatedAt: ur ? '23 ستمبر 2026' : '23 Sep 2026',
    language,
    contentLanguage: language,
  };
}

module.exports = { reportData, students, CLASSES_ONE, CLASSES_MIXED, UR_HARDEST, EN_HARDEST, UR_GUIDANCE, EN_GUIDANCE };
