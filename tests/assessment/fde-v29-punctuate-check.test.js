/**
 * v28 G5 English Q3 (Punctuation) printed «on sunday pinky asked her friends where the library was they walked
 * there together...» and keyed «Pinky asked her friends, "Where is the library?"» with a mark for the question
 * mark (bd-5jmnfj.4.58.4). The model answer is the printed words with capitals and punctuation added; a model
 * whose words differ from the printed passage is a shortfall the writer is re-asked for once, then the paper
 * fails closed (as the placeholder check does).
 *
 * Pure: the check reads the exam JSON, never throws.
 */

const { punctuateShortfall, punctuateNote } = require('../../bot/shared/services/assessment/fde-punctuate-check');

const PASSAGE = 'on sunday pinky asked her friends where the library was they walked there together and found the doors open what a lovely surprise it was for pinkys class';
const paper = (items, type = 'Punctuation') => ({
  unseen: { subjective: { [type]: items } },
  _layout: { sections: [{ id: 'C', slots: [{ slot: 'english.C.Q3', type }] }] },
});
const item = (answer, question = PASSAGE) => ({ slot: 'english.C.Q3', question, answer, marks: 5 });

const V28 = 'On Sunday, Pinky asked her friends, "Where is the library?" They walked there together and found the doors open. What a lovely surprise it was for Pinky\'s class!';
const GOOD = 'On Sunday, Pinky asked her friends where the library was. They walked there together and found the doors open. What a lovely surprise it was for Pinky\'s class!';

test('the v28 model answer (reported question turned into direct speech) is flagged, naming both wordings', () => {
  const out = punctuateShortfall(paper([item(V28)]));
  expect(out).toEqual([{ slot: 'english.C.Q3', reason: 'punctuate_words', items: [expect.any(String)] }]);
  expect(out[0].items[0]).toMatch(/where is the library/i);
});

test('the printed words with punctuation and capitals added pass; apostrophes and hyphens do not count as words', () => {
  expect(punctuateShortfall(paper([item(GOOD)]))).toEqual([]);
  expect(punctuateShortfall(paper([item('Well-known Ali didn\'t go.', 'well known ali didnt go')]))).toEqual([]);
});

test('a dropped or added word is flagged', () => {
  expect(punctuateShortfall(paper([item(GOOD.replace('together ', ''))]))).toHaveLength(1);
  expect(punctuateShortfall(paper([item(GOOD.replace('class', 'class today'))]))).toHaveLength(1);
});

test('only Punctuation items are read; junk input gives nothing', () => {
  expect(punctuateShortfall(paper([item(V28)], 'Paragraph Writing'))).toEqual([]);
  expect(punctuateShortfall(paper([{ slot: 'english.C.Q3', question: PASSAGE }]))).toEqual([]);
  expect(punctuateShortfall(null)).toEqual([]);
  expect(punctuateShortfall({ unseen: 7 })).toEqual([]);
});

test('the re-ask note names the rule; no note for other shortfalls', () => {
  const note = punctuateNote(punctuateShortfall(paper([item(V28)])));
  expect(note).toMatch(/exactly the printed words/);
  expect(note).toMatch(/never turn a reported question into direct speech/);
  expect(punctuateNote([{ slot: 'x', reason: 'placeholder', items: ['a'] }])).toBeNull();
});
