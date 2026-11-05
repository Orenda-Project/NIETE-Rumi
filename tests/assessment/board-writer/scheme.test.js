'use strict';
const { normaliseBoardScheme } = require('../../../bot/shared/services/assessment/board-6-12/scheme');

const mk = (items) => ({ unseen: { objective: { MCQs: items.filter((i) => i.type === 'mcq') }, subjective: { Short: items.filter((i) => i.type !== 'mcq') } } });

describe('normaliseBoardScheme', () => {
  test('drops the scheme of an objective item', () => {
    const ex = mk([{ id: '1', type: 'mcq', scheme: { points: [] } }]);
    normaliseBoardScheme(ex, 'analytic_points');
    expect('scheme' in ex.unseen.objective.MCQs[0]).toBe(false);
  });
  test('scenario items are objective too', () => {
    const ex = { unseen: { objective: { S: [{ id: '1', type: 'scenario', scheme: { bands: [] } }] } } };
    normaliseBoardScheme(ex, 'holistic_bands');
    expect('scheme' in ex.unseen.objective.S[0]).toBe(false);
  });
  test('analytic_points keeps only points', () => {
    const ex = mk([{ id: '1', type: 'srq', scheme: { points: [{ marks: 1 }], bands: [{ lo: 0, hi: 1 }], note: 'x' } }]);
    normaliseBoardScheme(ex, 'analytic_points');
    expect(ex.unseen.subjective.Short[0].scheme).toEqual({ points: [{ marks: 1 }] });
  });
  test('holistic_bands keeps only bands', () => {
    const ex = mk([{ id: '1', type: 'erq', scheme: { points: [{ marks: 1 }], bands: [{ lo: 0, hi: 1 }] } }]);
    normaliseBoardScheme(ex, 'holistic_bands');
    expect(ex.unseen.subjective.Short[0].scheme).toEqual({ bands: [{ lo: 0, hi: 1 }] });
  });
  test('reaches OR branches, parts and stimulus members', () => {
    const both = () => ({ points: [], bands: [] });
    const ex = mk([
      { id: 'o', type: 'srq', or: [{ id: 'a', type: 'srq', scheme: both() }, { id: 'b', type: 'srq', scheme: both() }] },
      { id: 'p', type: 'srq', parts: [{ id: 'p1', type: 'srq', scheme: both() }] },
      { id: 'g', type: 'srq', stimulus: { text: 't', items: [{ id: 'g1', type: 'srq', scheme: both() }] } },
    ]);
    normaliseBoardScheme(ex, 'analytic_points');
    const [o, p, g] = ex.unseen.subjective.Short;
    expect(o.or.every((b) => !('bands' in b.scheme))).toBe(true);
    expect('bands' in p.parts[0].scheme).toBe(false);
    expect('bands' in g.stimulus.items[0].scheme).toBe(false);
  });
  test('an item with no scheme stays without one', () => {
    const ex = mk([{ id: '1', type: 'srq' }]);
    normaliseBoardScheme(ex, 'analytic_points');
    expect('scheme' in ex.unseen.subjective.Short[0]).toBe(false);
  });
  test('an unknown style changes nothing but objective schemes', () => {
    const ex = mk([{ id: '1', type: 'srq', scheme: { points: [], bands: [] } }]);
    normaliseBoardScheme(ex, 'mystery');
    expect(Object.keys(ex.unseen.subjective.Short[0].scheme)).toEqual(['points', 'bands']);
  });
  test('returns the same paper and a log of what it changed', () => {
    const ex = mk([{ id: '1', type: 'mcq', scheme: {} }, { id: '2', type: 'srq', scheme: { points: [], bands: [] } }]);
    const r = normaliseBoardScheme(ex, 'analytic_points');
    expect(r.examJson).toBe(ex);
    expect(r.log).toEqual(['1: scheme dropped on an objective item', '2: bands removed (style analytic_points)']);
  });
});
