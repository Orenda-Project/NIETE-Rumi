'use strict';
/**
 * shapeActivity (dashboard/services/teacher-home-activity.js): the activity store's value → Home's `activity` block.
 * Pure. null for no value or every number 0; the trend line is the last two points' bands; at most 2 lines.
 */
const { shapeActivity } = require('../../dashboard/services/teacher-home-activity');

const tiles = (n) => ({
  plans_opened: { now: n, prev: 0 }, taught: { now: 0, prev: 0 }, coached: { now: 0, prev: 0 },
  quizzes: { now: 0, prev: 0 }, exams: { now: 0, prev: 0 },
});
const pt = (band) => ({ session_id: 's', at: '2026-10-01T00:00:00Z', band });
const line = (name, ...bands) => ({ indicator_id: 'D1', indicator_name: name, framework: 'fico17-v6', points: bands.map(pt) });

test('no value, no tiles → null', () => {
  expect(shapeActivity(null)).toBeNull();
  expect(shapeActivity({})).toBeNull();
});

test('every number 0 → null; one number above 0 → a block', () => {
  expect(shapeActivity({ tiles: tiles(0) })).toBeNull();
  expect(shapeActivity({ tiles: tiles(1), updated_at: 'x', slot: 'night' })).toMatchObject({
    updatedAt: 'x', slot: 'night', tiles: { opened: { now: 1, prev: 0 }, papers: { now: 0, prev: 0 } },
  });
});

test('a previous count alone (now 0) still shows: the pill says down', () => {
  const t = tiles(0);
  t.taught = { now: 0, prev: 2 };
  expect(shapeActivity({ tiles: t }).tiles.taught).toEqual({ now: 0, prev: 2 });
});

test('trend: the last two points, a one-point line dropped, at most two lines', () => {
  const out = shapeActivity({ tiles: tiles(1), trend: [line('A', 'average', 'good', 'excellent'), line('B', 'good'), line('C', 'good', 'average'), line('D', 'good', 'good')] });
  expect(out.trend).toEqual([{ indicator: 'A', from: 'good', to: 'excellent' }, { indicator: 'C', from: 'good', to: 'average' }]);
});

test('tip: the report id and its words, or null when it has no words', () => {
  expect(shapeActivity({ tiles: tiles(1), tip: { session_id: 's9', text: 'Try pairs', at: 'x' } }).tip).toEqual({ sessionId: 's9', text: 'Try pairs' });
  expect(shapeActivity({ tiles: tiles(1), tip: { session_id: 's9', text: '' } }).tip).toBeNull();
  expect(shapeActivity({ tiles: tiles(1) }).tip).toBeNull();
});
