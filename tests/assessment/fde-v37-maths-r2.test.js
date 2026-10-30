/**
 * v37 round 6 maths should-fix findings (bd-5jmnfj.4.58): G1 Q5/Q6 story question, G1 Q5/Q6 read-aloud note,
 * G1 Q8 compare pairs, G5 Q2 / Section C / Q4 prompt rules.
 */
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { askStoryQuestion } = require('../../bot/shared/services/assessment/fde-g1-story-question');
const { earlyKeyFixes } = require('../../bot/shared/services/assessment/fde-early-key-fixes');

const slotOf = (pid, slot) => Patterns.subjectOf(pid, 'maths').sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
const g1 = (slot) => slotOf('fde_g1_2026', slot);
const g5 = (slot) => slotOf('fde_g5_2027', slot);

describe('G1 Maths Q5/Q6 story ends with its question', () => {
  test('Q5 story with no question gets " How many now?"', () => {
    const notes = [];
    const q = askStoryQuestion({ slot: 'g1.maths.B.Q5', question: 'Ali has 6 marbles. He finds 7 more marbles.' }, notes);
    expect(q.question).toBe('Ali has 6 marbles. He finds 7 more marbles. How many now?');
    expect(notes).toHaveLength(1);
  });
  test('Q6 story with no question gets " How many are left?"', () => {
    expect(askStoryQuestion({ slot: 'g1.maths.B.Q6', question: 'Sara has 9 pens. She gives away 4.' }, []).question)
      .toBe('Sara has 9 pens. She gives away 4. How many are left?');
  });
  test('a story that already asks, and other slots, are untouched', () => {
    const asked = { slot: 'g1.maths.B.Q5', question: 'Sara has 8 pencils. She gets 5 more. How many now?' };
    expect(askStoryQuestion(asked, [])).toBe(asked);
    const other = { slot: 'g2.maths.B.Q7', question: 'Ali has 6 marbles.' };
    expect(askStoryQuestion(other, [])).toBe(other);
  });
  test('runs inside earlyKeyFixes on the G1 word-problem slot', () => {
    const exam = {
      _layout: { sections: [{ slots: [{ slot: 'g1.maths.B.Q5', type: 'Addition Word Problems' }] }] },
      seen: {}, unseen: { subjective: { 'Addition Word Problems': [{ slot: 'g1.maths.B.Q5', question: 'Ali has 6 marbles. He finds 7 more.', answer: '13', scheme: { points: [] } }] } },
    };
    const out = earlyKeyFixes(exam).examJson.unseen.subjective['Addition Word Problems'][0];
    expect(out.question).toMatch(/How many now\?$/);
  });
  test.each(['g1.maths.B.Q5', 'g1.maths.B.Q6'])('%s prompt rule makes each story end with its question', (slot) => {
    expect(g1(slot).prompt_rule).toMatch(/ends with its question/);
    expect(g1(slot).prompt_rule).toMatch(/How many/);
  });
});

describe('G1 Maths Q5/Q6 read-aloud', () => {
  test('instruction says listen; Section B prints a teacher note that the teacher reads each story aloud', () => {
    expect(g1('g1.maths.B.Q5').instruction_en).toBe('Listen to the story and solve. Show your working.');
    expect(g1('g1.maths.B.Q6').instruction_en).toBe('Listen to the story and solve. Show your working.');
    const b = Patterns.subjectOf('fde_g1_2026', 'maths').sections.find((s) => s.id === 'B');
    expect(b.note_en).toMatch(/teacher reads each story in Q5 and Q6 aloud/i);
  });
});

describe('G1 Maths Q8 compare pairs', () => {
  const r = g1('g1.maths.B.Q8').prompt_rule;
  test('at least double the difference, drawn plainly', () => {
    expect(r).toMatch(/at least double/);
    expect(r).toMatch(/picture draws that difference plainly/);
  });
  test('heavier/lighter pairs are known without the picture', () => {
    expect(r).toMatch(/a brick and a feather/);
    expect(r).toMatch(/never judged from drawn size/);
  });
  test('the word list no longer invites tree/lamp post or leaf', () => {
    expect(r).not.toMatch(/lamp post/);
    expect(r).not.toMatch(/\bleaf\b/);
  });
});

describe('G5 Maths prompt rules', () => {
  test('Q2 choice block: every item matching demand', () => {
    const r = g5('maths.B.Q2').prompt_rule;
    expect(r).toMatch(/each a 5-mark two-or-three-step worked problem of similar working length/);
    expect(r).toMatch(/no item made of three trivial parts/);
    expect(r).toMatch(/no single long-multiplication-only item/);
  });
  test('Section C: every item under "any three" has two linked steps', () => {
    const r = g5('maths.C.Q4-8').prompt_rule;
    expect(r).toMatch(/every item under .any three. has two linked steps/);
    expect(r).toMatch(/average then a comparison/);
    expect(r).toMatch(/missing angle then a second angle/);
  });
  test('Q4 angle choices are of equal demand, no straight angle, same steps paid', () => {
    const r = g5('maths.C.Q4-8').prompt_rule;
    expect(r).toMatch(/never a straight angle/);
    expect(r).toMatch(/acute, obtuse, reflex, a supplementary pair, a complementary pair/);
    expect(r).toMatch(/same steps/);
    expect(r).toMatch(/`questions` = exactly three/);
  });
});
