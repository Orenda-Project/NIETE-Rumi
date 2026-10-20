/**
 * bd-5jmnfj.22: a question that contradicts itself reached a staging Science paper:
 * «Why can the student see the torch light but the torch is luminous while the mug is not?»
 * (Q2 (b), the torch/mug situation, sub-question c). The stem check reads every printed question
 * beside its own answer, names the ones that do not make sense, and rewords a named one so it asks
 * what its answer answers. The answer and the marking points are never touched.
 */

const SC = require('../../bot/shared/services/assessment/fde-stem-check');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const P = Patterns.get('fde_g5_2027').subjects.science;

const BAD = 'Why can the student see the torch light but the torch is luminous while the mug is not?';
const GOOD = 'Why is the torch luminous while the mug is not?';
const torch = () => ({
  slot: 'science.B.Q2b',
  question: 'A student shines a torch at a wall and puts a ceramic mug, a clear glass and a frosted cup in front of the light.',
  answer: 'See the sub-questions.',
  questions: [
    { question: 'Why does the ceramic mug make a dark, solid shadow?', answer: 'The mug is opaque.', scheme: { accept: ['Light cannot pass through it'] } },
    { question: 'Which object makes the faintest shadow, and why?', answer: 'The clear glass, it is transparent.' },
    { question: BAD, answer: 'The torch makes its own light, so it is luminous; the mug does not, so it is non-luminous.' },
  ],
});
const long = () => ({
  slot: 'science.C.Q3b',
  question: 'A student shines a torch on a plastic sheet, tissue paper and thick cardboard. Explain what they see.',
  answer: 'The plastic sheet is transparent, the tissue paper translucent, the cardboard opaque.',
  scheme: { accept: ['Frosted cup is translucent, glass is transparent, mug is opaque', 'Sheet lets light through'], points: [{ text: 'Plastic sheet is transparent' }] },
});
const paper = () => ({
  unseen: {
    objective: { MCQs: [{ slot: 'science.A.Q1a', question: 'Which organ pumps blood?', options: ['a) Lungs', 'b) Heart'], answer: 'b) Heart' }] },
    subjective: { 'Logical Reasoning': [torch()], 'Long Question': [long()] },
  },
  _layout: {},
});

describe('the stem check prompt (bd-5jmnfj.22)', () => {
  const { prompt, targets } = SC.buildStemCheckPrompt(paper(), P);

  it('labels every printed question and sub-question in paper order', () => {
    expect([...targets.keys()]).toEqual(['Q1a.1', 'Q2b.1', 'Q2b.1.a', 'Q2b.1.b', 'Q2b.1.c', 'Q3b.1']);
  });

  it('prints each question beside its own answer and accept line', () => {
    expect(prompt).toContain(`Q2b.1.c ${BAD}`);
    expect(prompt).toMatch(/Q2b\.1\.c[^\n]*\n\s+answer: The torch makes its own light/);
    expect(prompt).toContain('accept: Frosted cup is translucent, glass is transparent, mug is opaque');
    expect(prompt).toContain('a) Lungs | b) Heart');
  });

  it('asks for a reworded question that keeps its answer, and nothing about style or level', () => {
    expect(prompt).toMatch(/contradicts itself/);
    expect(prompt).toMatch(/same answer/);
    expect(prompt).toMatch(/Do NOT flag/);
    expect(prompt).toMatch(/"flags":\[\]/);
  });

  it('is built only for the English-medium subjects', () => {
    expect(SC.STEM_CHECK_SUBJECTS).toEqual(['english', 'maths', 'science']);
  });
});

describe('reading the reply', () => {
  const { targets } = SC.buildStemCheckPrompt(paper(), P);

  it('keeps a flag on a printed label, once', () => {
    const flags = SC.parseStemFlags({ flags: [
      { label: 'Q2b.1.c', problem: 'two questions run together', question: GOOD },
      { label: 'Q2b.1.c', problem: 'again', question: 'x' },
      { label: 'Q9.1', problem: 'not on the paper' },
    ] }, targets);
    expect(flags).toEqual([{ label: 'Q2b.1.c', problem: 'two questions run together', question: GOOD }]);
  });

  it('a reply with no flags list is a failed read, not a clean one', () => {
    expect(() => SC.parseStemFlags({}, targets)).toThrow(/no flags list/);
    expect(SC.parseStemFlags({ flags: [] }, targets)).toEqual([]);
  });
});

describe('applying the fixes', () => {
  const at = (exam, slot) => Object.values(exam.unseen).flatMap((t) => Object.values(t)).flat().find((q) => q.slot === slot);

  it('rewords the flagged sub-question and leaves its answer as it was', () => {
    const before = paper();
    const { examJson, record } = SC.applyStemFixes(before, P, [{ label: 'Q2b.1.c', problem: 'garbled', question: GOOD }]);
    const sub = at(examJson, 'science.B.Q2b').questions[2];
    expect(sub.question).toBe(GOOD);
    expect(sub.answer).toMatch(/^The torch makes its own light/);
    expect(record).toEqual([{ label: 'Q2b.1.c', problem: 'garbled', outcome: 'reworded', was: BAD }]);
    // The paper handed in is not changed.
    expect(at(before, 'science.B.Q2b').questions[2].question).toBe(BAD);
  });

  it('drops an accept line about other objects, only one copied exactly', () => {
    const accept = 'Frosted cup is translucent, glass is transparent, mug is opaque';
    const { examJson, record } = SC.applyStemFixes(paper(), P, [{ label: 'Q3b.1', problem: 'accept is about a mug', drop_accept: [accept, 'not there'] }]);
    expect(at(examJson, 'science.C.Q3b').scheme.accept).toEqual(['Sheet lets light through']);
    expect(record[0]).toMatchObject({ label: 'Q3b.1', outcome: 'accept_dropped', dropped: [accept] });
  });

  it('a fix the paper refuses to print, or one that is no question, is not applied but recorded', () => {
    const refuses = (t) => /forbidden/.test(t);
    const { examJson, record } = SC.applyStemFixes(paper(), P, [
      { label: 'Q2b.1.c', problem: 'garbled', question: 'A forbidden word here?' },
      { label: 'Q2b.1.a', problem: 'odd', question: '(a) Why does the mug make a shadow?' },
      { label: 'Q2b.1.b', problem: 'odd', question: '' },
    ], { refuses });
    expect(at(examJson, 'science.B.Q2b').questions.map((q) => q.question)).toEqual(torch().questions.map((q) => q.question));
    expect(record.map((r) => r.outcome)).toEqual(['refused', 'flagged_only', 'flagged_only']);
  });
});
