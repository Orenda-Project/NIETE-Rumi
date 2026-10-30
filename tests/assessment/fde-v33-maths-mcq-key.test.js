/**
 * bd-5jmnfj.33.4 — G3 Maths Q1 vii (v32 review, Should-fix): the stem asks for a multiplication sentence
 * equal to 4 x 6, the options are "4 + 6", "4 x 4", "24" and the key is the bare number 24. midKeyFixes cannot
 * re-key it (4 x 4 is not 24), so the item must reach the re-ask: mcqKeyFlags gives the shortfall flag the
 * generation service concatenates onto `short`, mcqKeyNote the sentence the re-ask prompt shows.
 * The item is the real one from g3-maths-ch3-exam.json.
 */

const { mcqKeyFlags, mcqKeyNote } = require('../../bot/shared/services/assessment/fde-maths-slips');
const { midKeyFixes } = require('../../bot/shared/services/assessment/fde-mid-key-fixes');

const Q1VII = { main_question: 'Choose the correct option', question: 'Which multiplication sentence gives the same total as 4 x 6?',
  options: ['a) 4 + 6', 'b) 4 x 4', 'c) 24'], marks: 1, answer: 'c) 24', slot: 'g3.maths.A.mcq' };
const Q1II = { main_question: 'Choose the correct option', question: 'What is 9 x 6?', options: ['a) 54', 'b) 45', 'c) 63'], marks: 1, answer: 'a) 54', slot: 'g3.maths.A.mcq' };
const exam = (items) => ({ unseen: { objective: { MCQs: items } } });

describe('G3 Maths Q1 vii reaches the re-ask', () => {
  test('mcqKeyFlags flags g3.maths.A.mcq with the stem and the key', () => {
    const flags = mcqKeyFlags(exam([Q1II, Q1VII]));
    expect(flags).toEqual([expect.objectContaining({ slot: 'g3.maths.A.mcq', reason: 'mcq_multiplication_key', stem: Q1VII.question, key: 'c) 24', product: '4 x 6' })]);
  });

  test('the note says the key is not a multiplication sentence equal to 4 x 6', () => {
    const note = mcqKeyNote(mcqKeyFlags(exam([Q1VII])));
    expect(note).toContain('the key c) 24 is not a multiplication sentence equal to 4 x 6');
    expect(note).toContain(Q1VII.question);
  });

  test('midKeyFixes leaves the key (4 x 4 is not 24), so the flag survives the fixes', () => {
    const fixed = midKeyFixes(exam([Q1VII]), { subject: 'maths' }).examJson;
    expect(mcqKeyFlags(fixed)).toHaveLength(1);
  });

  test('an item midKeyFixes re-keys (options 4 + 6 / 6 x 4 / 24) is not flagged', () => {
    const q = { ...Q1VII, options: ['a) 4 + 6', 'b) 6 x 4', 'c) 24'] };
    expect(mcqKeyFlags(midKeyFixes(exam([q]), { subject: 'maths' }).examJson)).toEqual([]);
  });

  test('no flag for an ordinary MCQ, a non-Maths slot, or no note without flags', () => {
    expect(mcqKeyFlags(exam([Q1II]))).toEqual([]);
    expect(mcqKeyFlags(exam([{ ...Q1VII, slot: 'g5.maths.A.mcq' }]))).toEqual([]);
    expect(mcqKeyNote([])).toBeNull();
    expect(mcqKeyNote(undefined)).toBeNull();
  });
});

describe('answerRepeats carries the flag into `short`', () => {
  const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
  test('Q1 vii gives a g3.maths.A.mcq flag whose note reads as the re-ask text', () => {
    const f = answerRepeats(exam([Q1II, Q1VII])).filter((x) => x.reason === 'mcq_multiplication_key');
    expect(f.map((x) => x.slot)).toEqual(['g3.maths.A.mcq']);
    expect(mcqKeyNote(f)).toContain('is not a multiplication sentence equal to 4 x 6');
  });
});
