'use strict';
/**
 * Round 4 re-walk: under sa_cell_pace a cell waited for 3 s of quiet, so in a noisy room it never moved on by itself
 * (a timed maths task ran out on its first item). Ruling: in auto mode a one-at-a-time cell moves on at 10 s on screen,
 * whatever the sound. The 5 s floor and "3 s after the last voice" stay the normal trigger; coach-led cells never move
 * by themselves.
 */
const core = require('../sa/sa-core');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const GRID = ['ر', 'د', 'م', 'ک', 'س'];
function run(opts) {
  const c = clock();
  const battery = { battery_id: 'b', tasks: [{ id: 'ur.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'ur',
    time_limit_s: 60, grid: GRID.slice(), items: [] }] };
  const r = core.createRunner(Object.assign({ battery, now: c.now, mic: () => 'ok', one_at_a_time: true, cell_pace: true }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  const step = (ms, each) => { let out = null; for (let x = 0; x < ms; x += 100) { c.add(100); if (each) each(c.now()); const v = r.tick(); if (v) out = v; } return out; };
  return { r, step };
}

describe('sa_cell_pace: the 10 s cap', () => {
  test('continuous voice: not at 3 s, not before 5 s, still there at 9.9 s, moves on at 10 s', () => {
    const { r, step } = run();
    const voice = () => r.voice();
    step(3000, voice); expect(r.view().cell_index).toBe(0);
    step(2000, voice); expect(r.view().cell_index).toBe(0);
    step(4900, voice); expect(r.view().cell_index).toBe(0);
    expect(step(100, voice)).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
  });
  test('the next cell gets its own 10 s', () => {
    const { r, step } = run();
    const voice = () => r.voice();
    step(10000, voice); expect(r.view().cell_index).toBe(1);
    step(9900, voice); expect(r.view().cell_index).toBe(1);
    step(100, voice); expect(r.view().cell_index).toBe(2);
  });
  test('a silent child still moves on at 5 s (the cap only bites in noise)', () => {
    const { r, step } = run();
    step(4900); expect(r.view().cell_index).toBe(0);
    step(100); expect(r.view().cell_index).toBe(1);
  });
  test('coach-led (manual): never by itself, even past 10 s of voice', () => {
    const { r, step } = run({ manual: true });
    step(30000, () => r.voice());
    expect(r.view().cell_index).toBe(0);
  });
});
