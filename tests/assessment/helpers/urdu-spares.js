/**
 * What a model writes for an Urdu Section A top-up: as many NEW items as the note asks for
 * («Write N new items»). A replay that answered every Section A call with its recorded first reply
 * wrote nothing new on a top-up, and the paper was filled by putting a held item back; a held
 * Section C give-away now never comes back, so a replayed top-up writes fresh items, as a model does.
 *
 * Word-meaning items on everyday words (a grammar concept is asked once on every scope, so spares
 * that were all antonyms would be held): no stem names another item's key, and no word is one a
 * recorded Q3, Q4 or Q5 uses.
 */
const PAIRS = [
  ['دریا', 'پانی کا بڑا بہاؤ'], ['کتب خانہ', 'کتابوں کا گھر'], ['باغبان', 'باغ کی دیکھ بھال کرنے والا'], ['درزی', 'کپڑے سینے والا'],
  ['نانبائی', 'روٹی پکانے والا'], ['موچی', 'جوتے بنانے والا'], ['کسان', 'کھیتی باڑی کرنے والا'], ['مچھیرا', 'مچھلیاں پکڑنے والا'],
  ['ڈاکیا', 'خط پہنچانے والا'], ['معمار', 'عمارت بنانے والا'], ['جولاہا', 'کپڑا بننے والا'], ['لوہار', 'لوہے کا کام کرنے والا'],
  ['سنار', 'زیور بنانے والا'], ['بڑھئی', 'لکڑی کا کام کرنے والا'], ['حلوائی', 'مٹھائی بنانے والا'], ['کمہار', 'مٹی کے برتن بنانے والا'],
];

function urduSpares(n) {
  return PAIRS.slice(0, n).map(([w, k]) => ({
    slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» سے کیا مراد ہے؟`,
    options: [`الف) ${k}`, 'ب) پہاڑ کی چوٹی', 'ج) آسمان کا رنگ', 'د) رات کا وقت'], answer: `الف) ${k}`, marks: 1,
  }));
}

/** The count a Section A top-up prompt asks for, or null for any other prompt. */
function topUpCount(prompt) {
  const m = /Q1 needs \d+ more\. Write (\d+) new items/.exec(String(prompt));
  return m ? Number(m[1]) : null;
}

/** A Section A reply tree of spares for a top-up prompt, or null for any other prompt. */
function topUpTree(prompt) {
  const n = topUpCount(prompt);
  return n == null ? null : { objective: { MCQs: urduSpares(n) } };
}

module.exports = { urduSpares, topUpCount, topUpTree };
