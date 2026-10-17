/**
 * What a model writes for an Urdu Section A top-up: as many NEW items as the note asks for
 * («Write N new items»). A replay that answered every Section A call with its recorded first reply
 * wrote nothing new on a top-up, and the paper was filled by putting a held item back; a held
 * Section C give-away now never comes back, so a replayed top-up writes fresh items, as a model does.
 *
 * Antonym items on everyday words: no stem names another item's key, and no key is a word a
 * recorded Q3, Q4 or Q5 uses.
 */
const PAIRS = [
  ['سچ', 'جھوٹ'], ['امیر', 'غریب'], ['دن', 'رات'], ['اونچا', 'نیچا'], ['آسان', 'مشکل'], ['خوشی', 'غم'],
  ['گرم', 'ٹھنڈا'], ['نیا', 'پرانا'], ['دور', 'قریب'], ['اندر', 'باہر'], ['جیت', 'ہار'], ['آگے', 'پیچھے'],
  ['صبح', 'شام'], ['موٹا', 'پتلا'], ['کھلا', 'بند'], ['بھاری', 'ہلکا'],
];

function urduSpares(n) {
  return PAIRS.slice(0, n).map(([w, k]) => ({
    slot: 'urdu.A.Q1', main_question: 'صحیح جواب کا انتخاب کریں', question: `لفظ «${w}» کا متضاد کون سا ہے؟`,
    options: [`الف) ${k}`, 'ب) کتاب', 'ج) دریا', 'د) بادل'], answer: `الف) ${k}`, marks: 1,
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
