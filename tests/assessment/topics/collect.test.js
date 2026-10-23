'use strict';
/** Task 3 — union of the day rows behind one topic. */
const { collect } = require('../../../bot/shared/services/assessment/topics/collect');

const row = (day, pages, sloCodes, sloDescriptions) => ({ day, pages, sloCodes, sloDescriptions });

describe('collect', () => {
  test('days and pages are sorted numerically and de-duplicated', () => {
    const out = collect([row(10, [14, 15], [], []), row(9, [13, 2], [], []), row(10, [15], [], [])]);
    expect(out.days).toEqual([9, 10]);
    expect(out.pages).toEqual([2, 13, 14, 15]);
  });

  test('SLO codes and descriptions keep first-appearance order, de-duplicated', () => {
    const out = collect([row(1, [], ['B', 'A'], ['b', 'a']), row(2, [], ['A', 'C'], ['a', 'c'])]);
    expect(out.sloCodes).toEqual(['B', 'A', 'C']);
    expect(out.sloDescriptions).toEqual(['b', 'a', 'c']);
  });

  test('no rows gives empty lists', () => {
    expect(collect([])).toEqual({ days: [], pages: [], sloCodes: [], sloDescriptions: [] });
  });
});
