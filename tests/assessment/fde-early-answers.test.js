/**
 * Answer keys that break their own question (bd-5jmnfj.4.22, v12 sandbox papers 23 Oct 2026):
 * G2 English Q10 keyed "above" with only in/on/under/near/behind offered, Q14 keyed "!" when the
 * instruction offers . or ?, Q6 "man__o" hid one letter behind two blanks, and G1 English Q8 asked
 * "What is the child doing?" with "run" as the key. A slot's `answer_ok` says what a right key looks
 * like; an item that fails it sends its section back once, naming the item and the rule.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');

const slotOf = (grade, key, id) => Patterns.get(`fde_g${grade}_2026`).subjects[key].sections
  .flatMap((s) => s.slots).find((s) => s.slot === id);

describe('slots that say what a right key looks like', () => {
  test('G2 English Q10 keys only the five words the instruction offers', () => {
    const s = slotOf(2, 'english', 'g2.english.B.Q10');
    ['in', 'on', 'under', 'near', 'behind', 'Under '].forEach((answer) => expect(s.answer_ok({ answer })).toBe(true));
    ['above', 'beside', 'next to', 'over'].forEach((answer) => expect(s.answer_ok({ answer })).toBe(false));
    expect(s.prompt_rule).toMatch(/never above/i);
  });

  test('G2 English Q14 keys a full stop or a question mark, never "!"', () => {
    const s = slotOf(2, 'english', 'g2.english.C.Q14');
    expect(s.answer_ok({ answer: 'Where is my pencil?' })).toBe(true);
    expect(s.answer_ok({ answer: 'We play cricket on Sunday.' })).toBe(true);
    expect(s.answer_ok({ answer: 'What a lovely rainbow!' })).toBe(false);
    expect(s.prompt_rule).toMatch(/never an exclamation/i);
  });

  test('G2 English Q6 shows one blank for each missing letter', () => {
    const s = slotOf(2, 'english', 'g2.english.B.Q6');
    expect(s.answer_ok({ question: 'b__k', answer: 'book' })).toBe(true);
    expect(s.answer_ok({ question: 'sc _ _ f', answer: 'scarf' })).toBe(true);
    expect(s.answer_ok({ question: 'man__o', answer: 'mango' })).toBe(false);
    expect(s.answer_ok({ question: 'mango', answer: 'mango' })).toBe(false);
    expect(s.prompt_rule).toMatch(/one underscore for each missing letter/i);
  });

  test('G1 English Q8 keys the -ing word the question asks for', () => {
    const s = slotOf(1, 'english', 'g1.english.B.Q8');
    expect(s.answer_ok({ answer: 'running' })).toBe(true);
    expect(s.answer_ok({ answer: 'run' })).toBe(false);
    expect(s.prompt_rule).toMatch(/-ing/);
  });
});

describe('answerShortfall', () => {
  const P = Patterns.get('fde_g2_2026').subjects.english;
  const paper = (...items) => ({ unseen: { subjective: { T: items } } });
  const q10 = (question, answer) => ({ slot: 'g2.english.B.Q10', question, answer });

  test('names each slot with an item off its rule, and the items', () => {
    const out = Prompt.answerShortfall(paper(q10('The cat is ____ the table.', 'under'), q10('The bird is ____ the tree.', 'above'),
      { slot: 'g2.english.C.Q14', question: 'What a lovely rainbow', answer: 'What a lovely rainbow!' }), P);
    expect(out).toEqual([
      { slot: 'g2.english.B.Q10', reason: 'answer', items: ['The bird is ____ the tree. → above'] },
      { slot: 'g2.english.C.Q14', reason: 'answer', items: ['What a lovely rainbow → What a lovely rainbow!'] },
    ]);
  });

  test('a paper whose keys all fit their rules, or a slot with no rule, gives nothing', () => {
    expect(Prompt.answerShortfall(paper(q10('The cat is ____ the table.', 'under'), { slot: 'g2.english.B.Q7', question: 'hot', answer: 'xyz' }), P)).toEqual([]);
  });
});

test('answerNote tells the re-ask which items broke the rule and what the rule is', () => {
  const P = Patterns.get('fde_g2_2026').subjects.english;
  const note = Prompt.answerNote([{ slot: 'g2.english.B.Q10', reason: 'answer', items: ['The bird is ____ the tree. → above'] },
    { slot: 'g2.english.B.Q4', reason: 'picture' }], P);
  expect(note).toMatch(/Q10/);
  expect(note).toMatch(/The bird is ____ the tree\. → above/);
  expect(note).toContain(slotOf(2, 'english', 'g2.english.B.Q10').prompt_rule);
  expect(note).not.toMatch(/Q4/);
  expect(Prompt.answerNote([{ slot: 'g2.english.B.Q4', reason: 'picture' }], P)).toBeNull();
});
