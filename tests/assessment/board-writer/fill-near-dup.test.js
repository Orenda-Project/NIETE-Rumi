'use strict';
/**
 * bd-qyi45h.15: the restore refilled a slot from the spare with an MCQ that asked the same as one already kept
 * (G11 Physics ch1 dry run 14 Nov 2026: rewrite 5 had no near-dup, the restore brought back A.Q1 (1-56)#14, a D17
 * twin of #55, and the paper failed PATTERN_SHORT_SLOT). fill now skips a spare node that D17 would pair with a kept
 * leaf or with a spare it already took.
 */
const T = require('../../../bot/shared/services/assessment/board-6-12/tree');
const ND = require('../../../bot/shared/services/assessment/board-checks/near-dup');

const opts = (key) => ['A) ' + key, 'B) mass', 'C) time', 'D) length'];
const mcq = (id, question, key) => ({ id, slot: 'M', question, options: opts(key), answer: `A) ${key}` });
const srq = (id, question) => ({ id, slot: 'S', question });
const tree = (...items) => ({ unseen: { objective: { MCQs: items.filter((q) => q.options) }, subjective: { srq: items.filter((q) => !q.options) } } });
const DUP = 'What is the SI unit of electric current in a wire?';

describe('twins: the D17 pairing of two items', () => {
  test('two MCQs pair on stem overlap with the same key; a different key does not', () => {
    expect(ND.twins(mcq('a', DUP, 'ampere'), mcq('b', 'Name the SI unit of electric current in the wire.', 'ampere'))).toBe(true);
    expect(ND.twins(mcq('a', 'Which quantity has the unit kelvin in physics?', 'temperature'), mcq('b', 'Which quantity has the unit metre in physics?', 'length'))).toBe(false);
  });
  test('two written items pair on stem overlap alone; an MCQ and a written item never pair', () => {
    const s = 'Explain how precision and accuracy differ in a measured length reading';
    expect(ND.twins(srq('a', s), srq('b', `${s}.`))).toBe(true);
    expect(ND.twins(srq('a', s), mcq('b', s, 'ampere'))).toBe(false);
  });
});

describe('fill skips a spare node that asks the same as a kept one (bd-qyi45h.15)', () => {
  test('the twin of a kept MCQ is passed over for the next spare', () => {
    const first = tree(mcq('k', DUP, 'ampere'));
    const second = tree(mcq('s1', 'Name the SI unit of electric current in the wire.', 'ampere'), mcq('s2', 'Which instrument measures the diameter of a thin wire?', 'screw gauge'));
    expect(T.fill(first, second, new Map([['M', 1]])).unseen.objective.MCQs.map((q) => q.question)).toEqual([DUP, 'Which instrument measures the diameter of a thin wire?']);
  });
  test('two spares that pair with each other: only the first is taken', () => {
    const second = tree(mcq('s1', DUP, 'ampere'), mcq('s2', 'Name the SI unit of electric current in the wire.', 'ampere'));
    expect(T.fill(tree(), second, new Map([['M', 2]])).unseen.objective.MCQs.map((q) => q.id)).toEqual(['s1']);
  });
});
