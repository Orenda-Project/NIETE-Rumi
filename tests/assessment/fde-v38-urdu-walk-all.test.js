'use strict';
const { mapAll, eachItem } = require('../../bot/shared/services/assessment/fde-urdu-walk-all');

const paper = () => ({ seen: { a: { T1: [{ slot: 's1', n: 1 }] } }, unseen: { b: { T2: [{ slot: 's2', n: 2 }, { slot: 's3', n: 3 }], T3: 'not a list' } } });

describe('fde-urdu-walk-all', () => {
  test('mapAll passes each item with its type and keeps an item when fn returns undefined', () => {
    const seen = [];
    const r = mapAll(paper(), (q, type) => { seen.push([q.slot, type]); return q.n === 2 ? { ...q, n: 20 } : undefined; });
    expect(seen).toEqual([['s1', 'T1'], ['s2', 'T2'], ['s3', 'T2']]);
    expect(r.unseen.b.T2.map((q) => q.n)).toEqual([20, 3]);
    expect(r.unseen.b.T3).toBe('not a list');
  });
  test('the input is not changed and a non-object is returned as is', () => {
    const p = paper();
    const copy = JSON.parse(JSON.stringify(p));
    mapAll(p, (q) => ({ ...q, n: 0 }));
    expect(p).toEqual(copy);
    expect(mapAll(null, () => 1)).toBe(null);
  });
  test('eachItem only reads', () => {
    let n = 0;
    eachItem(paper(), () => { n += 1; });
    expect(n).toBe(3);
  });
});
