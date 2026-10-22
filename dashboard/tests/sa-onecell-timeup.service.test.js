'use strict';
/**
 * A timed one-at-a-time task (letter names, number identification, the 1-minute fluency) at time up ends there, as
 * time_up at the cell reached. Before, the time-up sent it to the passage's "Tap the last word you read", which listed
 * its items as words, and the tap overwrote the cell reached.
 */
const core = require('../sa/sa-core');

const FLUENCY = {
  id: 'ma.fluency1m', subtask: 'mental_math_fluency', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5,
  items: Array.from({ length: 20 }, (_, k) => ({ id: `ma.fluency1m.${k + 1}`, show: `${k} + 1`, target: k + 1 })),
};
const NUMBERS = {
  id: 'ma.number_id8', subtask: 'number_identification', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5,
  items: [{ id: 'n1', show: '9', target: 9 }, { id: 'n2', show: '14', target: 14 }, { id: 'n3', show: '30', target: 30 }],
};
const LETTERS = {
  id: 'en.letter_names5', subtask: 'letter_name_identification', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3,
  lang: 'en', grid: ['i', 'y', 'k'], items: [{ id: 'l1', show: 'i', target: 'i' }, { id: 'l2', show: 'y', target: 'y' }, { id: 'l3', show: 'k', target: 'k' }],
};

test.each([['fluency', FLUENCY], ['number identification', NUMBERS], ['letter names', LETTERS]])('%s: ends as time_up at the cell reached, no last-word screen', (_, task) => {
  let t = 0;
  const r = core.createRunner({ battery: { battery_id: 'b', tasks: [task] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true });
  r.start(); r.instructionDone(); r.begin();
  r.nextCell('tap');
  t += 61000; r.tick();
  const v = r.view();
  expect(v.phase).toBe('task_end');
  expect(v.result).toEqual(expect.objectContaining({ stop_reason: 'time_up', last_item_index: 1 }));
  expect(v.result.cells.map((x) => x.how)).toEqual(['tap', 'time_up']);
});
