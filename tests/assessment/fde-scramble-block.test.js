/**
 * Scramble items and word boxes a child can answer without reading (bd-5jmnfj.4.50.9).
 * v22 G1 English Q2 moved the last letter to the front of every item, Q4 spelled four of five
 * words backwards, G1 Urdu Q2 iii-v printed the key reversed, and G1 Urdu Q4's sorted word box
 * printed گھڑی above its own picture. Each scramble is mixed again (never the key, a turn of it or
 * the key backwards, never another answer on the paper) and a box never puts a word at its item.
 */

const { dealScrambles, parseScramble } = require('../../bot/shared/services/assessment/fde-scramble-block');
const { bankOrder } = require('../../bot/shared/services/assessment/fde-match-block');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const english = require('./fixtures/early/g1-english-exam.json');

const item = (slot, question, answer) => ({ slot, question, answer, scheme: { accept: [answer], points: [] } });
const V22_EN_Q2 = ['d b c|b c d', 'g e f|e f g', 'm k l|k l m', 'p n o|n o p', 't r s u|r s t u']
  .map((s) => item('g1.english.A.Q2', ...s.split('|')));
const V22_EN_Q4 = ['n u s|sun', 'g o d|dog', 'e n p|pen', 'r a c|car', 't a h|hat']
  .map((s) => item('g1.english.A.Q4', ...s.split('|')));
const V22_UR_Q2 = ['ج، ب، پ|ب، پ، ج', 'س، ا، ب|ا، ب، س', 'م، د، ت|ت، د، م', 'ک، ز، ر|ر، ز، ک', 'ن، ع، ط|ط، ع، ن']
  .map((s) => item('g1.urdu.A.Q2', ...s.split('|')));
const paper = (byType, slots) => ({
  unseen: { subjective: { ...byType, Other: [{ slot: 'x.Q9', question: 'd b c', answer: 'b c d' }] } },
  _layout: { sections: [{ id: 'A', slots: [...slots, { slot: 'x.Q9', type: 'Short' }] }] },
});
const v22 = () => paper(
  { 'Alphabetical Order': [...V22_EN_Q2, ...V22_UR_Q2], 'Unscramble Words': V22_EN_Q4 },
  [{ slot: 'g1.english.A.Q2', type: 'Alphabetical Order' }, { slot: 'g1.urdu.A.Q2', type: 'Alphabetical Order' },
    { slot: 'g1.english.A.Q4', type: 'Unscramble Words' }],
);

/** The shapes a child reads off without reading: the key, any turn of it, the key backwards. */
function giveaway(q) {
  const { parts, truth } = parseScramble(q);
  const n = truth.length;
  const turns = truth.map((_, k) => truth.map((__, i) => truth[(i + k) % n]).join('|'));
  return turns.includes(parts.join('|')) || [...truth].reverse().join('|') === parts.join('|');
}

test('v22 itself: nearly every scramble is a giveaway', () => {
  [...V22_UR_Q2, ...V22_EN_Q4].forEach((q) => expect(giveaway(q)).toBe(true));
  expect(V22_EN_Q2.filter(giveaway).length).toBe(4);
});

test('no scramble is the key, a turn of it or the key backwards; the key is untouched', () => {
  const before = v22();
  const out = dealScrambles(before).unseen.subjective;
  [...out['Alphabetical Order'], ...out['Unscramble Words']].forEach((q) => {
    expect(parseScramble(q)).not.toBeNull();
    expect(giveaway(q)).toBe(false);
  });
  const keys = (t) => before.unseen.subjective[t].map((q) => [q.answer, q.scheme]);
  expect(out['Alphabetical Order'].map((q) => [q.answer, q.scheme])).toEqual(keys('Alphabetical Order'));
  expect(out['Unscramble Words'].map((q) => [q.answer, q.scheme])).toEqual(keys('Unscramble Words'));
});

test('Urdu keeps its commas; an unscramble never spells another answer on the paper', () => {
  const out = dealScrambles(v22()).unseen.subjective;
  out['Alphabetical Order'].filter((q) => q.slot === 'g1.urdu.A.Q2').forEach((q) => expect(q.question).toMatch(/^\S، \S، \S$/));
  const answers = new Set([...V22_EN_Q4, ...V22_EN_Q2].map((q) => q.answer.replace(/\s/g, '')));
  out['Unscramble Words'].forEach((q) => expect(answers.has(q.question.replace(/\s/g, ''))).toBe(false));
});

test('the items of a slot are not all mixed the same way', () => {
  const out = dealScrambles(v22()).unseen.subjective['Alphabetical Order'].filter((q) => q.slot === 'g1.english.A.Q2');
  const shape = (q) => { const p = parseScramble(q); return p.parts.map((t) => p.truth.indexOf(t)).join(); };
  expect(new Set(out.slice(0, 4).map(shape)).size).toBeGreaterThan(1);
});

test('the sandbox fixture gets the same treatment, the same way twice', () => {
  const once = dealScrambles(english);
  expect(dealScrambles(english)).toEqual(once);
  Object.values(once.unseen).flatMap((bt) => Object.values(bt)).filter(Array.isArray).flat()
    // "b e e" has no mix that is not a giveaway, so it is left as it is.
    .filter((q) => /^g1\.english\.A\.Q[24]$/.test(q.slot) && parseScramble(q) && new Set(parseScramble(q).truth).size > 2).forEach((q) => expect(giveaway(q)).toBe(false));
});

test('an item it cannot read, and other slots, are left as they are', () => {
  const odd = item('g1.english.A.Q4', 'x y z', 'cat');
  const exam = paper({ 'Unscramble Words': [odd] }, [{ slot: 'g1.english.A.Q4', type: 'Unscramble Words' }]);
  const out = dealScrambles(exam).unseen.subjective;
  expect(out['Unscramble Words'][0]).toEqual(odd);
  expect(out.Other).toEqual(exam.unseen.subjective.Other);
});

describe('a word box never prints a word at its own item', () => {
  const at = (answers, order) => order.filter((w, i) => w === answers[i]).length;
  const UR_Q4 = ['ہاتھی', 'مچھلی', 'گھڑی', 'پھول', 'کریلا'];
  const EN_Q7 = ['apple', 'book', 'spoon', 'frog', 'duck', 'bag', 'banana', 'chair', 'cow'];

  test.each([[UR_Q4], [EN_Q7]])('%j', (answers) => {
    const order = bankOrder([...answers].reverse(), answers);
    expect([...order].sort()).toEqual([...answers].sort());
    expect(at(answers, order)).toBe(0);
    const n = answers.length;
    answers.forEach((_, k) => expect(order).not.toEqual(answers.map((__, i) => answers[(i + k) % n])));
    expect(order).not.toEqual([...answers].reverse());
  });

  test('a box that is not one word per item stays sorted', () => {
    expect(bankOrder(['b', 'c', 'a', 'z'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'z']);
  });

  test('the printed G1 Urdu Q4 box', () => {
    const SLOT = 'g1.urdu.B.Q4';
    const items = UR_Q4.map((w, i) => ({ slot: SLOT, answer: w, marks: 1, ...(i ? {} : { words: UR_Q4 }),
      picture: { kind: 'object', name: `p${i}`, src: 'data:image/png;base64,AAAA' } }));
    const examJson = { unseen: { subjective: { 'Name the Picture': items } },
      _layout: { ...english._layout, medium: 'ur', subject: 'urdu', sections: [{ id: 'B', label_ur: 'تحریر', slots: [{
        slot: SLOT, type: 'Name the Picture', shape: 'short', numbering: 'roman', label_ur: 'سوال 4', marks_each: 1,
        answer_box: true, print_words: true, picture_only: true, category: 'subjective', attempt: 5, generate: 5 }] }] } };
    const html = R.renderPaper({ examJson, grade: 1, subject: 'urdu' });
    const box = [...html.match(/<div class="word-box bank">(.*?)<\/div>/)[1].matchAll(/<span class="w">(.*?)<\/span>/g)].map((m) => m[1]);
    expect([...box].sort()).toEqual([...UR_Q4].sort());
    expect(at(UR_Q4, box)).toBe(0);
  });
});
