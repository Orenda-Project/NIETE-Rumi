/**
 * v27 Grade 1-2 keys marked things the paper never asked for (bd-5jmnfj.4.58.3):
 *   G1 English Q5 «tr_e» keyed the whole word «tree» behind "fill in the missing letter"; Q11 «m _ _ n» the same;
 *   G1 Maths Q5 and Q6, G2 Maths Q7, Q9 and Q11 paid for "the unit" / "the word books" behind a bare "Solve.";
 *   G1 English Q6 refused a real rhyme the key did not list; Q12 keyed «This is a egg.».
 * The early key pass fixes each in code after layout, so the writer's wording never reaches the teacher.
 *
 * Pure: {examJson, notes}; an item outside these slots is returned as it was.
 */

const { earlyKeyFixes } = require('../../bot/shared/services/assessment/fde-early-key-fixes');

const paper = (byType, slots) => ({
  unseen: { subjective: byType },
  _layout: { sections: [{ id: 'A', slots: slots.map(([slot, type]) => ({ slot, type })) }] },
});
const itemsOf = (ex) => Object.values(ex.unseen.subjective).flat();
const point = (kind, text, marks = 1) => ({ kind, text, marks });

describe('missing letters: the key is the letter, the word is accepted', () => {
  const p = () => paper({
    'Missing Letters': [{ slot: 'g1.english.A.Q5', question: 'tr_e', answer: 'tree', marks: 1, scheme: { points: [point('K', 'The full word tree')] } }],
    'Complete the Words': [
      { slot: 'g1.english.C.Q11', question: 'm _ _ n', answer: 'moon', marks: 1, scheme: { points: [point('K', 'moon')] } },
      { slot: 'g1.english.C.Q11', question: 'l _ _ f', answer: 'leaf', marks: 1, scheme: { points: [point('K', 'leaf')] } },
      { slot: 'g1.english.C.Q11', question: 'b _ g', answer: 'a', marks: 1, scheme: { points: [point('K', 'a')] } },
    ],
  }, [['g1.english.A.Q5', 'Missing Letters'], ['g1.english.C.Q11', 'Complete the Words']]);

  test('one blank: the one letter; the word goes to accept and the point names the missing letter', () => {
    const { examJson, notes } = earlyKeyFixes(p());
    const q5 = itemsOf(examJson).find((q) => q.question === 'tr_e');
    expect(q5.answer).toBe('e');
    expect(q5.scheme.accept).toEqual(expect.arrayContaining(['tree']));
    expect(q5.scheme.points[0].text).toMatch(/missing letter/i);
    expect(notes.some((n) => /tr_e/.test(n))).toBe(true);
  });

  test('two blanks: both letters in order; a key that is already the letter is kept', () => {
    const { examJson } = earlyKeyFixes(p());
    const by = Object.fromEntries(itemsOf(examJson).map((q) => [q.question, q]));
    expect(by['m _ _ n'].answer).toBe('oo');
    expect(by['l _ _ f'].answer).toBe('ea');
    expect(by['m _ _ n'].scheme.accept).toEqual(expect.arrayContaining(['moon']));
    expect(by['b _ g'].answer).toBe('a');
    expect(by['b _ g'].scheme.accept || []).not.toContain('a');
  });
});

describe('early maths word problems: a bare "Solve." pays for the number, not the unit word', () => {
  const g1 = () => paper({
    'Addition Word Problems': [{
      slot: 'g1.maths.B.Q5', question: 'Ali has 8 apples. Sara gives him 7 more. How many apples does Ali have now?',
      answer: '8 + 7 = 15 apples', marks: 1,
      scheme: { points: [point('A', 'Writes a correct addition sentence and the correct sum with the unit')] },
    }],
  }, [['g1.maths.B.Q5', 'Addition Word Problems']]);
  const g2 = () => paper({
    'Addition Word Problem': [{
      slot: 'g2.maths.B.Q7', question: 'A library has 245 books. It gets 132 more. How many books are there now?',
      answer: '245 + 132 = 377 books', marks: 3,
      scheme: {
        points: [point('M', 'A correct number sentence that adds 245 and 132'), point('M', 'A correct method for adding ones, tens and hundreds'), point('A', 'Answer 377 with the word books')],
        common_error: 'Subtracting instead of adding, or leaving out the word books.',
      },
    }],
  }, [['g2.maths.B.Q7', 'Addition Word Problem']]);

  test('G1: "with the unit" leaves the point', () => {
    const { examJson } = earlyKeyFixes(g1());
    expect(itemsOf(examJson)[0].scheme.points[0].text).toBe('Writes a correct addition sentence and the correct sum');
  });

  test('G2: the answer point is the number; the unit word is accepted, not required; the common error drops it', () => {
    const { examJson, notes } = earlyKeyFixes(g2());
    const q = itemsOf(examJson)[0];
    expect(q.scheme.points[1].text).toBe('Answer 377');
    expect(q.scheme.accept).toEqual(expect.arrayContaining(['377 books']));
    expect(q.scheme.common_error).toBe('Subtracting instead of adding.');
    expect(q.scheme.points).toHaveLength(2);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('rhyming pairs and "This is a"', () => {
  const p = () => paper({
    'Rhyming Pairs': [{ slot: 'g1.english.B.Q6', question: 'bat', answer: 'rat', marks: 1, scheme: { points: [point('K', 'rat')] } }],
    'This Is A': [
      { slot: 'g1.english.C.Q12', question: '', answer: 'This is a egg.', marks: 2, scheme: { points: [point('K', 'the word'), point('K', 'the sentence')] } },
      { slot: 'g1.english.C.Q12', question: '', answer: 'This is a flower.', marks: 2, scheme: { points: [point('K', 'the word'), point('K', 'the sentence')] } },
      { slot: 'g1.english.C.Q12', question: '', answer: 'This is an flower.', marks: 2, scheme: { points: [point('K', 'the word'), point('K', 'the sentence')] } },
    ],
  }, [['g1.english.B.Q6', 'Rhyming Pairs'], ['g1.english.C.Q12', 'This Is A']]);

  test('a rhyme point accepts any other real rhyme of the given word', () => {
    const { examJson } = earlyKeyFixes(p());
    expect(itemsOf(examJson)[0].scheme.points[0].text).toMatch(/rat.*any other real word that rhymes with bat/);
  });

  test('a / an follows the first letter of the object; a right sentence is kept', () => {
    const { examJson } = earlyKeyFixes(p());
    expect(itemsOf(examJson).filter((q) => q.slot === 'g1.english.C.Q12').map((q) => q.answer))
      .toEqual(['This is an egg.', 'This is a flower.', 'This is a flower.']);
  });
});

test('other slots, and junk input, come back unchanged with no notes', () => {
  const p = paper({ MCQs: [{ slot: 'g1.english.A.Q10', question: 'A', answer: 'a', options: ['a', 'b'] }] }, [['g1.english.A.Q10', 'Match Capital and Small Letters']]);
  expect(earlyKeyFixes(p)).toEqual({ examJson: p, notes: [] });
  expect(earlyKeyFixes(null).notes).toEqual([]);
});
