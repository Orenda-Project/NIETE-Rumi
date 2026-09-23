'use strict';
/**
 * THE QUIZ-LEVEL URDU CHECK COUNTS WORDS, NOT LETTERS.
 *
 * Staging, lesson-plan quiz on "Comparing & ordering unlike fractions", Urdu:
 * all three authoring attempts were rejected for ONE complaint only —
 * "urdu script ratio 0.55 < 0.6", then 0.59, then 0.57 — and the teacher was
 * told the lesson plan was the problem. On production the same complaint
 * rejected 14 attempts in 14 days and made 5 salvages refuse.
 *
 * The check measured Arabic LETTERS as a share of all letters. The language
 * ask promises the opposite of what that measure rewards: "Urdu — English
 * terms stay in English letters (fraction, numerator)". In a fractions lesson
 * those terms are long ("denominator" is 11 letters, "کو" is 2), so a correct
 * Urdu quiz built around them is mostly LATIN LETTERS while being mostly URDU
 * WORDS. The per-question teacher-fields rule was moved from letters to words
 * for exactly this reason after a production loss on 7 Sep; the quiz-level
 * check never was.
 *
 * Now: Urdu-script words as a share of all words, with the maths (`$…$`, which
 * is the same in either language) and bare numbers not counted as words —
 * taken separately over the questions and over the explanations and feedback,
 * and the quiz judged on the lower of the two. Pooled into one number, three
 * pieces of feedback per question outweigh the question itself, so a quiz
 * whose every question is English would read as Urdu. The bar is set from real
 * authored quizzes (see the PR for both distributions): every real Urdu quiz,
 * maths and English-grammar lessons included, sits well above it; every real
 * English quiz, every Roman-Urdu one and every half-and-half one sits well
 * below.
 *
 * The complaint keeps its prefix, "urdu script ratio ", because the retry note
 * recognises a wrong-script attempt by it (WRONG_SCRIPT_RE).
 *
 * Every fixture here is synthetic.
 */
const V = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const { WRONG_SCRIPT_RE } = require('../../bot/shared/services/quiz/transcript-quiz-contract');

const DIGEST = {
  topic: 'Comparing and ordering unlike fractions', subject: 'maths',
  slos: [
    { id: 'S1', statement: 'compare two unlike fractions by cross multiplication', taught_level: 'apply' },
    { id: 'S2', statement: 'order three unlike fractions over a common denominator', taught_level: 'apply' },
  ],
  key_terms: [{ term: 'unlike fractions' }, { term: 'cross multiplication' }, { term: 'common denominator' },
    { term: 'numerator' }, { term: 'denominator' }, { term: 'product' }],
};
const CTX = {
  language: 'ur', subject: 'maths', digest: DIGEST, nExpected: 8,
  lessonSummary: 'آج کے سبق میں unlike fractions کا cross multiplication سے موازنہ اور تین fractions کو ایک common denominator پر ترتیب دینا ہے۔',
};
const F = (a, b) => `$\\frac{${a}}{${b}}$`;

/** A correct Urdu quiz on the lesson that failed: Urdu sentences, the lesson's English terms, typeset maths. */
function urduQuiz() {
  return [
    { slo_id: 'S1', level: 'recall',
      question: 'کسی fraction میں لکیر کے نیچے والے عدد کو کیا کہتے ہیں؟',
      options: ['denominator', 'numerator', 'cross product'], correct_index: 0,
      explanation: 'لکیر کے نیچے والا عدد denominator ہے، جو بتاتا ہے کہ پوری چیز کے کتنے برابر حصے ہیں۔',
      selected_because: 'سبق کے شروع میں numerator اور denominator کے نام دہرائے گئے',
      distractor_misconceptions: { 1: 'numerator اور denominator کو الٹ سمجھنا', 2: 'cross product کو denominator سمجھنا' },
      option_feedback: { correct: 'بالکل درست! denominator لکیر کے نیچے ہوتا ہے۔',
        wrong: { 1: 'numerator لکیر کے اوپر ہوتا ہے؛ نیچے والا عدد denominator ہے۔', 2: 'cross product دو fractions سے بنتا ہے؛ نیچے والا عدد denominator ہے۔' } } },
    { slo_id: 'S1', level: 'understand',
      question: 'دو unlike fractions میں کیا فرق ہوتا ہے؟',
      options: ['ان کے denominators مختلف ہوتے ہیں', 'ان کے numerators برابر ہوتے ہیں', 'ان کے denominators برابر ہوتے ہیں'], correct_index: 0,
      explanation: 'unlike fractions کے denominators مختلف ہوتے ہیں، اس لیے انہیں سیدھا نہیں ملا سکتے۔',
      selected_because: 'سبق نے like اور unlike fractions کا فرق واضح کیا',
      distractor_misconceptions: { 1: 'numerators دیکھ کر فیصلہ کرنا', 2: 'like fractions کو unlike سمجھنا' },
      option_feedback: { correct: 'شاباش! unlike fractions کے denominators مختلف ہوتے ہیں۔',
        wrong: { 1: 'numerators کچھ بھی ہو سکتے ہیں؛ unlike کا مطلب ہے کہ denominators مختلف ہیں۔', 2: 'برابر denominators والی fractions کو like fractions کہتے ہیں۔' } } },
    { slo_id: 'S1', level: 'apply',
      question: `cross multiplication سے بتائیں: ${F(2, 3)} اور ${F(3, 5)} میں کون سی fraction بڑی ہے؟`,
      options: [F(2, 3), F(3, 5), 'دونوں برابر ہیں'], correct_index: 0,
      explanation: `cross multiplication میں $2 \\times 5 = 10$ اور $3 \\times 3 = 9$ آتا ہے؛ 10 بڑا ہے، اس لیے ${F(2, 3)} بڑی ہے۔`,
      selected_because: 'سبق کی مثال میں دو بوتلوں کا موازنہ cross multiplication سے ہوا',
      distractor_misconceptions: { 1: 'product کو غلط fraction سے جوڑنا', 2: 'cross products کو برابر سمجھنا' },
      option_feedback: { correct: `بہت خوب! 10 بڑا ہے، اس لیے ${F(2, 3)} بڑی fraction ہے۔`,
        wrong: { 1: `ہر product کو اس کے اپنے numerator والی fraction سے جوڑیں؛ 10 والی fraction ${F(2, 3)} ہے۔`, 2: '10 اور 9 برابر نہیں، اس لیے دونوں fractions برابر نہیں ہیں۔' } } },
    { slo_id: 'S1', level: 'apply',
      question: `${F(3, 4)} اور ${F(2, 5)} کی cross multiplication میں ${F(3, 4)} کا product کیا ہے؟`,
      options: ['15', '8', '12'], correct_index: 0,
      explanation: `${F(3, 4)} کا numerator 3 دوسری fraction کے denominator 5 سے ضرب ہوتا ہے: $3 \\times 5 = 15$۔`,
      selected_because: 'بورڈ پر cross products لکھ کر موازنہ کیا گیا',
      distractor_misconceptions: { 1: 'دوسری fraction کا product لینا', 2: 'دونوں denominators کو ضرب دینا' },
      option_feedback: { correct: 'درست! 3 کو 5 سے ضرب دیں تو 15 آتا ہے۔',
        wrong: { 1: `8 تو ${F(2, 5)} کا product ہے؛ ${F(3, 4)} کا product 15 ہے۔`, 2: 'denominators کو آپس میں ضرب نہیں دیتے؛ numerator کو دوسرے denominator سے ضرب دیں۔' } } },
    { slo_id: 'S2', level: 'understand',
      question: 'تین unlike fractions کو ترتیب دینے سے پہلے کیا کرنا چاہیے؟',
      options: ['انہیں ایک common denominator پر لکھنا', 'صرف numerators کا موازنہ کرنا', 'سب سے بڑا denominator چننا'], correct_index: 0,
      explanation: 'جب سب fractions کا denominator ایک ہو جائے تو numerators دیکھ کر ترتیب بن جاتی ہے۔',
      selected_because: 'سبق نے تین fractions کو ایک common denominator پر لکھ کر ترتیب دی',
      distractor_misconceptions: { 1: 'denominators کو نظر انداز کرنا', 2: 'بڑے denominator کو بڑی fraction سمجھنا' },
      option_feedback: { correct: 'بہت اچھے! پہلے common denominator، پھر numerators کا موازنہ۔',
        wrong: { 1: 'جب denominators مختلف ہوں تو صرف numerators سے فیصلہ نہیں ہو سکتا۔', 2: 'بڑا denominator چننے سے fractions ایک جیسی نہیں بنتیں؛ پہلے common denominator بنائیں۔' } } },
    { slo_id: 'S2', level: 'apply',
      question: `${F(1, 2)}، ${F(1, 3)} اور ${F(1, 6)} کا سب سے چھوٹا common denominator کیا ہوگا؟`,
      options: ['6', '3', '11'], correct_index: 0,
      explanation: '6 کو 2، 3 اور 6 تینوں پورا تقسیم کرتے ہیں، اس لیے 6 سب سے چھوٹا common denominator ہے۔',
      selected_because: 'کلاس نے common denominator تلاش کرنے کی مشق کی',
      distractor_misconceptions: { 1: 'درمیان والا denominator چن لینا', 2: 'denominators کو جمع کر دینا' },
      option_feedback: { correct: 'شاباش! 6 کو تینوں denominators پورا تقسیم کرتے ہیں۔',
        wrong: { 1: '3 کو 2 پورا تقسیم نہیں کرتا، اس لیے یہ common denominator نہیں۔', 2: 'denominators کو جمع نہیں کرتے؛ وہ عدد ڈھونڈیں جسے سب پورا تقسیم کریں۔' } } },
    { slo_id: 'S2', level: 'apply',
      question: `common denominator 12 پر لکھیں تو ${F(2, 3)} کس کے برابر ہوگی؟`,
      options: [F(8, 12), F(2, 12), F(6, 12)], correct_index: 0,
      explanation: 'denominator کو 4 سے ضرب دیا تو numerator کو بھی 4 سے ضرب دیں: $2 \\times 4 = 8$۔',
      selected_because: 'سبق میں fractions کو ایک common denominator پر دوبارہ لکھا گیا',
      distractor_misconceptions: { 1: 'صرف denominator بدلنا', 2: 'numerator میں 4 جمع کرنا' },
      option_feedback: { correct: 'بالکل ٹھیک! numerator اور denominator دونوں کو 4 سے ضرب دی۔',
        wrong: { 1: 'صرف denominator بدلنے سے fraction چھوٹی ہو جاتی ہے؛ numerator کو بھی 4 سے ضرب دیں۔', 2: 'numerator میں جمع نہیں، ضرب کرنی ہے: $2 \\times 4 = 8$۔' } } },
    { slo_id: 'S2', level: 'apply',
      question: `${F(2, 3)}، ${F(1, 4)} اور ${F(5, 6)} کی چھوٹی سے بڑی ترتیب کون سی ہے؟`,
      options: [`${F(1, 4)}، ${F(2, 3)}، ${F(5, 6)}`, `${F(5, 6)}، ${F(2, 3)}، ${F(1, 4)}`, `${F(1, 4)}، ${F(5, 6)}، ${F(2, 3)}`], correct_index: 0,
      explanation: `common denominator 12 پر یہ ${F(8, 12)}، ${F(3, 12)} اور ${F(10, 12)} بنتی ہیں؛ numerators کی ترتیب 3، 8، 10 ہے۔`,
      selected_because: 'آخری مشق میں تین fractions کو ترتیب دی گئی',
      distractor_misconceptions: { 1: 'بڑی سے چھوٹی ترتیب لکھنا', 2: 'بڑے denominator کو بڑی fraction سمجھنا' },
      option_feedback: { correct: `بہت خوب! 3، 8، 10 کی ترتیب سے ${F(1, 4)} سب سے چھوٹی ہے۔`,
        wrong: { 1: 'یہ بڑی سے چھوٹی ترتیب ہے؛ سوال چھوٹی سے بڑی کا ہے۔', 2: `${F(5, 6)} کا numerator 10 بنتا ہے جو سب سے بڑا ہے، اس لیے وہ آخر میں آئے گی۔` } } },
  ];
}

/** The model answered in ENGLISH: the same eight questions, the Urdu sentences written in English. */
const ENGLISH = [
  ['In a fraction, what is the number below the line called?', 'The number below the line is the denominator; it tells how many equal parts the whole has.', 'Exactly right! The denominator sits below the line.', 'The numerator sits above the line; the number below is the denominator.', 'A cross product comes from two fractions; the number below the line is the denominator.'],
  ['What is different about two unlike fractions?', 'Unlike fractions have different denominators, so they cannot be compared straight away.', 'Well done! Unlike fractions have different denominators.', 'The numerators can be anything; unlike means the denominators are different.', 'Fractions with equal denominators are called like fractions.'],
  [`Use cross multiplication: which is bigger, ${F(2, 3)} or ${F(3, 5)}?`, 'Cross multiplication gives $2 \\times 5 = 10$ and $3 \\times 3 = 9$; 10 is bigger, so the first fraction is bigger.', 'Great! 10 is bigger, so that fraction is the bigger one.', 'Match each product to the fraction whose numerator made it.', '10 and 9 are not equal, so the fractions are not equal.'],
  [`In the cross multiplication of ${F(3, 4)} and ${F(2, 5)}, what is the product for the first fraction?`, 'Its numerator 3 is multiplied by the other denominator 5, which makes 15.', 'Correct! 3 times 5 is 15.', 'That is the product for the other fraction.', 'We never multiply the two denominators together here.'],
  ['What should you do before putting three unlike fractions in order?', 'Once every fraction has the same denominator, the numerators give the order.', 'Very good! First a common denominator, then compare the numerators.', 'When the denominators differ, the numerators alone cannot decide.', 'Choosing the biggest denominator does not make the fractions alike.'],
  [`What is the smallest common denominator of ${F(1, 2)}, ${F(1, 3)} and ${F(1, 6)}?`, 'All three denominators divide 6 exactly, so 6 is the smallest common denominator.', 'Well done! All three denominators divide 6.', '2 does not divide 3 exactly, so it cannot be the common denominator.', 'We do not add the denominators; find the number they all divide.'],
  [`Written over a common denominator of 12, what is ${F(2, 3)} equal to?`, 'The denominator was multiplied by 4, so the numerator is multiplied by 4 too.', 'Exactly! Both parts were multiplied by 4.', 'Changing only the denominator makes the fraction smaller.', 'Multiply the numerator by 4, do not add 4 to it.'],
  [`How do you write ${F(2, 3)}, ${F(1, 4)} and ${F(5, 6)} from smallest to biggest?`, 'Over 12 they become eight, three and ten twelfths, so the order of the numerators is 3, 8, 10.', 'Great! Following 3, 8, 10, the smallest comes first.', 'That is biggest to smallest; the question asks smallest to biggest.', 'The last fraction has the biggest numerator over 12, so it comes last.'],
];
const ENGLISH_OPTIONS = [
  ['denominator', 'numerator', 'cross product'],
  ['their denominators are different', 'their numerators are equal', 'their denominators are equal'],
  null, null,
  ['write them over one common denominator', 'compare only the numerators', 'pick the biggest denominator'],
  null, null, null,
];
function englishQuiz() {
  return urduQuiz().map((q, i) => {
    const [question, explanation, correct, w1, w2] = ENGLISH[i];
    const keys = Object.keys(q.option_feedback.wrong);
    return {
      ...q, question, explanation,
      options: ENGLISH_OPTIONS[i] || q.options.map((o) => (o === 'دونوں برابر ہیں' ? 'they are equal' : o)),
      option_feedback: { correct, wrong: { [keys[0]]: w1, [keys[1]]: w2 } },
    };
  });
}

/** The model answered in ROMAN URDU: Urdu in Latin letters. */
const ROMAN = [
  ['Kisi fraction mein lakeer ke neeche wale adad ko kya kehte hain?', 'Lakeer ke neeche wala adad denominator hai.', 'Bilkul durust! Denominator lakeer ke neeche hota hai.', 'Numerator lakeer ke upar hota hai.', 'Cross product do fractions se banta hai.'],
  ['Do unlike fractions mein kya farq hota hai?', 'Unlike fractions ke denominators mukhtalif hote hain.', 'Shabash! Denominators mukhtalif hote hain.', 'Numerators kuch bhi ho sakte hain.', 'Barabar denominators wali fractions like fractions hain.'],
  ['Cross multiplication se batayein kaun si fraction bari hai?', 'Cross multiplication mein 10 aur 9 aata hai, 10 bara hai.', 'Bohat khoob! 10 bara hai.', 'Har product ko apni fraction se jorein.', '10 aur 9 barabar nahi hain.'],
  ['Pehli fraction ka product kya hai?', 'Numerator 3 doosre denominator 5 se zarb hota hai.', 'Durust! 3 ko 5 se zarb dein to 15 aata hai.', 'Yeh doosri fraction ka product hai.', 'Denominators ko aapas mein zarb nahi dete.'],
  ['Teen unlike fractions ko tarteeb dene se pehle kya karna chahiye?', 'Jab sab ka denominator aik ho jaye to tarteeb ban jati hai.', 'Bohat achay! Pehle common denominator.', 'Sirf numerators se faisla nahi ho sakta.', 'Bara denominator chunne se fractions aik jaisi nahi banti.'],
  ['Sab se chota common denominator kya hoga?', 'Teeno denominators 6 ko poora taqseem karte hain.', 'Shabash! 6 sab ka common denominator hai.', '3 ko 2 poora taqseem nahi karta.', 'Denominators ko jama nahi karte.'],
  ['Common denominator 12 par likhein to kya banega?', 'Denominator ko 4 se zarb diya to numerator ko bhi 4 se zarb dein.', 'Bilkul theek! Dono ko 4 se zarb di.', 'Sirf denominator badalne se fraction choti ho jati hai.', 'Numerator mein jama nahi, zarb karni hai.'],
  ['In teen fractions ko choti se bari tarteeb mein kaise likhenge?', 'Numerators ki tarteeb 3, 8, 10 hai.', 'Bohat khoob! Sab se choti pehle aati hai.', 'Yeh bari se choti tarteeb hai.', 'Aakhri fraction ka numerator sab se bara hai.'],
];
function romanQuiz() {
  return urduQuiz().map((q, i) => {
    const [question, explanation, correct, w1, w2] = ROMAN[i];
    const keys = Object.keys(q.option_feedback.wrong);
    return {
      ...q, question, explanation,
      options: q.options.map((o) => (/\p{Script=Arabic}/u.test(o) ? `jawab ${q.options.indexOf(o) + 1} hai` : o)),
      option_feedback: { correct, wrong: { [keys[0]]: w1, [keys[1]]: w2 } },
    };
  });
}

/**
 * An Urdu quiz on an ENGLISH-GRAMMAR lesson: the questions quote the lesson's
 * English sentences and the options are English words — the lowest-scoring
 * kind of real Urdu quiz, and still an Urdu quiz.
 */
const GRAMMAR_DIGEST = {
  topic: 'Action words and the gender of nouns', subject: 'english',
  slos: [
    { id: 'S1', statement: 'find the action word in a sentence', taught_level: 'apply' },
    { id: 'S2', statement: 'tell masculine and feminine nouns apart', taught_level: 'understand' },
  ],
};
const GRAMMAR_CTX = {
  language: 'ur', subject: 'english', digest: GRAMMAR_DIGEST, nExpected: 8,
  lessonSummary: 'آج کے سبق میں action words پہچاننا اور اسموں کے مذکر اور مؤنث میں فرق کرنا ہے۔',
};
const G = (slo, level, question, options, explanation, correct, w1, w2, why, m1, m2) => ({
  slo_id: slo, level, question, options, correct_index: 0, explanation, selected_because: why,
  distractor_misconceptions: { 1: m1, 2: m2 }, option_feedback: { correct, wrong: { 1: w1, 2: w2 } },
});
function grammarQuiz() {
  return [
    G('S1', 'apply', 'The girls play cricket in the park. اس جملے میں action word کون سا ہے؟', ['play', 'girls', 'park'],
      "'play' وہ کام ہے جو لڑکیاں کر رہی ہیں، اس لیے یہ action word ہے۔", "بالکل درست! 'play' بتاتا ہے کہ لڑکیاں کیا کر رہی ہیں۔",
      "'girls' کام کرنے والے ہیں، کام نہیں؛ action word 'play' ہے۔", "'park' ایک جگہ ہے؛ جو کام ہو رہا ہے وہ 'play' ہے۔",
      'سبق میں کرکٹ والے جملے سے action word ڈھونڈا گیا', 'کام کرنے والے کو کام سمجھنا', 'جگہ کو کام سمجھنا'),
    G('S1', 'apply', 'The children dance to the song. اس جملے میں کام بتانے والا لفظ کون سا ہے؟', ['dance', 'children', 'song'],
      "'dance' وہ حرکت ہے جو بچے کر رہے ہیں۔", "شاباش! 'dance' ایک حرکت ہے، یعنی action word۔",
      "'children' وہ ہیں جو ناچ رہے ہیں؛ کام 'dance' ہے۔", "'song' وہ چیز ہے جس پر ناچ رہے ہیں؛ کام 'dance' ہے۔",
      'سبق میں ناچنے کی مثال سے حرکت پہچانی گئی', 'کرنے والے کو کام سمجھنا', 'چیز کو کام سمجھنا'),
    G('S1', 'apply', 'My brother writes a letter. اس جملے میں action word کیا ہے؟', ['writes', 'brother', 'letter'],
      "'writes' بتاتا ہے کہ بھائی کیا کر رہا ہے۔", "بہت خوب! 'writes' لکھنے کا کام ہے۔",
      "'brother' کام کرنے والا ہے؛ کام 'writes' ہے۔", "'letter' وہ چیز ہے جو لکھی جا رہی ہے؛ کام 'writes' ہے۔",
      'سبق میں خط لکھنے کے جملے پر بات ہوئی', 'کرنے والے کو کام سمجھنا', 'چیز کو کام سمجھنا'),
    G('S1', 'understand', 'ان میں سے کون سا لفظ action word ہے؟', ['run', 'table', 'happy'],
      "'run' ایک حرکت ہے، اس لیے یہ action word ہے۔", "درست! 'run' دوڑنے کا کام ہے۔",
      "'table' ایک چیز ہے، کام نہیں۔", "'happy' کیفیت بتاتا ہے، کام نہیں۔",
      'سبق میں حرکت والے الفاظ کی فہرست بنائی گئی', 'چیز کے نام کو کام سمجھنا', 'کیفیت کو کام سمجھنا'),
    G('S2', 'understand', "لفظ 'king' مذکر ہے یا مؤنث؟", ['masculine', 'feminine', 'action word'],
      "'king' ایک مرد کے لیے آتا ہے، اس لیے یہ masculine ہے۔", "بالکل ٹھیک! 'king' مذکر یعنی masculine ہے۔",
      "'feminine' عورت کے لیے ہوتا ہے؛ 'king' مرد ہے۔", "'king' کوئی کام نہیں بتاتا، یہ ایک اسم ہے۔",
      'سبق میں king اور queen کی جوڑی بنائی گئی', 'مذکر اور مؤنث کو الٹ سمجھنا', 'اسم کو کام سمجھنا'),
    G('S2', 'understand', "لفظ 'queen' مذکر ہے یا مؤنث؟", ['feminine', 'masculine', 'action word'],
      "'queen' ایک عورت کے لیے آتا ہے، اس لیے یہ feminine ہے۔", "شاباش! 'queen' مؤنث یعنی feminine ہے۔",
      "'masculine' مرد کے لیے ہوتا ہے؛ 'queen' عورت ہے۔", "'queen' کوئی کام نہیں بتاتا، یہ ایک اسم ہے۔",
      'سبق میں king اور queen کی جوڑی بنائی گئی', 'مذکر اور مؤنث کو الٹ سمجھنا', 'اسم کو کام سمجھنا'),
    G('S2', 'understand', "'brother' کا مؤنث کیا ہے؟", ['sister', 'mother', 'uncle'],
      "'brother' کا جوڑا 'sister' ہے۔", "بہت اچھے! 'brother' اور 'sister' جوڑا ہیں۔",
      "'mother' کا جوڑا 'father' ہے، 'brother' کا نہیں۔", "'uncle' خود مذکر ہے؛ مؤنث 'sister' ہے۔",
      'سبق میں رشتوں کے جوڑے بنائے گئے', 'کوئی بھی مؤنث رشتہ چن لینا', 'مذکر کو مؤنث سمجھنا'),
    G('S2', 'understand', 'ان میں سے کون سا لفظ feminine ہے؟', ['girl', 'boy', 'man'],
      "'girl' لڑکی کے لیے ہے، اس لیے feminine ہے۔", "درست! 'girl' مؤنث ہے۔",
      "'boy' لڑکے کے لیے ہے، یعنی masculine۔", "'man' مرد کے لیے ہے، یعنی masculine۔",
      'سبق میں boy اور girl کی مثال آئی', 'مذکر کو مؤنث سمجھنا', 'مذکر کو مؤنث سمجھنا'),
  ];
}

/** Half and half: the questions from one quiz, the explanations and feedback from the other. */
function crossed(questionsFrom, answersFrom) {
  return questionsFrom.map((q, i) => ({
    ...q, explanation: answersFrom[i].explanation, option_feedback: answersFrom[i].option_feedback,
  }));
}

/** Every string a child reads, as validate() reads it (the plain view, maths flattened). */
function childText(qs) {
  return qs.map((q) => V.plainView(V.normaliseFeedback(q))).flatMap((p) => [
    p.question, p.explanation, p.option_feedback.correct, ...p.options, ...Object.values(p.option_feedback.wrong),
  ]).join('\n');
}

const scriptComplaints = (qs) => V.validate(qs, CTX).errors.filter((e) => /^urdu script ratio /.test(e));

describe('1 · a correct Urdu maths quiz dense in English technical terms is accepted', () => {
  test('the fixture has the shape of the staging failure: under the old bar when LETTERS are counted', () => {
    // A guard on the fixture, not on the fix: if this ever passes 0.6 the test
    // below no longer reproduces the failure it was written for.
    expect(V.scriptRatio(childText(urduQuiz()))).toBeLessThan(0.6);
  });

  test('validate() accepts it — no script complaint and no other complaint', () => {
    const r = V.validate(urduQuiz(), CTX);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('an Urdu quiz on an English-grammar lesson, its questions quoting English sentences, is accepted', () => {
    // Also under the old bar by letters — the same flaw on a different subject.
    expect(V.scriptRatio(childText(grammarQuiz()))).toBeLessThan(0.6);
    const r = V.validate(grammarQuiz(), GRAMMAR_CTX);
    expect(r.errors).toEqual([]);
  });
});

describe('2 · a quiz that is not written in Urdu is still refused, with the prefix the retry note reads', () => {
  test('the model answering in English is refused', () => {
    const got = scriptComplaints(englishQuiz());
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(WRONG_SCRIPT_RE);
  });

  test('the model answering in Roman Urdu is refused by the script share, not only by the Roman-token list', () => {
    const got = scriptComplaints(romanQuiz());
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(WRONG_SCRIPT_RE);
  });

  test('English questions with Urdu feedback are refused — the questions are judged on their own', () => {
    // Pooled with the feedback, these questions would read as 64% Urdu.
    const got = scriptComplaints(crossed(englishQuiz(), urduQuiz()));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/in the questions/);
  });

  test('Urdu questions with English explanations and feedback are refused', () => {
    const got = scriptComplaints(crossed(urduQuiz(), englishQuiz()));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/in the explanations and feedback/);
  });

  test('the complaint says what to do, so the retry can act on it', () => {
    const [msg] = scriptComplaints(englishQuiz());
    expect(msg).toMatch(/^urdu script ratio 0\.\d\d < 0\.\d\d — /);
    expect(msg).toMatch(/words/);
  });
});

describe('3 · what counts as a word', () => {
  test('maths and bare numbers are not words, in either language', () => {
    expect(V.urduWordShare(`${F(2, 3)} اور ${F(3, 5)} میں کون سی fraction بڑی ہے؟`)).toBeCloseTo(6 / 7, 5);
    expect(V.urduWordShare('15 8 12')).toBe(1);
    expect(V.urduWordShare(`${F(1, 4)}، ${F(2, 3)}، ${F(5, 6)}`)).toBe(1);
  });

  test('a unit inside the maths is notation, not an English word', () => {
    expect(V.urduWordShare('لمبائی $5\\,\\text{cm}$ ہے')).toBe(1);
  });

  test('Urdu punctuation glued to an English word does not make it Urdu', () => {
    // "۔" and "،" sit in the Arabic block but are not letters.
    expect(V.urduWordShare('numerator۔ denominator، fraction')).toBe(0);
  });

  test('an English sentence stays English however long its words are', () => {
    expect(V.urduWordShare('The denominator tells how many equal parts the whole has.')).toBe(0);
  });

  test('the options are left out: an Urdu question may offer the English terms themselves as its answers', () => {
    const q = {
      question: 'لکیر کے نیچے والے عدد کو کیا کہتے ہیں؟',
      options: ['denominator', 'numerator', 'cross product'],
      explanation: 'نیچے والا عدد denominator ہے۔',
      option_feedback: { correct: 'درست!', wrong: { 1: 'یہ اوپر ہوتا ہے۔', 2: 'یہ دو fractions سے بنتا ہے۔' } },
    };
    const bp = V.urduShareByPart([q]);
    expect(bp.questions).toBe(1);
    expect(bp.min).toBeGreaterThan(V.URDU_WORD_SHARE_MIN);
  });
});
