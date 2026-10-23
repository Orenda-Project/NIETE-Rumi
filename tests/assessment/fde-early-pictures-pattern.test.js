/**
 * Grade 1-2 patterns carry pictures where a child who cannot yet read needs one.
 *
 * Amena, 23 Oct 2026: "Grade 1 should have lots of pictures in their assessments,
 * relevant ones as they aren't fluent readers yet, same goes for Grade 2"
 * (bd-5jmnfj.4.19). A word-level item now carries a picture of its own word;
 * a picture-naming slot prints picture + box with no stem; a slot that says
 * "from the box" prints its word bank (bd-5jmnfj.4.9).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const C = require('../../bot/shared/services/assessment/patterns/early/chrome');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');

const slots = {};
for (const id of ['fde_g1_2026', 'fde_g2_2026']) {
  for (const [subject, S] of Object.entries(Patterns.get(id).subjects)) {
    for (const sec of S.sections) for (const s of sec.slots) slots[`${id.slice(4, 6)} ${subject} ${s.label_en.replace('.', '')}`] = s;
  }
}

test.each([
  'g1 english Q3', 'g1 english Q4', 'g1 english Q6', 'g1 english Q11',
  'g1 urdu Q3', 'g1 urdu Q6', 'g1 urdu Q7',
  'g2 english Q3', 'g2 english Q6', 'g2 english Q8',
  'g2 urdu Q5',
])('%s now carries an object picture', (key) => {
  expect(slots[key].picture).toEqual(['object']);
  expect(slots[key].prompt_rule).toMatch(/picture: \{kind:"object", name\}/);
});

test.each([
  'g1 maths Q3', 'g1 maths Q7', 'g1 english Q1', 'g1 english Q7', 'g1 english Q12',
  'g1 urdu Q4', 'g1 general_knowledge Q5', 'g1 general_knowledge Q9', 'g1 general_knowledge Q10',
  'g2 maths Q4', 'g2 maths Q5', 'g2 english Q4',
])('%s is picture-only: picture and box, no stem', (key) => {
  expect(slots[key].picture_only).toBe(true);
});

test.each([
  'g1 english Q1', 'g1 english Q7', 'g1 english Q9', 'g1 urdu Q5', 'g1 general_knowledge Q1', 'g2 general_knowledge Q1',
])('%s prints its word bank', (key) => {
  expect(slots[key].print_words).toBe(true);
});

test('every early written slot asks for an answer box; G5 slots do not', () => {
  Object.values(slots).forEach((s) => expect(s.answer_box).toBe(true));
  const g5 = Patterns.get('fde_g5_2027').subjects;
  for (const S of Object.values(g5)) for (const sec of S.sections) for (const s of sec.slots) expect(s.answer_box).toBeFalsy();
});

test('a picture-only slot has nothing in its stem the child needs', () => {
  Object.entries(slots).filter(([, s]) => s.picture_only).forEach(([, s]) => {
    expect(s.picture).not.toBeNull();
    expect(s.prompt_rule).not.toMatch(/Stem: "What is this\?"/);
  });
});

test('G1 English Q3 says what its items do (the endings vary)', () => {
  expect(slots['g1 english Q3'].instruction_en).not.toMatch(/-at and -in/);
});

test('makeSlot carries the three flags, off by default', () => {
  const plain = C.makeSlot({ slot: 'x', label_en: 'Q1.', type: 'T', generate: 4, marks_each: 1, prompt_rule: 'r' });
  expect(plain).toMatchObject({ answer_box: true, picture_only: false, print_words: false });
  const on = C.makeSlot({ slot: 'y', label_en: 'Q1.', type: 'T', generate: 4, marks_each: 1, prompt_rule: 'r',
    picture: ['object'], picture_only: true, print_words: true });
  expect(on).toMatchObject({ picture_only: true, print_words: true });
});

test('the picture rule asks for exactly the item\'s own word, alone', () => {
  expect(Prompt.PICTURE_RULE).toMatch(/exactly/i);
  expect(Prompt.PICTURE_RULE).toMatch(/alone/i);
});

// Amena, 23 Oct 2026: "Q7 should have a word bank for students to pick the right word for the picture" (bd-5jmnfj.4.28).
test('G1 English Q7 names its pictures from a printed box', () => {
  const q7 = slots['g1 english Q7'];
  expect(q7.instruction_en).toMatch(/from the box/i);
  expect(q7.prompt_rule).toMatch(/"words" on the FIRST item/);
});

test('the picture rule never lets two items show the same thing', () => {
  expect(Prompt.PICTURE_RULE).toMatch(/same thing/i);
});

// Amena, 23 Oct 2026, after the Q7 box: the other G1 "Name the Picture" questions get the same box (bd-5jmnfj.4.29).
test.each(['g1 urdu Q4', 'g1 general_knowledge Q5'])('%s names its pictures from a printed box', (key) => {
  const s = slots[key];
  expect(s.print_words).toBe(true);
  expect(s.instruction_ur).toMatch(/خانے/);
  expect(s.prompt_rule).toMatch(/"words" on the FIRST item/);
});

// v13: the example pair مرغا in this rule drew a rooster that Q6 had already drawn (bd-5jmnfj.4.29).
test('G1 Urdu Q7 names no example nouns for the writer to copy', () => {
  expect(slots['g1 urdu Q7'].prompt_rule).not.toMatch(/[؀-ۿ]/);
});
