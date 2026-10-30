'use strict';
const W = require('../../bot/shared/services/assessment/fde-work-space');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const pts = (...kinds) => ({ points: kinds.map((kind) => ({ kind, marks: 1, text: 't' })) });

describe('workMm', () => {
  test('a protractor drawing gets at least 60 mm', () => {
    expect(W.workMm({ question: 'Using your geometry tools, draw an angle of 70°.', scheme: pts('M', 'A') })).toBeGreaterThanOrEqual(60);
    expect(W.workMm({ question: 'Measure the line with a ruler.' })).toBeGreaterThanOrEqual(60);
    expect(W.workMm({ question: 'Construct a triangle with a compass.' })).toBeGreaterThanOrEqual(60);
  });
  test('an M mark gets at least 40 mm', () => {
    expect(W.workMm({ question: 'Add 3/4 and 1/6.', scheme: pts('M', 'A') })).toBeGreaterThanOrEqual(40);
  });
  test('a plain item, an A-only item and an MCQ get nothing extra', () => {
    expect(W.workMm({ question: 'Write 8% as a decimal.', scheme: pts('A') })).toBeNull();
    expect(W.workMm({ question: 'Write 8% as a decimal.' })).toBeNull();
    expect(W.workMm({ question: 'Add 1 and 2.', options: ['a', 'b'], scheme: pts('M') })).toBeNull();
  });
  test('draw without a tool is not a tool drawing', () => {
    expect(W.asksToolDrawing({ question: 'Draw a picture of a cat.' })).toBe(false);
  });
});

describe('renderer uses it', () => {
  const heights = (html) => [...html.matchAll(/height:(\d+)mm/g)].map((m) => Number(m[1]));
  test('exposed workSpace gives the tall boxes', () => {
    if (typeof R.workSpace !== 'function') throw new Error('renderer must export workSpace');
    const slot = { lines: 2, work_mm: 30 };
    const draw = R.workSpace({ question: 'Using your geometry tools, draw an angle of 70°.', scheme: pts('M', 'A') }, slot);
    expect(Math.max(...heights(draw))).toBeGreaterThanOrEqual(60);
    const method = R.workSpace({ question: 'Add 3/4 and 1/6.', scheme: pts('M', 'A') }, slot);
    expect(Math.max(...heights(method))).toBeGreaterThanOrEqual(40);
    const plain = R.workSpace({ question: 'Write 8% as a decimal.', scheme: pts('A') }, slot);
    expect(Math.max(...heights(plain))).toBeLessThan(40);
  });
});
