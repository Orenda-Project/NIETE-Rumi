/**
 * One paper never asks a fact twice (bd-5jmnfj.4.16). v17 G2 GK asked the capital in
 * Q3 and Q5, the national animal in Q2 and Q5, and the root in Q2, Q6 and Q9. Each
 * section is now written after the ones before it and told what they asked.
 */

const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const tree = (items) => ({ unseen: { objective: { MCQs: items } } });

describe('askedNote', () => {
  test('is null when nothing has been written yet', () => {
    expect(Prompt.askedNote([])).toBeNull();
    expect(Prompt.askedNote([tree([])])).toBeNull();
  });

  test('lists each earlier question with its answer and forbids asking them again', () => {
    const note = Prompt.askedNote([
      tree([{ slot: 'a', question: 'پاکستان کا قومی جانور کون سا ہے؟', answer: 'مارخور' }]),
      tree([{ slot: 'b', question: 'لال بتی پر کیا کرتے ہیں؟', answer: 'رک جاتے ہیں' }]),
    ]);
    expect(note).toContain('پاکستان کا قومی جانور کون سا ہے؟ → مارخور');
    expect(note).toContain('لال بتی پر کیا کرتے ہیں؟ → رک جاتے ہیں');
    expect(note).toMatch(/already asks/);
    expect(note).toMatch(/never ask any of these facts again/i);
  });
});

test('the picture rule also says no fact is asked twice on one paper', () => {
  expect(Prompt.PICTURE_RULE).toMatch(/no fact is asked twice/i);
});

describe('G2 GK keeps plant parts for Q9', () => {
  const slots = Patterns.get('fde_g2_2026').subjects.general_knowledge.sections.flatMap((s) => s.slots);
  const rule = (q) => slots.find((s) => s.slot === `g2.general_knowledge.${q}`).prompt_rule;

  test.each(['A.Q1', 'A.Q2', 'A.Q3', 'A.Q4', 'B.Q5', 'B.Q6'])('%s asks nothing about the parts of a plant', (q) => {
    expect(rule(q)).toMatch(/never the parts of a plant/i);
    expect(rule(q)).not.toMatch(/a plant part and its use/);
  });
});
