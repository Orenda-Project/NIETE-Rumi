'use strict';
/**
 * Round 5: the tester, on prod: letter names, letter sounds and words moved on by themselves too fast. "Please do not
 * automatically go on and wait until Next is selected." Switch sa_cell_next_only (default OFF): a one-at-a-time letter
 * or word cell (Urdu and English reading tasks) never moves on by itself, in auto and coach-led runs, voice or not;
 * only Next moves on. The task's clock runs as today (time up still ends the task), and the 20-s silence stop no
 * longer ends these tasks early. ON, it wins over sa_cell_pace for these tasks; maths cells keep their pace.
 * OFF, the battery and the run are as before.
 */
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const UR = ['ر', 'د', 'م', 'ک', 'س'];
const EN = ['m', 's', 'a', 't', 'p'];
const WORDS_UR = ['گھر', 'پانی', 'کتاب', 'سکول'];
const WORDS_EN = ['cat', 'sun', 'dog', 'map'];
// Every letter/word family the served batteries run one at a time: the W3 forms (present one_at_a_time) and the
// older recorded grids under sa_one_at_a_time.
const FAMILIES = [
  { id: 'ur.letter_names5', subtask: 'letter_name_identification', lang: 'ur', grid: UR, present: 'one_at_a_time' },
  { id: 'ur.letter_sounds5', subtask: 'letter_sound_identification', lang: 'ur', grid: UR, present: 'one_at_a_time' },
  { id: 'ur.words4', subtask: 'familiar_word_reading', lang: 'ur', grid: WORDS_UR, present: 'one_at_a_time' },
  { id: 'en.letter_names5', subtask: 'letter_name_identification', lang: 'en', grid: EN, present: 'one_at_a_time' },
  { id: 'en.letter_sounds5', subtask: 'letter_sound_identification', lang: 'en', grid: EN, present: 'one_at_a_time' },
  { id: 'en.words4', subtask: 'familiar_word_reading', lang: 'en', grid: WORDS_EN, present: 'one_at_a_time' },
  { id: 'ur.letter_sounds_rec', subtask: 'letter_sound_identification', lang: 'ur', grid: UR },
  { id: 'ur.words_rec', subtask: 'familiar_word_reading', lang: 'ur', grid: WORDS_UR },
  { id: 'en.letter_sounds_rec', subtask: 'letter_sound_identification', lang: 'en', grid: EN },
  { id: 'en.words_rec', subtask: 'familiar_word_reading', lang: 'en', grid: WORDS_EN },
  { id: 'en.nonwords_rec', subtask: 'invented_word_reading', lang: 'en', grid: ['lat', 'mip', 'dov', 'sut'] },
];
function taskOf(f) {
  const t = { id: f.id, subtask: f.subtask, response: 'record', lang: f.lang, time_limit_s: 60, grid: f.grid.slice(), items: [] };
  if (f.present) { t.present = f.present; t.advance_after_s = 3; }
  return t;
}
function run(t, opts) {
  const c = clock();
  const r = core.createRunner(Object.assign({ battery: { battery_id: 'b', tasks: [t] }, now: c.now, mic: () => 'ok', one_at_a_time: true }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  const step = (ms, each) => { let out = null; for (let x = 0; x < ms; x += 100) { c.add(100); if (each) each(); const v = r.tick(); if (v) out = v; } return out; };
  return { r, c, step };
}
const MODES = { auto: {}, manual: { manual: true } };

describe('sa_cell_next_only ON: a letter or word never moves on by itself; Next does', () => {
  for (const f of FAMILIES) {
    for (const [mode, extra] of Object.entries(MODES)) {
      for (const paced of [false, true]) {
        test(`${f.id} · ${mode}${paced ? ' · with sa_cell_pace' : ''}: still on item 1 at 3, 5, 10 and 30 s; Next moves on`, () => {
          const { r, step } = run(taskOf(f), Object.assign({ cell_next_only: true, cell_pace: paced }, extra));
          let said = null;
          for (const [ms, at] of [[3000, 3], [2000, 5], [5000, 10], [20000, 30]]) {
            const v = step(ms, mode === 'auto' && at === 10 ? () => r.voice() : null);
            if (v) said = v;
            expect([at, r.view().phase, r.view().cell_index]).toEqual([at, 'running', 0]);
          }
          expect(said).toBeNull();
          r.nextCell('tap');
          expect(r.view().cell_index).toBe(1);
          const kept = r.view();
          expect(kept.phase).toBe('running');
        });
      }
    }
  }
  test('the task clock keeps running: time up at 60 s still ends the task', () => {
    const { r, step } = run(taskOf(FAMILIES[0]), { cell_next_only: true });
    step(59900); expect(r.view().phase).toBe('running');
    step(100); expect(r.view().phase).toBe('task_end');
  });
  test('per-item timing is kept: the cell moved on by Next carries its ms and how', () => {
    const { r, step } = run(taskOf(FAMILIES[3]), { cell_next_only: true });
    step(12000);
    r.nextCell('tap');
    step(4000);
    r.nextCell('tap');
    const evs = [];
    const c = clock();
    const r2 = core.createRunner({ battery: { battery_id: 'b', tasks: [taskOf(FAMILIES[3])] }, now: c.now, mic: () => 'ok', cell_next_only: true, onEvent: (e) => evs.push(e) });
    r2.start(); r2.instructionDone(); r2.begin();
    for (let x = 0; x < 7000; x += 100) { c.add(100); r2.tick(); }
    r2.nextCell('tap');
    const cell = evs.filter((e) => e.type === 'cell_next').map((e) => e.value)[0];
    expect(cell).toMatchObject({ i: 0, how: 'tap', ms: 7000 });
  });
  test('the 20-s silence stop and the mercy line do not end or nag a next-only cell', () => {
    const { r } = run(taskOf(FAMILIES[0]), { cell_next_only: true });
    r.mercyOffered();
    r.silence(20);
    expect(r.view().phase).toBe('running');
    expect(r.view().cell_index).toBe(0);
  });
  test('maths cells keep their pace (number identification still moves on by itself)', () => {
    const t = { id: 'ma.number_id8', subtask: 'number_identification', response: 'record', lang: 'en', time_limit_s: 60, present: 'one_at_a_time',
      advance_after_s: 5, grid: ['7', '12', '30', '45'], items: [] };
    const { r, step } = run(t, { cell_next_only: true });
    expect(step(5000)).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
  });
  test('runner.holdsCell() says when the task on show is a next-only cell', () => {
    const on = run(taskOf(FAMILIES[0]), { cell_next_only: true }).r;
    const off = run(taskOf(FAMILIES[0])).r;
    expect(on.holdsCell()).toBe(true);
    expect(off.holdsCell()).toBe(false);
  });
});

describe('OFF: as before', () => {
  test('a W3 letter cell still moves on at 3 s (auto)', () => {
    const { r, step } = run(taskOf(FAMILIES[0]));
    expect(step(3000)).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
  });
  test('silence still ends the task', () => {
    const { r } = run(taskOf(FAMILIES[0]));
    r.silence(20);
    expect(r.view().phase).toBe('task_end');
  });
});

describe('the switch reaches the battery as ui.cell_next_only', () => {
  const b = { battery_id: 'b', tasks: [{ id: 't' }] };
  test('named sa_cell_next_only; ON adds ui.cell_next_only; OFF no ui key', () => {
    expect(SWITCHES.cellNextOnly).toBe('sa_cell_next_only');
    expect(applySwitches(b, { cellNextOnly: true, rdfW3Forms: true }).ui).toEqual({ cell_next_only: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});

describe('the engine: ui.cell_next_only reaches the runner, and a next-only cell has no silence watch', () => {
  const { start } = require('../sa/sa-engine');
  const tick = (ms = 15) => new Promise((res) => setTimeout(res, ms));
  async function boot(ui) {
    const store = await storeMod.open({ idb: null });
    let silenceWatched = 0;
    const battery = { battery_id: 'b', ui, tasks: [taskOf(FAMILIES[3])] };
    let hooks = null;
    const fakeRec = { ready: async () => true, start: () => true, stop: async () => null, recording: () => false,
      onSilence: () => { silenceWatched++; return () => {}; }, onVoice: () => () => {} };
    const c = clock();
    const e = await start({ mount: {}, battery, mode: 'proctored', lang: 'en', session_id: 's-next', audio_check: false, warmup: false, now: c.now }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { hooks = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
      rec: { create: () => fakeRec }, micState: () => 'ok', now: c.now,
    });
    const r = e.runner;
    r.start(); r.instructionDone(); r.begin();
    hooks.onRecordStart(r.view().task);
    await tick();
    const step = (ms) => { let out = null; for (let x = 0; x < ms; x += 100) { c.add(100); const v = r.tick(); if (v) out = v; } return out; };
    return { r, step, silenceWatched: () => silenceWatched };
  }
  test('ON: no auto move at 30 s, and no silence watch on the cell task', async () => {
    const x = await boot({ cell_next_only: true });
    expect(x.step(30000)).toBeNull();
    expect(x.r.view().cell_index).toBe(0);
    expect(x.silenceWatched()).toBe(0);
  });
  test('OFF: the cell moves on at 3 s, and the silence watch runs', async () => {
    const x = await boot({});
    expect(x.step(3000)).toBe('go_on');
    expect(x.silenceWatched()).toBe(1);
  });
});
