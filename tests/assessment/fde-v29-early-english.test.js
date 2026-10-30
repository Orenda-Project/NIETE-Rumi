/**
 * v28 Grade 1-2 English findings the patterns and the answer check own (bd-5jmnfj.4.58.4):
 *   G1 English Q10 gave options with no instruction to circle; G2 English Q11 did not say pronoun or sentence;
 *   G2 English Q10 ii drew a bird in a tree (in and on both read true); G2 English Q1 i and j asked for
 *   free writing and a tense change inside "Read the passage and answer".
 * Fixtures are the real v28 papers with the picture data stripped.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');

const G2 = require('./fixtures/early/fde-v28-g2-english-exam.json');

const slotOf = (pid, slot) => {
  const found = Patterns.subjectOf(pid, 'english').sections.flatMap((s) => s.slots).find((s) => s.slot === slot);
  if (!found) throw new Error(`${pid} has no slot ${slot}`);
  return found;
};
const g1 = (slot) => slotOf('fde_g1_2026', slot);
const g2 = (slot) => slotOf('fde_g2_2026', slot);

describe('G1 English Q10 says what to do with the options', () => {
  test('the instruction asks the child to circle the small letter', () => {
    expect(g1('g1.english.B.Q10').instruction_en).toBe('Circle the small letter that matches the capital letter.');
  });

  test('the rule never uses I, l or L, which look alike in print', () => {
    const rule = g1('g1.english.B.Q10').prompt_rule;
    expect(rule).toMatch(/never use I, l or L as a capital or as an option/i);
    expect(rule).toMatch(/look alike in print/);
    expect(rule).toMatch(/Answer: the matching small letter/);
  });
});

describe('G2 English Q11 pronouns: the sentence is written again', () => {
  test('the instruction says to write the sentence again', () => {
    expect(g2('g2.english.C.Q11').instruction_en).toBe('Write the sentence again. Use he, she, it or they.');
  });

  test('the rule keys the full rewritten sentence', () => {
    expect(g2('g2.english.C.Q11').prompt_rule).toMatch(/Answer: the full rewritten sentence/);
  });
});

describe('G2 English Q10: no scene where in and on both read true', () => {
  test('the rule bans a bird or animal in or on a tree and keeps in for containers', () => {
    const rule = g2('g2.english.B.Q10').prompt_rule;
    expect(rule).toMatch(/never a bird or animal in or on a tree/i);
    expect(rule).toMatch(/in only for a thing inside a container \(box, basket, bag, cup\)/i);
  });
});

describe('G2 English Q1 reads from the passage only', () => {
  const rule = () => g2('g2.english.A.Q1').prompt_rule;
  const passageItem = () => G2.unseen.subjective['Read and Answer'][0];
  const withQuestions = (questions) => ({ ...passageItem(), questions });

  test('the rule keeps every question to the passage and the apply questions to its ideas', () => {
    expect(rule()).toMatch(/every question is answered from the passage/i);
    expect(rule()).toMatch(/never to write about themselves/i);
    expect(rule()).toMatch(/never a grammar or tense change/i);
  });

  test('the real v28 item (i) and (j) fail the slot check; the other eight pass', () => {
    const { answer_ok: ok } = g2('g2.english.A.Q1');
    expect(ok(passageItem())).toBe(false);
    const qs = passageItem().questions;
    expect(qs).toHaveLength(10);
    expect(ok(withQuestions(qs.slice(0, 8)))).toBe(true);
    expect(ok(withQuestions([qs[8]]))).toBe(false);
    expect(ok(withQuestions([qs[9]]))).toBe(false);
  });

  test('an apply question about what would happen passes', () => {
    const { answer_ok: ok } = g2('g2.english.A.Q1');
    const q = { question: 'What would happen if Hamza forgot to fill the bowl?', answer: 'The birds would go away.' };
    expect(ok(withQuestions([q]))).toBe(true);
  });

  test('the answer check re-asks the slot and names the item readably', () => {
    const P = Patterns.subjectOf('fde_g2_2026', 'english');
    const hits = Prompt.answerShortfall(G2, P).filter((f) => f.slot === 'g2.english.A.Q1');
    expect(hits).toHaveLength(1);
    expect(hits[0].items.join(' ')).toMatch(/Read the passage and answer the questions/);
    expect(hits[0].items.join(' ')).not.toMatch(/undefined/);
  });
});
