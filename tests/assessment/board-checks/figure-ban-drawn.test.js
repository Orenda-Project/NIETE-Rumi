'use strict';
/**
 * bd-5jmnfj.38.30 round 7 (a10: p3 G9 Physics ch2, N20 at A.Q41-60#3@s4). A graph the STUDENT is told to draw from
 * data printed in the paper (a table or a list of values) is not a missing figure: soft. A graph someone in the
 * passage draws, with no data and no graph printed, stays hard (the a10 case, verbatim, names changed only).
 */
const m = require('../../../bot/shared/services/assessment/board-checks/figure-ban');

const BOARD = { mode: 'board' };
const mc = (id, question) => ({ id, slot: 'A.Q2', type: 'mcq', question, options: ['A) gradient of the line', 'B) area under the line', 'C) height of the line', 'D) length of the time axis'], answer: 'B) area under the line' });
const paperOf = (text, question) => ({
  _layout: { sections: [{ id: 'A', slots: [{ slot: 'A.Q2' }] }] },
  unseen: { objective: { scenario: [{ id: 'grp', slot: 'A.Q2', type: 'scenario', stimulus: { text, items: [mc('c1', question)] } }] } },
});
const hard = (r) => r.issues.filter((i) => i.hard);
const ASK = 'The distance covered in the first 10 s is found from the graph as the:';

test('the a10 case: someone in the passage draws a graph, nothing is printed: hard FIGURE_REF', () => {
  const r = m.run(paperOf('Bilal studies the motion of a made-up car on a straight road. The car starts from rest and its speed rises steadily to 20 m/s in 10 s. It then moves at 20 m/s for 5 s. Bilal draws a speed-time graph of this journey.', ASK), BOARD);
  expect(hard(r).map((i) => i.code)).toEqual(['FIGURE_REF']);
});

test('the student is told to draw it from a printed table: soft GRAPH_FROM_DATA', () => {
  const r = m.run(paperOf('A made-up cart: Time (s) | 0 | 5 | 10 | 15\nSpeed (m/s) | 0 | 10 | 20 | 20\nDraw a speed-time graph from this table.', ASK), BOARD);
  expect(hard(r)).toEqual([]);
  expect(r.issues.map((i) => i.code)).toContain('GRAPH_FROM_DATA');
});

test('the student is told to plot it from listed values: soft', () => {
  const r = m.run(paperOf('A made-up ball\'s speed at t = 0, 2, 4 and 6 s is 0, 4, 8 and 12 m/s. Plot a speed-time graph of these values.', 'Using the graph, the acceleration of the ball is:'), BOARD);
  expect(hard(r)).toEqual([]);
});

test('told to draw, but no data printed: hard', () => {
  const r = m.run(paperOf('A made-up car speeds up steadily and then moves at a steady speed. Draw a speed-time graph of its journey.', ASK), BOARD);
  expect(hard(r)).toHaveLength(1);
});

test('data printed, but nobody tells the student to draw: hard', () => {
  const r = m.run(paperOf('A made-up cart: Time (s) | 0 | 5 | 10\nSpeed (m/s) | 0 | 10 | 20', ASK), BOARD);
  expect(hard(r)).toHaveLength(1);
});
