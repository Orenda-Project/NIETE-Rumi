'use strict';
const M = require('../../../bot/shared/services/assessment/board-checks/mcq-shape');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const OPTS = ['A) 6', 'B) 12', 'C) 18', 'D) 24'];
const one = (item, ctx) => M.run(paper({ sections: [{ id: 'A', marks: 1, slots: [row('s')] }], items: [{ ...item, slot: 's' }] }), ctx || ctxBoard());
const rules = (r) => r.issues.map((i) => i.rule);
const letters = (ls) => ls.map((l, i) => mcq(`m${i}`, 's', l));
const section = (items) => paper({ sections: [{ id: 'A', marks: items.length, slots: [row('s', { attempt: items.length, printed: items.length })] }], items });

describe('D13 mcq-shape', () => {
  test('interface + pinned LIMITS', () => {
    expect(M).toMatchObject({ id: 'D13', hard: true, modes: ['free', 'board'] });
    expect(M.LIMITS).toEqual({ optionCount: 4, keyRun: 4, keyShareHard: 0.4, keyShareSoft: 0.35, keyShareMinN: 10 });
  });

  test('clean item ok; input frozen', () => {
    const r = M.run(deepFreeze(section([mcq('a', 's', 'B')])), deepFreeze(ctxBoard()));
    expect(r.issues).toEqual([]); expect(r.ok).toBe(true);
  });

  test('(1) 3 and 5 options -> OPTION_COUNT', () => {
    expect(rules(one(mcq('a', 's', 'A', OPTS.slice(0, 3))))).toContain('OPTION_COUNT');
    expect(rules(one(mcq('a', 's', 'A', [...OPTS, 'E) 30'])))).toContain('OPTION_COUNT');
  });

  test('OPTION_LABELS: wrong order / unlabelled -> hard; urdu labels ok', () => {
    expect(rules(one(mcq('a', 's', 'A', ['B) 6', 'A) 12', 'C) 18', 'D) 24'])))).toContain('OPTION_LABELS');
    expect(rules(one(mcq('a', 's', 'A', ['6', '12', '18', '24'])))).toContain('OPTION_LABELS');
    expect(one(mcq('a', 's', 'ج', ['الف) ا', 'ب) ب', 'ج) ج', 'د) د'])).issues).toEqual([]);
  });

  test('(2) key B ok; key text absent -> KEY_UNRESOLVED', () => {
    expect(one(mcq('a', 's', 'B')).issues).toEqual([]);
    expect(rules(one(mcq('a', 's', 'no such')))).toContain('KEY_UNRESOLVED');
  });

  test('(3) numeric order', () => {
    const n = (...v) => one(mcq('a', 's', 'A', v.map((x, i) => `${'ABCD'[i]}) ${x}`)));
    expect(rules(n('4', '12', '8', '16'))).toContain('NUMERIC_ORDER');
    expect(rules(n('4', '8', '12', '16'))).not.toContain('NUMERIC_ORDER');
    expect(rules(n('1/2', '1/4', '3/4', '1'))).toContain('NUMERIC_ORDER');
    expect(rules(n('1/4', '1/2', '3/4', '1'))).not.toContain('NUMERIC_ORDER');
    expect(rules(n('4 cm', '12 cm', '8 cm', '16 cm'))).toContain('NUMERIC_ORDER');
    expect(rules(n('red', '12', '8', '16'))).not.toContain('NUMERIC_ORDER');
  });

  test('(4) duplicate after label strip and fold', () => {
    expect(rules(one(mcq('a', 's', 'A', ['A) the  Sun', 'B) the sun', 'C) moon', 'D) star'])))).toContain('DUP_OPTION');
    expect(rules(one(mcq('a', 's', 'A', ['A) كيا', 'B) کیا', 'C) x', 'D) y'])))).toContain('DUP_OPTION');
  });

  test('(5) urdu cell with الف key resolves', () => {
    expect(one(mcq('a', 's', 'الف', ['الف) پانچ', 'ب) چھ', 'ج) سات', 'د) آٹھ'])).issues).toEqual([]);
  });

  test('NONE_ALL_OF_ABOVE is soft', () => {
    const r = one(mcq('a', 's', 'A', ['A) x', 'B) y', 'C) z', 'D) All of the above']));
    expect(r.issues.find((i) => i.rule === 'NONE_ALL_OF_ABOVE')).toMatchObject({ hard: false });
    expect(r.ok).toBe(true);
    expect(rules(one(mcq('a', 's', 'A', ['A) x', 'B) y', 'C) z', 'D) مندرجہ بالا تمام'])))).toContain('NONE_ALL_OF_ABOVE');
  });

  test('(6) four A keys in a row -> KEY_RUN; three is fine', () => {
    const r = M.run(section(letters(['A', 'A', 'A', 'A', 'B', 'C'])), ctxBoard());
    expect(rules(r)).toContain('KEY_RUN');
    expect(rules(M.run(section(letters(['A', 'A', 'A', 'B', 'C', 'D'])), ctxBoard()))).not.toContain('KEY_RUN');
  });

  describe('(7) KEY_SHARE in sections of >= 10 MCQs', () => {
    const mix = (n, b) => {
      const rest = ['A', 'C', 'D'];
      const at = new Set(Array.from({ length: b }, (_, i) => Math.floor((i * n) / b)));
      let c = 0;
      return Array.from({ length: n }, (_, i) => (at.has(i) ? 'B' : rest[c++ % 3]));
    };
    const run = (n, b) => M.run(section(letters(mix(n, b))), ctxBoard());
    const share = (r) => r.issues.filter((i) => i.rule === 'KEY_SHARE');
    test('6 of 12 hard', () => expect(share(run(12, 6))[0]).toMatchObject({ hard: true }));
    test('5 of 12 (41.7%) hard', () => expect(share(run(12, 5))[0]).toMatchObject({ hard: true }));
    test('4 of 12 (33%) clean', () => expect(share(run(12, 4))).toEqual([]));
    test('9 of 25 (36%) soft', () => expect(share(run(25, 9))[0]).toMatchObject({ hard: false }));
    test('below 10 MCQs: record only', () => {
      const r = run(8, 5);
      expect(share(r)).toEqual([]);
      expect(r.detail.shares).toBeDefined();
    });
  });

  test('(8) stimulus MCQ is checked like any other', () => {
    const g = { id: 'g', slot: 's', type: 'mcq', stimulus: { text: 'P', items: [mcq('k', 's', 'A', OPTS.slice(0, 3))] } };
    const r = M.run(section([g]), ctxBoard());
    expect(r.issues.find((i) => i.rule === 'OPTION_COUNT').item_ref).toBe('s#1@s1');
  });

  test('(9) non-MCQ leaf ignored; free mode works without layout', () => {
    expect(M.run(section([srq('x', 's', 4)]), ctxBoard()).issues).toEqual([]);
    const free = { unseen: { objective: { M: [{ id: 'a', type: 'mcq', options: ['A) 1', 'B) 2'], answer: 'A' }] } } };
    const r = M.run(free, { mode: 'free', P: null, variant: null });
    expect(r.issues[0]).toMatchObject({ rule: 'OPTION_COUNT', item_ref: 'mcq#1' });
    expect(r.issues[0].slot).toBeUndefined(); // free mode: the registry derives 'free:mcq' from the ref
  });
});
