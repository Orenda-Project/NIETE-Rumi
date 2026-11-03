/**
 * v26 G5 Science repeats the checks missed (bd-5jmnfj.4.58.2), tested on the v26 exam text:
 * Q3(a)8 asks the rusting question of Q2(b)(ii)c; Q2(b)(iii)b states what part a asks; Q1 xvii and Q1 vii
 * (MCQs) hand over what Q3(b)5 and Q2(b)(i)a ask.
 */

const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const exam = require('./fixtures/fde/v26-g5-science.json');

const flagsFor = (slot) => answerRepeats(exam).filter((f) => f.slot === slot);
const hit = (slot, other, word) => flagsFor(slot).some((f) => f.with.includes(other) && f.words.includes(word));

describe('v26 G5 Science', () => {
  test('Q3(a)8 (rust in a damp jar) is flagged against Q2(b)(ii)c: the keys answer one another', () => {
    expect(hit('science.C.Q3a', 'science.B.Q2b', 'rust')).toBe(true);
  });

  test('Q2(b)(iii)b names the glass as the lighter shadow: it gives away part a', () => {
    expect(hit('science.B.Q2b', 'science.B.Q2b', 'glass')).toBe(true);
  });

  test('Q1 xvii (drum, higher amplitude) is flagged against Q3(b)5 (the glass struck softly then hard)', () => {
    expect(hit('science.C.Q3b', 'science.A.Q1a', 'amplitude')).toBe(true);
  });

  test('Q1 vii (sugar, tiny particles) is flagged against Q2(b)(i)a (is the salt really gone)', () => {
    expect(hit('science.B.Q2b', 'science.A.Q1a', 'particl')).toBe(true);
  });
});
