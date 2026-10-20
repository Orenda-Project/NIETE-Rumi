'use strict';
/**
 * The battery runner (dashboard/sa/sa-core.js): the task path, every stop rule, the per-minute score, the event log
 * and the reload rule, on a fake clock.
 */
const { createRunner, validate, normalize, STOP } = require('../sa/sa-core');
const MINI = require('./fixtures/sa-battery.g3-ur.mini.json');

function clock() { let t = 1000; const f = () => t; f.go = (ms) => { t += ms; }; return f; }

const items = (n, target = 'a') => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, target, options: [target, 'x'] }));

function battery(over = {}) {
  return {
    battery_id: 'b',
    tasks: [
      Object.assign({ id: 'letters', mode: 'tap', time_limit_s: 60, item_timeout_s: 10, stop: { type: 'first_row', n: 3 },
        practice: [{ id: 'p1', target: 'a', options: ['a', 'x'] }], items: items(6) }, over.letters),
      Object.assign({ id: 'quant', mode: 'tap', time_limit_s: null, stop: { type: 'consecutive_errors', n: 4 }, items: items(8) }, over.quant),
      Object.assign({ id: 'read', mode: 'record', time_limit_s: 60, grid: ['a', 'b', 'c'], per_row: 10 }, over.read),
    ],
  };
}

function make(b = battery(), extra = {}) {
  const now = clock();
  const events = [];
  const r = createRunner(Object.assign({ battery: b, now, wall: () => 'T', session_id: 's1', onEvent: (e) => events.push(e) }, extra));
  return { r, now, events };
}

function toRunning(r) {
  r.start(); r.instructionPlayed(); r.instructionDone();
  while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target);
  r.begin();
}

test('validate refuses a malformed battery with the reason', () => {
  expect(() => validate({ tasks: [] })).toThrow('no tasks');
  expect(() => validate({ tasks: [{ id: 'a', mode: 'tap', items: [{ id: 'x', target: 'q', options: ['a', 'b'] }] }] })).toThrow('target among them');
  expect(() => validate({ tasks: [{ id: 'a', mode: 'record' }] })).toThrow('grid, a passage or its words');
  expect(() => validate({ tasks: [{ id: 'a', mode: 'nope' }] })).toThrow('no response mode');
  expect(validate(battery())).toBe(true);
});

test('the path: intro → instruction → practice (retry once, then shown) → ready → running', () => {
  const { r, events } = make();
  r.start();
  expect(r.view().phase).toBe('instruction');
  r.instructionPlayed(); r.instructionPlayed();
  expect(events.map((e) => e.type)).toEqual(['session_start', 'task_intro', 'instruction_play', 'instruction_replay']);
  r.instructionDone();
  expect(r.view().phase).toBe('practice');
  expect(r.practiceAnswer('x')).toMatchObject({ ok: false, retry: true, shown: null });
  expect(r.practiceAnswer('x')).toMatchObject({ ok: false, retry: false, shown: 'a' });
  expect(r.view().phase).toBe('ready');
  r.begin();
  expect(r.view()).toMatchObject({ phase: 'running', time_left_ms: 60000, item: { id: 'i0' } });
});

test('time up stops a timed task and scores correct per minute on the seconds used', () => {
  const { r, now } = make();
  toRunning(r);
  r.answer('a'); now.go(5000); r.answer('a'); now.go(5000); r.answer('x');
  now.go(9000); r.tick();
  now.go(9000); r.tick(); // item timeouts: two more wrong answers
  expect(r.view().phase).toBe('running');
  now.go(60000); r.tick();
  const res = r.results()[0];
  expect(res).toMatchObject({ task_id: 'letters', stop_reason: STOP.TIME_UP, correct: 2, time_used_ms: 60000, per_minute: 2, scored_on: 'phone' });
});

test('first line all wrong stops early (EGRA early stop); a right answer in it does not', () => {
  let { r } = make();
  toRunning(r);
  r.answer('x'); r.answer('x'); r.answer('x');
  expect(r.results()[0]).toMatchObject({ stop_reason: STOP.FIRST_LINE, attempted: 3, correct: 0 });
  ({ r } = make());
  toRunning(r);
  r.answer('x'); r.answer('a'); r.answer('x'); r.answer('x');
  expect(r.view().phase).toBe('running');
});

test('an item timeout counts as wrong and feeds the early stop', () => {
  const { r, now, events } = make();
  toRunning(r);
  for (let i = 0; i < 3; i++) { now.go(10000); r.tick(); }
  expect(r.results()[0].stop_reason).toBe(STOP.FIRST_LINE);
  expect(events.filter((e) => e.value === 'timeout')).toHaveLength(3);
});

test('consecutive errors stop an untimed task; a right answer resets the run', () => {
  const { r } = make();
  toRunning(r);
  r.answer('a');
  r.next(); // not at task_end yet: ignored
  for (let i = 0; i < 5; i++) r.answer('a');
  expect(r.results()[0].stop_reason).toBe(STOP.COMPLETE);
  r.next();
  r.instructionDone(); r.begin();
  r.answer('x'); r.answer('x'); r.answer('x'); r.answer('a');
  r.answer('x'); r.answer('x'); r.answer('x');
  expect(r.view().phase).toBe('running');
  r.answer('x');
  expect(r.results()[1]).toMatchObject({ task_id: 'quant', stop_reason: STOP.CONSECUTIVE, per_minute: null, time_left_ms: null });
});

test('a record task ends on "I am done" or time up, scored later', () => {
  const { r, now } = make(battery({ letters: { practice: [] } }));
  r.start(); r.instructionDone(); r.begin();
  for (let i = 0; i < 6; i++) r.answer('a');
  r.next(); r.instructionDone(); r.begin();
  for (let i = 0; i < 8; i++) r.answer('a');
  r.next(); r.instructionDone(); r.begin();
  expect(r.answer('a')).toBeUndefined();
  now.go(20000); r.done();
  expect(r.results()[2]).toMatchObject({ task_id: 'read', mode: 'record', stop_reason: STOP.COMPLETE, last_item_index: null, time_used_ms: 20000, scored_on: 'later' });
  r.next();
  expect(r.view().phase).toBe('battery_end');
});

test('the audio check comes first when asked, and holds until the child hears', () => {
  const { r } = make(battery(), { audio_check: true });
  r.start();
  expect(r.view().phase).toBe('audio_check');
  r.audioCheck(false);
  expect(r.view()).toMatchObject({ phase: 'audio_check', tries: 1 });
  r.audioCheck(true);
  expect(r.view().phase).toBe('instruction');
});

test('every event is numbered in order with the session and a monotonic time', () => {
  const { r, now, events } = make();
  toRunning(r); now.go(1500); r.answer('a'); r.log('handover_in');
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  expect(events.every((e) => e.session_id === 's1')).toBe(true);
  expect(events.slice(-3).map((e) => [e.type, e.t_ms])).toEqual([['tap', 1500], ['item_correct', 1500], ['handover_in', 1500]]);
});

test('a reload resumes at the task it died in, from its start, flagged resumed; done tasks are not asked again', () => {
  const a = make();
  toRunning(a.r);
  for (let i = 0; i < 6; i++) a.r.answer('a');
  a.r.next(); a.r.instructionDone(); a.r.begin(); a.r.answer('x');
  const snap = a.r.snapshot();
  expect(snap).toMatchObject({ task_index: 1, ended: false });
  const b = make(battery(), { resume: snap });
  b.r.start();
  expect(b.events[0]).toMatchObject({ type: 'reload_resume', seq: snap.seq + 1 });
  expect(b.r.view()).toMatchObject({ phase: 'instruction', task: { id: 'quant' } });
  expect(b.events[1]).toMatchObject({ type: 'task_intro', value: { resumed: true } });
  b.r.instructionDone(); b.r.begin();
  for (let i = 0; i < 8; i++) b.r.answer('a');
  expect(b.r.results().map((x) => [x.task_id, x.resumed])).toEqual([['letters', false], ['quant', true]]);
});

test('the coach can end a task (proctored unlock)', () => {
  const { r } = make();
  r.start();
  r.coachEnd();
  expect(r.results()[0]).toMatchObject({ stop_reason: STOP.COACH_END, attempted: 0 });
});

test('the content file reads as is: one response mode per subtask, the SA time rules, the stop rules as data', () => {
  expect(validate(MINI)).toBe(true);
  const b = normalize(MINI);
  const by = Object.fromEntries(b.tasks.map((t) => [t.id, t]));
  expect(Object.fromEntries(b.tasks.map((t) => [t.id, t.mode]))).toEqual({
    'ur.letters': 'tap', 'ur.story': 'record', 'ur.story_comp': 'oral', 'ma.add1': 'keypad', 'ma.add2': 'keypad', 'ma.discrimination': 'tap',
  });
  expect(by['ur.letters']).toMatchObject({ time_limit_s: 60, item_timeout_s: 10, replay_at_s: 5, next_at_s: null, stop: { first_line_n: 10, first_line_min_correct: 1 }, legacy_block: 'ur.letters' });
  expect(by['ma.discrimination']).toMatchObject({ time_limit_s: null, item_timeout_s: null, next_at_s: 15, stop: { consecutive_errors: 4 } });
  expect(by['ur.story_comp'].item_timeout_s).toBe(10);
  expect(by['ur.letters'].items[0]).toMatchObject({ target: by['ur.letters'].items[0].answer, options: by['ur.letters'].items[0].choices });
  expect(normalize(b)).toEqual(b);
});

function real(ids) {
  const b = JSON.parse(JSON.stringify(MINI));
  b.tasks = b.tasks.filter((t) => ids.includes(t.id));
  b.tasks.forEach((t) => { t.practice = []; });
  return b;
}

test('timed tap: Jugnu says it again at 5 s, the item counts wrong at 10 s', () => {
  const { r, now, events } = make(real(['ur.letters']));
  r.start(); r.instructionDone(); r.begin();
  now.go(4900); expect(r.tick()).toBeNull();
  now.go(200); expect(r.tick()).toBe('replay');
  now.go(1000); expect(r.tick()).toBeNull();
  now.go(5000); r.tick();
  expect(events.filter((e) => e.type === 'item_incorrect').map((e) => e.value)).toEqual(['timeout']);
  expect(r.view().item_index).toBe(1);
});

test('the passage: read, then tap the last word; time up also asks for it; the questions asked are the part read', () => {
  const { r, now } = make(real(['ur.story', 'ur.story_comp']));
  r.start(); r.instructionDone(); r.begin();
  now.go(60000); r.tick();
  expect(r.view().phase).toBe('last_word');
  r.lastWord(12); // a word on line 2
  const story = r.results()[0];
  expect(story).toMatchObject({ stop_reason: STOP.TIME_UP, last_word_index: 12, last_word_line: 2, scored_on: 'later', correct: null, time_used_ms: 60000 });
  expect(story).not.toHaveProperty('words_attempted'); // the tap is a gate and a cross-check, never a score (RULING #10a)
  r.next(); r.instructionDone(); r.begin();
  const asked = [];
  while (r.view().phase === 'running') { asked.push(r.view().item.needs_line); r.answer('spoken'); }
  const comp = r.results()[1];
  expect(asked.every((n) => n == null || n <= 2)).toBe(true);
  expect(comp.asked.length).toBe(asked.length);
  expect(comp.asked.length).toBeLessThan(MINI.tasks.find((t) => t.id === 'ur.story_comp').items.length);
  expect(comp).toMatchObject({ mode: 'oral', scored_on: 'later', correct: null, stop_reason: STOP.COMPLETE });
});

test('no last word tapped → the comprehension questions are skipped (no first line)', () => {
  const { r } = make(real(['ur.story', 'ur.story_comp']));
  r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(null); r.next();
  expect(r.results()[1]).toMatchObject({ task_id: 'ur.story_comp', stop_reason: STOP.SKIPPED_NO_LINE, attempted: 0 });
});

test('keypad: typed numbers are scored; level 2 is skipped when level 1 scored 0 (Core EGMA)', () => {
  let { r } = make(real(['ma.add1', 'ma.add2']));
  r.start(); r.instructionDone(); r.begin();
  const first = r.view().item;
  expect(r.answer(String(first.target))).toBe(true);
  expect(r.answer(' 999 ')).toBe(false);
  ({ r } = make(real(['ma.add1', 'ma.add2'])));
  r.start(); r.instructionDone(); r.begin();
  while (r.view().phase === 'running') r.answer('999');
  r.next();
  expect(r.results()[1]).toMatchObject({ task_id: 'ma.add2', stop_reason: STOP.SKIPPED_L2 });
});

test('untimed: "next" is offered at 15 s and counts as wrong; a reload goes on from the item reached', () => {
  const a = make(real(['ma.discrimination']));
  a.r.start(); a.r.instructionDone(); a.r.begin();
  a.now.go(14000); expect(a.r.view().offer_next).toBe(false);
  a.now.go(1000); expect(a.r.view().offer_next).toBe(true);
  expect(a.r.skip()).toBe(false);
  a.r.answer(String(a.r.view().item.target));
  const b = make(real(['ma.discrimination']), { resume: a.r.snapshot() });
  b.r.start();
  b.r.instructionDone(); b.r.begin();
  expect(b.r.view().item_index).toBe(2);
  while (b.r.view().phase === 'running') b.r.answer(String(b.r.view().item.target));
  expect(b.r.results()[0]).toMatchObject({ resumed: true, incorrect: 1, attempted: 10 });
});

test('the warm-up: taps per second, carried on every result', () => {
  const { r, events } = make(real(['ma.discrimination']), { warmup: true });
  r.start();
  expect(r.view().phase).toBe('warmup');
  r.warmupDone(10, 4000);
  expect(events.find((e) => e.type === 'warmup_result').value).toEqual({ taps: 10, ms: 4000, taps_per_s: 2.5 });
  r.instructionDone(); r.begin(); r.coachEnd();
  expect(r.results()[0].taps_per_s).toBe(2.5);
});

test('keyboard (spelling): typed words, case and spaces aside; the typed text is kept', () => {
  const b = { battery_id: 'sp', tasks: [{ id: 'en.spelling', subtask: 'spelling', mode: 'both', items: [{ id: 'w1', answer: 'shop' }, { id: 'w2', answer: 'rice' }] }] };
  const { r } = make(b);
  r.start(); r.instructionDone(); r.begin();
  expect(r.view().task.mode).toBe('keyboard');
  expect(r.view().task.next_at_s).toBe(15);
  expect(r.answer(' Shop ')).toBe(true);
  expect(r.answer('ris')).toBe(false);
  expect(r.results()[0]).toMatchObject({ mode: 'keyboard', correct: 1, scored_on: 'phone', answers: [{ value: ' Shop ', ok: true }, { value: 'ris', ok: false }] });
});

test('a spoken question: the answer window starts when Jugnu has finished asking', () => {
  const { r, now } = make(real(['ur.story', 'ur.story_comp']));
  r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(40); r.next(); r.instructionDone(); r.begin();
  now.go(8000); r.promptDone();
  now.go(9000); r.tick();
  expect(r.view().item_index).toBe(0);
  now.go(1000); r.tick();
  expect(r.view().item_index).toBe(1);
});

test('a tap on the passage is scored by the place tapped, not the word (a word can appear twice)', () => {
  const words = [{ id: 'w0', target: 'My', line: 1 }, { id: 'w1', target: 'cat', line: 1 }, { id: 'w2', target: 'My', line: 2 }];
  const b = { battery_id: 'po', tasks: [{ id: 'en.print_orientation', mode: 'tap', tap_on: 'passage', option_images: null,
    passage: { text: 'My cat My', words, direction: 'ltr' },
    items: [{ id: 'q1', target: 'My', target_index: 2 }, { id: 'q2', target: '→', options: ['→', '←', '↑', '↓'] }] }] };
  expect(validate(b)).toBe(true);
  const { r } = make(b);
  r.start(); r.instructionDone(); r.begin();
  expect(r.view().task.tap_on).toBe('passage');
  expect(r.answer(0)).toBe(false); // the first "My" is not the one asked for
  expect(r.answer('→')).toBe(true);
  const { r: r2 } = make(b);
  r2.start(); r2.instructionDone(); r2.begin();
  expect(r2.answer(2)).toBe(true);
});

describe('car 4a: the session gates and the run-time guards', () => {
  const rec = { id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a b' }, items: [{ id: 'w1', target: 'a', line: 1 }] };
  const oral = { id: 'comp', mode: 'oral', items: [{ id: 'q1' }, { id: 'q2' }] };
  const keys = { id: 'add1', mode: 'keypad', time_limit_s: 60, items: [{ id: 'k1', target: '4' }, { id: 'k2', target: '5' }] };
  const tap = { id: 'letters', mode: 'tap', time_limit_s: 60, items: items(6) };
  const bat = (...t) => ({ battery_id: 'g', tasks: t });
  function through(r) { // instruction → practice → ready → running for whatever task is up
    if (r.view().phase === 'instruction') r.instructionDone();
    while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target);
    r.begin();
  }

  test('proctored: no mic_ok → a record or oral task is skipped as mic_unavailable, never recorded', () => {
    const { r } = make(bat(tap, rec, oral), { mic: () => 'no' });
    r.start(); through(r); for (let i = 0; i < 6; i++) r.answer('a');
    r.next();
    expect(r.results()[1]).toMatchObject({ task_id: 'story', stop_reason: STOP.MIC });
    r.next();
    expect(r.results()[2]).toMatchObject({ task_id: 'comp', stop_reason: STOP.MIC });
  });

  test('no mic: a question task hanging on the passage says mic_unavailable, not "no first line"', () => {
    const dep = Object.assign({}, oral, { depends_on: { task: 'story', upto_item: 'last_word_tap' } });
    const { r } = make(bat(rec, dep), { mic: () => 'no' });
    r.start(); r.next();
    expect(r.results().map((x) => [x.task_id, x.stop_reason])).toEqual([['story', STOP.MIC], ['comp', STOP.MIC]]);
  });

  test('game: the mic check comes once, before the first task that records; a pass is kept for the run', () => {
    const { r, events } = make(bat(rec, oral), { mic: () => 'unknown', mic_check: true, oral_practice: false });
    r.start();
    expect(r.view().phase).toBe('mic_check');
    r.micChecked(true, 0.031); // the phone could not store it (a private tab): the pass still holds for the run
    expect(events.find((e) => e.type === 'mic_check').value).toEqual({ ok: true, rms: 0.031 });
    expect(r.view()).toMatchObject({ phase: 'instruction', task: { id: 'story' } });
    r.coachEnd(); r.next();
    expect(r.view()).toMatchObject({ phase: 'instruction', task: { id: 'comp' } });
  });

  test('game: a failed mic check skips the recording tasks as mic_unavailable', () => {
    const { r } = make(bat(rec), { mic: () => 'unknown', mic_check: true });
    r.start(); r.micChecked(false, 0);
    expect(r.results()[0]).toMatchObject({ stop_reason: STOP.MIC });
  });

  test('one practice oral question before the first oral task of the session, then never again', () => {
    const { r, events } = make(bat(oral, Object.assign({}, oral, { id: 'comp2' })), { mic: () => 'ok', oral_practice: true });
    r.start();
    expect(r.view().phase).toBe('oral_practice');
    r.oralPracticeDone(true);
    expect(events.find((e) => e.type === 'oral_practice').value).toEqual({ heard: true });
    expect(r.view().phase).toBe('instruction');
    through(r); r.answer('spoken'); r.answer('spoken'); r.next();
    expect(r.view()).toMatchObject({ phase: 'instruction', task: { id: 'comp2' } });
  });

  test('a keypad warm-up before the first keypad task of the run, once', () => {
    const { r, events } = make(bat(keys, Object.assign({}, keys, { id: 'sub1' })), { keypad_warmup: true });
    r.start();
    expect(r.view().phase).toBe('keypad_warmup');
    r.keypadWarmupDone(14);
    expect(events.find((e) => e.type === 'keypad_warmup').value).toEqual({ keys: 14 });
    through(r); r.answer('4'); r.answer('5'); r.next();
    expect(r.view()).toMatchObject({ phase: 'instruction', task: { id: 'sub1' } });
  });

  test('visibility lost in a timed task: the task runs again from its start, resumed; elapsed_ms on results', () => {
    const { r, now, events } = make(bat(tap, keys));
    r.start(); through(r); r.answer('a'); now.go(3000);
    r.visibilityLost();
    expect(events.some((e) => e.type === 'visibility_lost')).toBe(true);
    expect(r.view()).toMatchObject({ phase: 'instruction', task: { id: 'letters' } });
    through(r); now.go(2000); for (let i = 0; i < 6; i++) r.answer('a');
    expect(r.results()[0]).toMatchObject({ resumed: true, correct: 6, elapsed_ms: 2000, time_used_ms: 2000 });
  });

  test('visibility lost in an untimed task is only logged', () => {
    const { r } = make(bat(oral), { mic: () => 'ok' });
    r.start(); through(r); r.answer('spoken'); r.visibilityLost();
    expect(r.view()).toMatchObject({ phase: 'running', item_index: 1 });
  });

  test('the mercy rule on the passage: the star is offered once, silence ends it as early_stop_silence', () => {
    const { r, now } = make(bat(rec), { mic: () => 'ok' });
    r.start(); through(r);
    now.go(12000); r.mercyOffered();
    now.go(8000); r.silence(20);
    expect(r.results()[0]).toMatchObject({ stop_reason: STOP.SILENCE, mercy_offered: true, silence_s: 20, last_word_index: null });
  });
});

test('the mercy timings come from the battery, 12 s / 20 s only as the fallback', () => {
  const b = normalize({ tasks: [
    { id: 's1', mode: 'record', passage: { text: 'a' }, mercy_after_s: 10, silence_stop_s: 18 },
    { id: 's2', mode: 'record', passage: { text: 'a' }, record: { mercy_after_s: 14 } },
    { id: 's3', mode: 'record', passage: { text: 'a' } }] });
  expect(b.tasks.map((t) => [t.mercy_after_s, t.silence_stop_s])).toEqual([[10, 18], [14, 20], [12, 20]]);
});

test('an item\'s shown text is its label (the sum the child sees)', () => {
  const b = normalize({ tasks: [{ id: 'ma.add1', mode: 'keypad', items: [{ id: 'k', answer: 4, shown: '1 + 3 =' }, { id: 'k2', answer: 5, label: '2 + 3 =', shown: 'x' }] }] });
  expect(b.tasks[0].items.map((i) => i.label)).toEqual(['1 + 3 =', '2 + 3 =']);
});

test('the recorder could not listen (a sleeping audio engine): the passage runs its clock, the result says so', () => {
  const b = { battery_id: 'e', tasks: [{ id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a' }, items: [{ id: 'w', target: 'a', line: 1 }] }] };
  const { r, now } = make(b, { mic: () => 'ok' });
  r.start(); r.instructionDone(); r.begin();
  r.earUnavailable();
  now.go(60000); r.tick(); r.lastWord(0);
  expect(r.results()[0]).toMatchObject({ stop_reason: STOP.TIME_UP, mercy_ear: 'unavailable', mercy_offered: false });
});
