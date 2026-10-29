/**
 * v25 G2 Urdu keys a teacher would mark against wrongly (bd-5jmnfj.4.57):
 *  - Q2 iv keyed «خواب، مکڑا، ٹڈی» as the alphabetical order; ٹ comes before خ and م.
 *  - Q3 iv keyed «ٹانگیں», a word not in the box (بانی، کراچی، تاجر، بسترے).
 *  - Q1 viii asked «کس نے ...» (who) and keyed a whole sentence, with two names as the wrong choices.
 */

const { keyShortfall } = require('../../bot/shared/services/assessment/fde-key-checks');
const { dealScrambles, alphabetKey } = require('../../bot/shared/services/assessment/fde-scramble-block');

const P = {
  sections: [{ id: 'A', slots: [
    { slot: 'g2.urdu.A.Q1', type: 'MCQs', shape: 'mcq' },
    { slot: 'g2.urdu.A.Q2', type: 'Alphabetical Order' },
    { slot: 'g2.urdu.A.Q3', type: 'Complete the Sentences' },
  ] }],
};
const blank = (q, answer, words) => ({ slot: 'g2.urdu.A.Q3', question: q, answer, ...(words ? { words } : {}) });
const V25_Q3 = [
  blank('محمد علی جناح پاکستان کے ___ ہیں۔', 'بانی', ['بانی', 'کراچی', 'تاجر', 'بسترے']),
  blank('قائداعظم ___ میں پیدا ہوئے۔', 'کراچی'),
  blank('ان کے والد ایک معروف ___ تھے۔', 'تاجر'),
  blank('بندروں نے لڑکے کی ___ پکڑ رکھی تھیں۔', 'ٹانگیں'),
];
const V25_Q1_VIII = {
  slot: 'g2.urdu.A.Q1',
  question: 'مکالمے «موسم بہار» میں کس نے بھنورے سے کہا کہ مجھے تمھاری آواز پسند نہیں آئی؟',
  options: ['الف) بھنورے نے ٹڈی کی آواز کو ناپسند کیا', 'ب) مکڑا', 'ج) تتیا'],
  answer: 'الف) بھنورے نے ٹڈی کی آواز کو ناپسند کیا',
};
const exam = (items) => ({ unseen: { subjective: { Any: items } } });

test('a box word key that is not in the box is flagged, with the box named', () => {
  const flags = keyShortfall(exam(V25_Q3), P);
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ slot: 'g2.urdu.A.Q3', reason: 'answer' });
  expect(flags[0].items).toHaveLength(1);
  expect(flags[0].items[0]).toContain('ٹانگیں');
  expect(flags[0].items[0]).toContain('بسترے');
});

test('a box whose keys are all in it passes', () => {
  const ok = [...V25_Q3.slice(0, 3), blank('سونے کے لیے ___ بچھائے گئے۔', 'بسترے')];
  expect(keyShortfall(exam(ok), P)).toEqual([]);
});

test('a who question keyed with a sentence is flagged; one keyed with a name passes', () => {
  const flags = keyShortfall(exam([V25_Q1_VIII]), P);
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ slot: 'g2.urdu.A.Q1', reason: 'answer' });
  const named = { ...V25_Q1_VIII, options: ['الف) ٹڈی', 'ب) مکڑا', 'ج) تتیا'], answer: 'الف) ٹڈی' };
  expect(keyShortfall(exam([named]), P)).toEqual([]);
  const en = { slot: 'g2.urdu.A.Q1', question: 'Who helped the boy?', options: ['a) The monkey ran up the tree fast', 'b) Ali'], answer: 'a) The monkey ran up the tree fast' };
  expect(keyShortfall(exam([en]), P)).toHaveLength(1);
});

test('the alphabetical key is worked out, not taken from the model', () => {
  expect(alphabetKey(['خواب', 'مکڑا', 'ٹڈی'])).toEqual(['ٹڈی', 'خواب', 'مکڑا']);
  expect(alphabetKey(['انگور', 'تربوز', 'بندر'])).toEqual(['انگور', 'بندر', 'تربوز']);
  expect(alphabetKey(['آم', 'اب'])).toEqual(['اب', 'آم']);
  expect(alphabetKey(['pen', 'bat', 'cat'])).toEqual(['bat', 'cat', 'pen']);
  expect(alphabetKey(['خواب', 'x٭'])).toBeNull();
});

test('v25 G2 Urdu Q2 iv: the paper keys ٹڈی، خواب، مکڑا and the question is still mixed', () => {
  const q = { slot: 'g2.urdu.A.Q2', question: 'مکڑا، خواب، ٹڈی', answer: 'خواب، مکڑا، ٹڈی', scheme: { accept: ['خواب مکڑا ٹڈی'], points: [] } };
  const out = dealScrambles({
    unseen: { subjective: { 'Alphabetical Order': [q] } },
    _layout: { sections: [{ id: 'A', slots: [{ slot: 'g2.urdu.A.Q2', type: 'Alphabetical Order' }] }] },
  });
  const got = out.unseen.subjective['Alphabetical Order'][0];
  expect(got.answer).toBe('ٹڈی، خواب، مکڑا');
  expect(got.scheme.accept).toEqual(['ٹڈی خواب مکڑا']);
  expect(got.question).not.toBe('ٹڈی، خواب، مکڑا');
});
