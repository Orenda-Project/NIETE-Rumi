/**
 * Two small pieces of copy the ✓/✗ list and an added question need.
 *
 * A list row's description is 20 code points, and it carries the marks first,
 * so the type name has to be short enough to fit after them. And a question she
 * adds to a type the paper does not have yet needs the shared instruction a
 * printed type always carries, in the language the PAPER is set in.
 */
const V = require('../../bot/shared/services/assessment/assessment-vocabulary');

const cp = (s) => [...s].length;

describe('shortType — a question type short enough for a list row', () => {
  test.each([
    ['MCQs', 'MCQ'], ['MSQs', 'MSQ'], ['True/False', 'T/F'], ['True / False', 'T/F'],
    ['Fill in the Blanks', 'Blanks'], ['Match the Column', 'Match'], ['Brief Answers', 'Brief'],
    ['Short Questions', 'Short'], ['Long Question', 'Long'], ['Long Questions', 'Long'],
    ['Long Answers', 'Long'], ['Detailed Answers', 'Long'], ['Word Meanings', 'Meanings'],
    ['Word Sentences', 'Sentences'], ['Comprehension Passage', 'Passage'],
    ['Missing Letters', 'Letters'], ['Circle the Correct Answer', 'Circle'],
    ['Rewrite Sentences', 'Rewrite'], ['Word Problems', 'Problems'],
    ['Restricted Response Question', 'Short'], ['Essay Writing', 'Essay'], ['Letter Writing', 'Letter'],
  ])('%s → %s', (type, short) => {
    expect(V.shortType(type)).toBe(short);
  });

  test('anything else is its first word, at most 10 code points, never empty', () => {
    expect(V.shortType('Graphs & Geometric Problems')).toBe('Graphs');
    expect(cp(V.shortType('Supercalifragilistic words'))).toBeLessThanOrEqual(10);
    expect(V.shortType('')).toBe('');
  });

  test('every mapped value fits in 10 code points', () => {
    for (const v of Object.values(V.SHORT_TYPE)) expect(cp(v)).toBeLessThanOrEqual(10);
  });
});

describe('defaultInstruction — the instruction over a type she started', () => {
  test.each(['mcq', 'short', 'long', 'fill'])('%s has English and Urdu', (kind) => {
    const en = V.defaultInstruction(kind, false);
    const ur = V.defaultInstruction(kind, true);
    expect(en).toMatch(/[A-Za-z]/);
    expect(ur).toMatch(/[؀-ۿ]/);
  });
  test('the copy the plan fixed', () => {
    expect(V.defaultInstruction('mcq', false)).toBe('Choose the correct option.');
    expect(V.defaultInstruction('fill', true)).toBe('خالی جگہ پُر کریں۔');
  });
});
