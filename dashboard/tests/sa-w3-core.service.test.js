'use strict';
/**
 * Wave 3 engine (dashboard/sa/sa-core.js):
 *   one_at_a_time   a read-aloud grid (letter names, letter sounds, familiar words) shows one cell; nextCell() moves on;
 *                   the task's clock runs across the cells; each cell's time is kept (cells[], cell_next events)
 *   auto-advance    a cell left alone moves on after 3 s (letters, words; the task's cell_auto_s otherwise), tick()
 *                   answers 'go_on' (Jugnu: "Please go on"); coach-led (manual) never moves on by itself
 *   new subtasks    mental-maths fluency and mental sums are spoken answers (oral), the fluency timed across its items
 * OFF (no one_at_a_time) the grid task is the whole page it was.
 */
const core = require('../sa/sa-core');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const GRID = ['ر', 'د', 'م', 'ک', 'س'];
function gridBattery(extra) {
  return { battery_id: 'b', tasks: [Object.assign({ id: 'ur.letters_rec', subtask: 'letter_name_identification', response: 'record', lang: 'ur', time_limit_s: 60, grid: GRID.slice(), items: [] }, extra || {})] };
}
function run(battery, opts) {
  const c = clock();
  const events = [];
  const r = core.createRunner(Object.assign({ battery, now: c.now, onEvent: (e) => events.push(e), mic: () => 'ok' }, opts || {}));
  r.start();
  r.instructionDone();
  r.begin();
  return { r, c, events };
}

describe('one cell at a time (switch sa_one_at_a_time)', () => {
  test('the view shows the first cell only, and nextCell shows the next', () => {
    const { r, c, events } = run(gridBattery(), { one_at_a_time: true });
    expect(r.view().cell).toBe('ر');
    expect(r.view().cell_index).toBe(0);
    expect(r.view().cells_n).toBe(5);
    c.add(1800);
    r.nextCell('tap');
    expect(r.view().cell).toBe('د');
    const e = events.filter((x) => x.type === 'cell_next');
    expect(e).toHaveLength(1);
    expect(e[0].value).toEqual({ i: 0, at_ms: 0, ms: 1800, how: 'tap' });
  });

  test('the task clock runs across the cells: time up ends the task at the cell reached, with every cell time', () => {
    const { r, c } = run(gridBattery(), { one_at_a_time: true });
    c.add(20000); r.nextCell('tap');
    c.add(30000); r.nextCell('auto');
    c.add(10000); r.tick();
    const v = r.view();
    expect(v.phase).toBe('task_end');
    expect(v.result.stop_reason).toBe('time_up');
    expect(v.result.last_item_index).toBe(2);
    expect(v.result.cells).toEqual([
      { i: 0, at_ms: 0, ms: 20000, how: 'tap' },
      { i: 1, at_ms: 20000, ms: 30000, how: 'auto' },
      { i: 2, at_ms: 50000, ms: 10000, how: 'time_up' },
    ]);
  });

  test('the last cell passed ends the task as complete', () => {
    const { r, c } = run(gridBattery(), { one_at_a_time: true });
    for (let i = 0; i < GRID.length; i++) { c.add(1000); r.nextCell('tap'); }
    expect(r.view().phase).toBe('task_end');
    expect(r.view().result.stop_reason).toBe('complete');
    expect(r.view().result.last_item_index).toBe(4);
    expect(r.view().result.cells).toHaveLength(5);
  });

  test('a cell left alone moves on by itself after 3 s, and tick says go_on', () => {
    const { r, c, events } = run(gridBattery(), { one_at_a_time: true });
    c.add(2900);
    expect(r.tick()).toBeNull();
    expect(r.view().cell_index).toBe(0);
    c.add(200);
    expect(r.tick()).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
    expect(r.view().phase).toBe('running');
    expect(events.filter((x) => x.type === 'cell_next')[0].value).toEqual({ i: 0, at_ms: 0, ms: 3100, how: 'auto' });
  });

  test("the task's own cell_auto_s wins (5 s)", () => {
    const { r, c } = run(gridBattery({ cell_auto_s: 5 }), { one_at_a_time: true });
    c.add(4900); r.tick();
    expect(r.view().cell_index).toBe(0);
    c.add(200); r.tick();
    expect(r.view().cell_index).toBe(1);
  });

  test('coach-led (manual): a cell never moves on by itself; the session says so', () => {
    const { r, c, events } = run(gridBattery(), { one_at_a_time: true, manual: true });
    c.add(30000); expect(r.tick()).toBeNull();
    expect(r.view().cell_index).toBe(0);
    expect(events.find((x) => x.type === 'session_start').value.admin_mode).toBe('manual');
  });

  test('a silent reading still ends as early_stop_silence, at the cell reached', () => {
    const { r, c } = run(gridBattery(), { one_at_a_time: true });
    c.add(1000); r.nextCell('tap');
    r.silence(20);
    expect(r.view().result.stop_reason).toBe('early_stop_silence');
    expect(r.view().result.last_item_index).toBe(1);
  });

  test('OFF: the grid is one page (no cell in the view, nextCell does nothing), and the result has no cells', () => {
    const { r, c } = run(gridBattery());
    expect(r.view().cell).toBeUndefined();
    r.nextCell('tap');
    c.add(61000); r.tick();
    expect(r.view().result.stop_reason).toBe('time_up');
    expect(r.view().result.cells).toBeUndefined();
    expect(r.view().result.last_item_index).toBeNull();
  });

  test('a passage is never cut into cells', () => {
    const b = { battery_id: 'b', tasks: [{ id: 'ur.story', subtask: 'oral_reading_fluency', response: 'record', time_limit_s: 60, passage: { text: 'آج بلال گیا۔' }, items: [{ id: 'w1', target: 'آج' }, { id: 'w2', target: 'بلال' }, { id: 'w3', target: 'گیا' }] }] };
    const { r } = run(b, { one_at_a_time: true });
    expect(r.view().cell).toBeUndefined();
  });
});

describe('new subtasks', () => {
  test('mental-maths fluency and mental sums are spoken answers', () => {
    expect(core.MODE_BY_SUBTASK.mental_math_fluency).toBe('oral');
    expect(core.MODE_BY_SUBTASK.mental_addition).toBe('oral');
    expect(core.MODE_BY_SUBTASK.mental_subtraction).toBe('oral');
    expect(core.MODE_BY_SUBTASK.mental_multiplication).toBe('oral');
    const b = core.normalize({ tasks: [{ id: 'ma.fl', subtask: 'mental_math_fluency', items: [{ id: 'f1', shown: '3 + 4', target: '7' }] }] });
    expect(b.tasks[0].mode).toBe('oral');
  });

  test('fluency: one item at a time, the 60 s clock across items, each answer timed (one_at_a_time)', () => {
    const items = [];
    for (let i = 1; i <= 20; i++) items.push({ id: 'f' + i, shown: i + ' + 1', target: String(i + 1) });
    const b = { battery_id: 'b', tasks: [{ id: 'ma.fluency', subtask: 'mental_math_fluency', time_limit_s: 60, items }] };
    const { r, c } = run(b, { one_at_a_time: true });
    expect(r.view().task.mode).toBe('oral');
    expect(r.view().item.id).toBe('f1');
    c.add(2500); r.answer('spoken');
    expect(r.view().item.id).toBe('f2');
    c.add(57500); r.tick();
    const res = r.view().result;
    expect(res.stop_reason).toBe('time_up');
    expect(res.attempted).toBe(1);
    expect(res.answers[0]).toEqual({ item_id: 'f1', value: 'spoken', ok: null, ms: 2500 });
  });

  test('OFF: answers carry no time (the result is the shape it was)', () => {
    const b = { battery_id: 'b', tasks: [{ id: 'ma.n', subtask: 'number_identification', items: [{ id: 'n1', target: '7', options: ['7', '9'] }] }] };
    const { r, events } = run(b);
    r.answer('7');
    expect(r.view().result.answers[0]).toEqual({ item_id: 'n1', value: '7', ok: true });
    expect(events.find((x) => x.type === 'session_start').value).toEqual({ battery_id: 'b', tasks: 1 });
  });

  test('fluency: an item left unanswered moves on after 5 s (one_at_a_time)', () => {
    const items = [{ id: 'f1', shown: '1 + 1', target: '2' }, { id: 'f2', shown: '2 + 1', target: '3' }];
    const b = { battery_id: 'b', tasks: [{ id: 'ma.fluency', subtask: 'mental_math_fluency', time_limit_s: 60, items }] };
    const { r, c } = run(b, { one_at_a_time: true });
    c.add(4900); r.tick();
    expect(r.view().item.id).toBe('f1');
    c.add(200); r.tick();
    expect(r.view().item.id).toBe('f2');
  });
});

describe('comprehension gates per question (W3 forms: gate.min_words)', () => {
  const words = Array.from({ length: 60 }, (_, i) => ({ id: 'w' + (i + 1), target: 'w' + (i + 1), line: 1 }));
  const q = (id, min) => ({ id, prompt: id, gate: { read_past: null, min_words: min } });
  function battery(questions) {
    return { battery_id: 'b', tasks: [
      { id: 'ur.story_w3', subtask: 'oral_reading_fluency', response: 'record', time_limit_s: 60, passage: { text: 'x' }, items: words },
      { id: 'ur.story_comp_w3', subtask: 'reading_comprehension', depends_on: { task: 'ur.story_w3', upto_item: 'last_word_tap' }, items: questions },
    ] };
  }
  function readTo(lastIndex, questions) {
    const c = clock();
    const r = core.createRunner({ battery: battery(questions), now: c.now, mic: () => 'ok' });
    r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(lastIndex); r.next();
    return r;
  }
  const qs = [q('q1', 1), q('q2', 23), q('q3', 30), q('q4', 55), q('q5', 44), q('q6', 55)];

  test('a child who read 30 words is asked the questions whose min_words ≤ 30, in order', () => {
    const r = readTo(29, qs);
    r.instructionDone(); r.begin();
    const asked = [];
    while (r.view().phase === 'running') { asked.push(r.view().item.id); r.answer('spoken'); }
    expect(asked).toEqual(['q1', 'q2', 'q3']);
    expect(r.view().result.asked).toEqual(['q1', 'q2', 'q3']);
  });

  test('every word read: all six', () => {
    const r = readTo(59, qs);
    r.instructionDone(); r.begin();
    expect(r.view().items_n).toBe(6);
  });

  test('no word tapped: the questions are skipped (skipped_no_first_line)', () => {
    const c = clock();
    const r = core.createRunner({ battery: battery(qs), now: c.now, mic: () => 'ok' });
    r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(-1); r.next();
    expect(r.view().result.stop_reason).toBe('skipped_no_first_line');
  });
});

describe("the content lane's W3 shape: present 'one_at_a_time', items with show, advance_after_s", () => {
  const item = (id, show, extra) => Object.assign({ id, show, target: show }, extra || {});
  const task = (extra) => Object.assign({ id: 'ma.number_id8', subtask: 'number_identification', response: 'record', present: 'one_at_a_time',
    time_limit_s: 60, advance_after_s: 5, items: [item('n1', '9'), item('n2', '12'), item('n3', '45')] }, extra || {});

  test('one at a time from the data alone (no switch): the cells are the items\' show, each cell kept with its item id', () => {
    const { r, c } = run({ battery_id: 'b', tasks: [task()] });
    expect(r.view().cell).toBe('9');
    expect(r.view().cell_item.id).toBe('n1');
    c.add(1200); r.nextCell('tap');
    expect(r.view().cell).toBe('12');
    c.add(4900); expect(r.tick()).toBeNull();
    c.add(200); expect(r.tick()).toBe('go_on');
    expect(r.view().cell).toBe('45');
    c.add(700); r.nextCell('tap');
    const res = r.view().result;
    expect(res.stop_reason).toBe('complete');
    expect(res.cells.map((x) => [x.item_id, x.how])).toEqual([['n1', 'tap'], ['n2', 'auto'], ['n3', 'tap']]);
    expect(res.last_item_index).toBe(2);
  });

  test('advance_after_s null on an untimed task: moves on after next_at_s (15 s), never sooner', () => {
    const t = task({ id: 'ma.add2i', subtask: 'mental_addition', time_limit_s: null, advance_after_s: null, next_at_s: 15, say_on: 'replay',
      items: [item('a1', '13 + 6', { say: '13 plus 6' }), item('a2', '18 + 7')] });
    const { r, c } = run({ battery_id: 'b', tasks: [t] });
    c.add(14000); r.tick();
    expect(r.view().cell_index).toBe(0);
    c.add(1100); r.tick();
    expect(r.view().cell_index).toBe(1);
  });

  test('a spoken practice item (record) is passed by its own target', () => {
    const t = task({ practice: [item('p1', '1', { role: 'example' }), item('p2', '2', { role: 'practice' })] });
    const c = clock();
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [t] }, now: c.now, mic: () => 'ok' });
    r.start(); r.instructionDone();
    expect(r.view().phase).toBe('practice');
    expect(r.practiceAnswer('1').ok).toBe(true);
    expect(r.practiceAnswer('2').ok).toBe(true);
    expect(r.view().phase).toBe('ready');
  });
});
