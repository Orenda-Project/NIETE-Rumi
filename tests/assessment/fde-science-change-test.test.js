/**
 * G5 Science (bd-5jmnfj.36): physical vs chemical change is told by whether a new substance forms; reversibility is only a
 * supporting sign. A key that pays reversibility with no new-substance point is flagged so the section is asked again.
 */
const { changeTestFlags } = require('../../bot/shared/services/assessment/fde-science-change-test');
const { scienceRepeats } = require('../../bot/shared/services/assessment/fde-science-repeats');
const { giveawayNote, answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');

const pts = (...t) => t.map((text) => ({ text, marks: 1, kind: 'K' }));
const item = (slot, question, answer, points) => ({ slot, question, answer, scheme: { points: pts(...points), accept: [] } });
const paper = (...items) => ({ unseen: { subjective: { 'Long Question': items } } });

describe('changeTestFlags', () => {
  test('RED: reversibility as the test with no new substance is flagged', () => {
    const q = item('science.C.Q3b', 'Is burning paper a physical or chemical change? Explain.', 'Chemical, because it cannot be changed back.', ['It cannot be changed back', 'So it is a chemical change']);
    const f = changeTestFlags(paper(q));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ slot: 'science.C.Q3b', reason: 'giveaway', printed: false });
    expect(f[0].with).toEqual(['science.C.Q3b']);
    expect(f[0].note).toMatch(/new substance/);
  });
  test('a key that pays a new substance is fine, with or without reversibility', () => {
    const q = item('science.C.Q3b', 'Is rusting a physical or chemical change?', 'Chemical: a new substance, rust, forms.', ['A new substance forms', 'It cannot easily be changed back']);
    expect(changeTestFlags(paper(q))).toEqual([]);
  });
  test('an item that is not about physical or chemical change is ignored', () => {
    const q = item('science.C.Q3a', 'Why does a rubber band return to its shape?', 'It is elastic.', ['It can be changed back after stretching']);
    expect(changeTestFlags(paper(q))).toEqual([]);
  });
  test('sub-questions are read on their own answers', () => {
    const q = { slot: 'science.B.Q2b', question: 'Situation', questions: [
      { question: 'Is melting ice a chemical change?', answer: 'No, it can be reversed.', scheme: { points: pts('It can be reversed'), accept: [] } },
    ] };
    expect(changeTestFlags(paper(q))).toHaveLength(1);
  });
  test('wired into the science repeat list, and the re-ask note states the rule', () => {
    const q = item('science.C.Q3b', 'Is burning paper a physical or chemical change? Explain.', 'Chemical, because it cannot be changed back.', ['It cannot be changed back']);
    const flags = scienceRepeats(paper(q)).filter((f) => f.note);
    expect(flags).toHaveLength(1);
    expect(giveawayNote(flags)).toMatch(/new substance forms/);
  });
  test('through answerRepeats the re-ask note still states the rule, not the give-away sentence', () => {
    const q = item('science.C.Q3b', 'Is burning paper a physical or chemical change? Explain.', 'Chemical, because it cannot be changed back.', ['It cannot be changed back']);
    const flags = answerRepeats(paper(q)).filter((f) => f.slot === 'science.C.Q3b');
    expect(flags.some((f) => !f.printed && f.note)).toBe(true);
    const note = giveawayNote(flags);
    expect(note).toMatch(/new substance forms/);
    expect(note).not.toMatch(/already appear elsewhere/);
  });
  test('never changes the paper', () => {
    const q = item('science.C.Q3b', 'Is burning paper a physical or chemical change?', 'Chemical, cannot be changed back.', ['cannot be changed back']);
    const p = paper(q); const copy = JSON.parse(JSON.stringify(p));
    changeTestFlags(p); expect(p).toEqual(copy);
  });
});
