'use strict';
/**
 * The sandbox-only "Jump to…" control (RULING #43, the tester's A01): runner.jumpTo(i) exists only when the runner is
 * made with dev_tools; the tasks passed over end as skipped_dev with no score (scored_on 'none', no counts, no rate),
 * and the chosen task starts at its instruction. dashboard/sa/sa-core.js.
 */
const core = require('../sa/sa-core');

const battery = {
  battery_id: 'dev',
  tasks: [
    { id: 'en.letters', mode: 'tap', time_limit_s: 60, items: [{ id: 'l1', target: 'a', options: ['a', 'b'] }, { id: 'l2', target: 'b', options: ['a', 'b'] }] },
    { id: 'en.words', mode: 'tap', time_limit_s: 60, items: [{ id: 'w1', target: 'cat', options: ['cat', 'dog'] }] },
    { id: 'ma.add1', mode: 'keypad', time_limit_s: 60, items: [{ id: 'a1', target: '3', shown: '1 + 2 =' }] },
    { id: 'ma.word_problems', mode: 'keypad', items: [{ id: 'p1', target: '5' }] },
  ],
};

function run(devTools) {
  const events = [];
  let t = 0;
  const r = core.createRunner({ battery, onEvent: (e) => events.push(e), now: () => (t += 100), dev_tools: devTools });
  return { r, events };
}

test('without dev_tools there is no jumpTo, and the view offers no task list', () => {
  const { r } = run(false);
  expect(r.jumpTo).toBeUndefined();
  r.start();
  expect(r.view().dev_tasks).toBeUndefined();
});

test('a jump from the middle of a task: that task and the ones passed over are skipped_dev, unscored', () => {
  const { r, events } = run(true);
  r.start();
  r.instructionDone(); r.begin(); r.answer('a');
  expect(r.view().dev_tasks).toEqual([
    { index: 0, id: 'en.letters', title: null }, { index: 1, id: 'en.words', title: null },
    { index: 2, id: 'ma.add1', title: null }, { index: 3, id: 'ma.word_problems', title: null },
  ]);
  expect(r.jumpTo(3)).toBe(true);
  const v = r.view();
  expect(v.phase).toBe('instruction');
  expect(v.task.id).toBe('ma.word_problems');
  const res = r.results();
  expect(res.map((x) => [x.task_id, x.stop_reason])).toEqual([['en.letters', 'skipped_dev'], ['en.words', 'skipped_dev'], ['ma.add1', 'skipped_dev']]);
  res.forEach((x) => {
    expect(x).toMatchObject({ scored_on: 'none', correct: null, incorrect: null, attempted: 0, per_minute: null, answers: [] });
  });
  expect(events.filter((e) => e.type === 'dev_jump')).toEqual([expect.objectContaining({ value: { from: 0, to: 3 } })]);
  expect(events.filter((e) => e.type === 'task_end').map((e) => e.task_id)).toEqual(['en.letters', 'en.words', 'ma.add1']);
});

test('a finished task keeps its score; a jump back re-runs the chosen task; a bad index is refused', () => {
  const { r } = run(true);
  r.start();
  r.instructionDone(); r.begin(); r.answer('a'); r.answer('b');
  expect(r.view().phase).toBe('task_end');
  expect(r.jumpTo(2)).toBe(true);
  expect(r.results().map((x) => [x.task_id, x.stop_reason, x.correct])).toEqual([['en.letters', 'complete', 2], ['en.words', 'skipped_dev', null]]);
  expect(r.jumpTo(0)).toBe(true);
  expect(r.view().task.id).toBe('en.letters');
  expect(r.results().map((x) => x.task_id)).toEqual(['en.words', 'ma.add1']);
  expect(r.jumpTo(9)).toBe(false);
  expect(r.jumpTo(-1)).toBe(false);
  expect(r.view().task.id).toBe('en.letters');
});

test('from the battery intro: the tasks before the chosen one are skipped_dev', () => {
  const { r } = run(true);
  expect(r.jumpTo(1)).toBe(true);
  expect(r.view().task.id).toBe('en.words');
  expect(r.results().map((x) => x.stop_reason)).toEqual(['skipped_dev']);
});
