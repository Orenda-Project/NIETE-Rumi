'use strict';
// board-6-12/mcq-keys: the board writer settles MCQ key letters and numeric order before D13 runs (fictional data).
const { settleKeys } = require('../../../bot/shared/services/assessment/board-6-12/mcq-keys');
const D13 = require('../../../bot/shared/services/assessment/board-checks/mcq-shape');
const { keyIndex } = require('../../../bot/shared/services/assessment/board-checks/option-text');
const { mcq, row, paper, ctxBoard } = require('../board-checks/paper-builder');

const WORDS = ['apple', 'river', 'stone', 'cloud', 'flame', 'grass', 'metal', 'paper'];
const opts = (i) => [0, 1, 2, 3].map((j) => `${'ABCD'[j]}) ${WORDS[(i + j) % 8]} ${i}`);
const section = (items) => paper({ sections: [{ id: 'A', marks: items.length, slots: [row('s', { attempt: items.length, printed: items.length })] }], items });
const rules = (ex) => D13.run(ex, ctxBoard()).issues.map((i) => i.rule);
const keyText = (it) => it.options[keyIndex(it)].replace(/^[A-D]\) /, '');

describe('settleKeys', () => {
  test('a run of B keys is broken and no key letter passes 35%, the keyed text unchanged', () => {
    const items = Array.from({ length: 12 }, (_, i) => mcq(`m${i}`, 's', `B) ${opts(i)[1].slice(3)}`, opts(i)));
    const ex = section(items);
    expect(rules(ex)).toEqual(expect.arrayContaining(['KEY_RUN', 'KEY_SHARE']));
    const before = items.map(keyText);
    settleKeys(ex);
    expect(rules(ex)).toEqual([]);
    expect(ex.unseen.objective.mcq.map(keyText)).toEqual(before);
    ex.unseen.objective.mcq.forEach((it) => expect(it.options.map((o) => o.slice(0, 3))).toEqual(['A) ', 'B) ', 'C) ', 'D) ']));
  });

  test('numeric options are sorted ascending and the key follows its value', () => {
    const it = mcq('n', 's', 'B) 12 cm', ['A) 4 cm', 'B) 12 cm', 'C) 8 cm', 'D) 16 cm']);
    const ex = section([it]);
    expect(rules(ex)).toContain('NUMERIC_ORDER');
    settleKeys(ex);
    const out = ex.unseen.objective.mcq[0];
    expect(out.options).toEqual(['A) 4 cm', 'B) 8 cm', 'C) 12 cm', 'D) 16 cm']);
    expect(out.answer).toBe('C) 12 cm');
    expect(rules(ex)).toEqual([]);
  });

  test('options that point at other letters are never moved', () => {
    const ref = ['A) heat', 'B) light', 'C) Both A and B', 'D) sound'];
    const items = Array.from({ length: 5 }, (_, i) => mcq(`m${i}`, 's', 'C', i === 2 ? ref : opts(i)));
    const ex = section(items);
    settleKeys(ex);
    expect(ex.unseen.objective.mcq[2]).toMatchObject({ options: ref, answer: 'C' });
  });

  test('a clean section, an unresolved key and a 3-option item are left exactly as they were', () => {
    const items = ['A', 'B', 'C', 'D'].map((k, i) => mcq(`m${i}`, 's', k, opts(i)));
    items.push(mcq('x', 's', 'Z', opts(9)), mcq('y', 's', 'A', opts(10).slice(0, 3)));
    const ex = section(items);
    const copy = JSON.parse(JSON.stringify(ex));
    settleKeys(ex);
    expect(ex).toEqual(copy);
  });
});
