/**
 * v27 G5 Maths Q2 i printed «Write the number 6,408,schedule in words.» with the answer «placeholder» and a
 * marking point «placeholder» (bd-5jmnfj.4.58.3). A placeholder word, or a word spliced into a number's
 * thousands groups, is a shortfall the writer is re-asked for; a paper that still carries one fails closed.
 *
 * Pure: the check reads the exam JSON, never throws.
 */

const { placeholderShortfall, placeholderNote } = require('../../bot/shared/services/assessment/fde-placeholder-check');

const paper = (items) => ({
  unseen: { subjective: { 'Word Problems': items } },
  _layout: { sections: [{ id: 'B', slots: [{ slot: 'maths.B.Q2', type: 'Word Problems' }] }] },
});
const bad = () => ({
  slot: 'maths.B.Q2', question: 'Write the number 6,408,schedule in words.', answer: 'placeholder', marks: 5,
  scheme: { points: [{ kind: 'A', text: 'placeholder', marks: 5 }] },
});
const good = () => ({
  slot: 'maths.B.Q2', question: 'Write the number 6,408,315 in words.',
  answer: 'Six million, four hundred and eight thousand, three hundred and fifteen', marks: 5,
  scheme: { points: [{ kind: 'A', text: 'The number in words', marks: 5 }] },
});

test('the v27 item is flagged once for its slot, naming the question and what was found', () => {
  const out = placeholderShortfall(paper([bad(), good()]));
  expect(out).toEqual([{ slot: 'maths.B.Q2', reason: 'placeholder', items: [expect.any(String)] }]);
  expect(out[0].items[0]).toMatch(/^Write the number 6,408,schedule in words\. → /);
  expect(out[0].items[0]).toMatch(/placeholder/);
  expect(out[0].items[0]).toMatch(/6,408,schedule/);
});

test('todo, tbd and lorem count as placeholders, in any printed field', () => {
  expect(placeholderShortfall(paper([{ ...good(), answer: 'TODO' }]))).toHaveLength(1);
  expect(placeholderShortfall(paper([{ ...good(), question: 'Find the sum. (tbd)' }]))).toHaveLength(1);
  expect(placeholderShortfall(paper([{ ...good(), scheme: { points: [{ kind: 'A', text: 'Lorem ipsum', marks: 5 }] } }]))).toHaveLength(1);
});

test('a word spliced into a number counts; an ordinary number or a missing space after a comma does not', () => {
  expect(placeholderShortfall(paper([{ ...good(), question: 'Write ninety,345 in words.' }]))).toHaveLength(1);
  expect(placeholderShortfall(paper([{ ...good(), question: 'Rs. 1,250 for 5 books; find the cost of 12.' }]))).toEqual([]);
  expect(placeholderShortfall(paper([{ ...good(), question: 'In 2024,the school opened.' }]))).toEqual([]);
});

test('a clean paper, a picture field and junk input give nothing', () => {
  expect(placeholderShortfall(paper([good()]))).toEqual([]);
  expect(placeholderShortfall(paper([{ ...good(), picture: { kind: 'scene', describe: 'a placeholder board' } }]))).toEqual([]);
  expect(placeholderShortfall(null)).toEqual([]);
  expect(placeholderShortfall({ unseen: 7 })).toEqual([]);
});

test('the note tells the writer what to replace; null when there is nothing to say', () => {
  const note = placeholderNote(placeholderShortfall(paper([bad()])));
  expect(note).toMatch(/placeholder/i);
  expect(note).toMatch(/6,408,schedule/);
  expect(placeholderNote([])).toBeNull();
  expect(placeholderNote([{ slot: 'maths.B.Q2', reason: 'giveaway', items: [] }])).toBeNull();
});
