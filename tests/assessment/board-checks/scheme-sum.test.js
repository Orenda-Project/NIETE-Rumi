'use strict';
const M = require('../../../bot/shared/services/assessment/board-checks/scheme-sum');
const { mcq, srq, row, paper, ctxBoard, deepFreeze } = require('./paper-builder');

const pts = (...m) => ({ points: m.map((x, i) => ({ kind: 'idea', text: `p${i}`, marks: x })) });
const bands = (...b) => ({ bands: b.map(([hi, lo]) => ({ hi, lo, descriptor: 'd' })) });
const P = (items, extra) => paper({ sections: [{ id: 'B', marks: 6, slots: [row('s', { type: 'srq', ...extra })] }], items: items.map((i) => ({ slot: 's', ...i })) });
const ctx = (style) => ctxBoard({ variant: { scheme_style: style } });
const rules = (r) => r.issues.map((i) => i.rule);

describe('D14 scheme-sum', () => {
  test('interface + LIMITS', () => {
    expect(M).toMatchObject({ id: 'D14', hard: true, modes: ['board'] });
    expect(M.LIMITS).toEqual({ bandStep: 1 });
  });

  test('(1) points 2+2+1 under 6 -> POINTS_SUM; 2+2+2 ok; frozen input', () => {
    expect(rules(M.run(P([srq('a', 's', 6, { scheme: pts(2, 2, 1) })]), ctx('analytic_points')))).toEqual(['POINTS_SUM']);
    const ok = M.run(deepFreeze(P([srq('a', 's', 6, { scheme: pts(2, 2, 2) })])), deepFreeze(ctx('analytic_points')));
    expect(ok.issues).toEqual([]); expect(ok.ok).toBe(true);
  });

  test('NO_POINTS: constructed item with an empty scheme', () => {
    expect(rules(M.run(P([srq('a', 's', 6, { scheme: { points: [] } })]), ctx('analytic_points')))).toEqual(['NO_POINTS']);
    expect(rules(M.run(P([srq('a', 's', 6)]), ctx('analytic_points')))).toEqual(['NO_POINTS']);
  });

  test('(2) OR item with one branch off', () => {
    const o = { id: 'o', or: [srq('a', 's', 6, { scheme: pts(3, 3) }), srq('b', 's', 6, { scheme: pts(3, 2) })] };
    const r = M.run(P([o]), ctx('analytic_points'));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ rule: 'POINTS_SUM', item_ref: 's#1/b', hard: true });
  });

  test('(3) parts 3+3 under an 8-mark parent -> parent sum; right parent ok', () => {
    const mk = (m) => ({ id: 'pp', type: 'srq', marks: m, parts: [srq('p1', 's', 3, { scheme: pts(1, 2) }), srq('p2', 's', 3, { scheme: pts(3) })] });
    const r = M.run(P([mk(8)]), ctx('analytic_points'));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ rule: 'POINTS_SUM', item_ref: 's#1' });
    expect(M.run(P([mk(6)]), ctx('analytic_points')).issues).toEqual([]);
  });

  describe('(4) holistic bands', () => {
    const run = (b, marks = 8) => M.run(P([srq('a', 's', marks, { scheme: bands(...b) })]), ctx('holistic_bands'));
    test('8-7, 6-4, 3-0 ok', () => expect(run([[8, 7], [6, 4], [3, 0]]).issues).toEqual([]));
    test('7-6 / 4-0 gap -> BAND_GAP (and BAND_TOP for the top)', () => {
      const r = run([[7, 6], [4, 0]]);
      expect(rules(r)).toContain('BAND_GAP');
    });
    test('gap in the middle', () => expect(rules(run([[8, 7], [5, 0]]))).toEqual(['BAND_GAP']));
    test('overlap -> BAND_GAP', () => expect(rules(run([[8, 6], [6, 0]]))).toEqual(['BAND_GAP']));
    test('must reach 0', () => expect(rules(run([[8, 5], [4, 1]]))).toEqual(['BAND_GAP']));
    test('top band 9 under 8 marks -> BAND_TOP', () => expect(rules(run([[9, 7], [6, 0]]))).toEqual(['BAND_TOP']));
    test('no bands -> BAND_TOP', () => expect(rules(M.run(P([srq('a', 's', 8)]), ctx('holistic_bands')))).toEqual(['BAND_TOP']));
    test('unordered bands are sorted by the accessor only if given high to low: low to high is a gap', () => {
      expect(rules(run([[3, 0], [6, 4], [8, 7]]))).not.toEqual([]);
    });
  });

  test('(5) an MCQ with a stray scheme is ignored; objective types carry no scheme', () => {
    const m = mcq('m', 's', 'A', null, { scheme: pts(9) });
    expect(M.run(P([m]), ctx('analytic_points')).issues).toEqual([]);
  });

  test('(6) quarter-marks: 2.5 + 2.5 + 1 = 6 exact', () => {
    expect(M.run(P([srq('a', 's', 6, { scheme: pts(2.5, 2.5, 1) })]), ctx('analytic_points')).issues).toEqual([]);
    expect(rules(M.run(P([srq('a', 's', 6, { scheme: pts(2.5, 2.5, 0.5) })]), ctx('analytic_points')))).toEqual(['POINTS_SUM']);
  });

  test('teacher_marked slots and unknown/absent style are skipped', () => {
    const p = paper({ sections: [{ id: 'B', marks: 6, slots: [row('s', { type: 'srq', teacher_marked: true, marks_each: 6, generate: 0 })] }], items: [] });
    expect(M.run(p, ctx('analytic_points')).issues).toEqual([]);
    expect(M.run(P([srq('a', 's', 6)]), ctxBoard({ variant: {} })).issues).toEqual([]);
  });
});
