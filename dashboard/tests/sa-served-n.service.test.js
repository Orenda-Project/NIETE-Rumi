'use strict';
/**
 * The phone records the form it SERVED on a one-at-a-time result (served_n: the number of items it served), so the
 * scorer reads the counts form (sa_r8_counts: 5 sums in place of 2) from what was served, never from how far the child
 * got. A child cut off on the 2nd of 5 sums sends cells for .01 and .02 only, which the 2-item form has too.
 * Synthetic battery only.
 */
const core = require('../sa/sa-core');

const pad = (n) => String(n).padStart(2, '0');
const SUMS = [['13 + 6', 19], ['18 + 7', 25], ['12 + 14', 26], ['22 + 37', 59], ['38 + 26', 64]];
const add = (n) => ({
  id: 'ma.add2i', w3: true, kind: 'oral', subtask: 'mental_addition', response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {},
  items: SUMS.slice(0, n).map(([show, a], k) => ({ id: `ma.add2i.${pad(k + 1)}`, show, target: a, answer: a, src: `fixture:sums[${k}]` })),
});

function runner(task, extra = {}) {
  let t = 0;
  const r = core.createRunner({ battery: { battery_id: 'b', tasks: [task] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true, ...extra });
  return { r, step: (ms) => { t += ms; } };
}

describe('served_n on a one-at-a-time result', () => {
  test('5 sums served, the child stopped by the silence stop on the 2nd: served_n 5, cells .01 and .02', () => {
    const { r, step } = runner(add(5));
    r.start(); r.instructionDone(); r.begin();
    step(3000); r.nextCell('tap');
    step(20000); r.silence(20);
    const res = r.view().result;
    expect(res.stop_reason).toBe('early_stop_silence');
    expect(res.cells.map((c) => c.item_id)).toEqual(['ma.add2i.01', 'ma.add2i.02']);
    expect(res.served_n).toBe(5);
  });

  test('2 sums served and both answered: served_n 2', () => {
    const { r, step } = runner(add(2));
    r.start(); r.instructionDone(); r.begin();
    step(3000); r.nextCell('tap');
    step(3000); r.nextCell('tap');
    const res = r.view().result;
    expect(res.stop_reason).toBe('complete');
    expect(res.served_n).toBe(2);
  });

  test('a task with no cells (a tap task) gets no served_n: its result keys are as before', () => {
    const tap = { id: 'ma.missing4', kind: 'choice', subtask: 'missing_number', response: 'tap', time_limit_s: null, stop: {},
      items: [{ id: 'ma.missing4.01', options: ['1', '2'], target: '2' }] };
    const { r } = runner(tap);
    r.start(); r.instructionDone(); r.begin();
    r.answer('2');
    const res = r.results().find((x) => x.task_id === 'ma.missing4');
    expect(res.stop_reason).toBe('complete');
    expect(res).not.toHaveProperty('served_n');
  });
});
