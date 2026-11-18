'use strict';
/**
 * Round 28 C (sa_r28_ceiling with sa_r8_counts): a timed task's `base_n` is the number of items the route SERVES as
 * today's base, never the bank's constant. The words tasks are built with base_n 4; sa_r8_counts serves a 5th word (the
 * counts spare, the extension's own `.05`, deduped by src), so with counts ON the served base is 5 and with counts OFF
 * it is 4. Letters (5) and numbers (8) have no spare and keep their base. The phone records the served base on its
 * result (only when the ceiling runs and the task carries one), so the scorer reads the base the child was served.
 * Synthetic fixtures only.
 */
const { applySwitches } = require('../routes/sa-battery-switches');
const core = require('../sa/sa-core');

const pad = (n) => String(n).padStart(2, '0');
// the official source list the counts spare comes from (sa_r8_counts PLAN: en.words, at [4])
const SOURCE = { id: 'en.words', items: Array.from({ length: 10 }, (_, k) => ({ id: `en.words.${pad(k + 1)}`, target: `w${k + 1}`, src: `fixture:en.words.items[${k}]` })) };
const word = (k, ext) => ({ id: `en.words4.${pad(k + 1)}`, show: `w${k + 1}`, target: `w${k + 1}`, answer: `w${k + 1}`, src: `fixture:en.words.items[${k}]`, ...(ext ? { ext: true } : {}) });
/** the committed words task: today's 4 items, then the extension whose first item (.05) is the counts spare */
const words = () => ({
  id: 'en.words4', w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time',
  time_limit_s: 60, advance_after_s: 3, stop: {}, practice: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
  items: [0, 1, 2, 3].map((k) => word(k)), grid: ['w1', 'w2', 'w3', 'w4'],
  base_n: 4, ext_items: Array.from({ length: 8 }, (_, j) => word(4 + j, true)), ext_stop: { type: 'first_row', n: 5 },
});
const letters = () => ({
  id: 'en.letter_names5', w3: true, kind: 'grid', subtask: 'letter_name_identification', lang: 'en', response: 'record', present: 'one_at_a_time',
  time_limit_s: 60, stop: {}, practice: [{ id: 'p1' }, { id: 'p2' }],
  items: Array.from({ length: 5 }, (_, k) => ({ id: `en.letter_names5.${pad(k + 1)}`, show: 'bcdfg'[k], target: 'bcdfg'[k], src: `fixture:letters[${k}]` })),
  grid: 'bcdfg'.split(''), base_n: 5,
  ext_items: Array.from({ length: 5 }, (_, j) => ({ id: `en.letter_names5.${pad(6 + j)}`, show: 'hjklm'[j], target: 'hjklm'[j], src: `fixture:letters[${5 + j}]`, ext: true })),
  ext_stop: { type: 'first_row', n: 10 },
});
const BUILT = () => ({ battery_id: 'b', lang: 'en', tasks: [SOURCE, letters(), words()] });
const ON = { rdfW3Forms: true, r28Ceiling: true };
const served = (on) => applySwitches(BUILT(), on).tasks.find((t) => t.id === 'en.words4');

describe('the served base: words base_n follows sa_r8_counts', () => {
  test('counts ON: words base_n 5, the spare is the extension\'s own .05 (not added twice), ext items from .06', () => {
    const t = served({ ...ON, r8Counts: true });
    expect(t.base_n).toBe(5);
    expect(t.items).toHaveLength(12);
    expect(t.items[4].id).toBe('en.words4.05');
    expect(t.items.slice(0, 5).some((x) => x.ext)).toBe(true); // the spare is .05 of the extension
    expect(t.items[5].id).toBe('en.words4.06');
    expect(t.items.map((x) => x.id)).toEqual(Array.from({ length: 12 }, (_, k) => `en.words4.${pad(k + 1)}`));
  });
  test('counts OFF: words base_n 4', () => {
    const t = served(ON);
    expect(t.base_n).toBe(4);
    expect(t.items).toHaveLength(12);
  });
  test('letters keep base_n 5 either way (no spare)', () => {
    for (const on of [ON, { ...ON, r8Counts: true }]) expect(applySwitches(BUILT(), on).tasks.find((t) => t.id === 'en.letter_names5').base_n).toBe(5);
  });
  test('ceiling OFF, counts ON: no base_n is served (today\'s counts form, 5 items)', () => {
    const t = served({ rdfW3Forms: true, r8Counts: true });
    expect(t).not.toHaveProperty('base_n');
    expect(t.items.map((x) => x.id)).toEqual(['en.words4.01', 'en.words4.02', 'en.words4.03', 'en.words4.04', 'en.words4.05']);
  });
});

describe('the phone records the base it was served (sa_r28_ceiling)', () => {
  function run(served, ceiling) {
    const { practice: _p, ...task } = served; // the run starts at the items (the practice screens are not this test's)
    let t = 0;
    const opts = { battery: { battery_id: 'b', tasks: [task] }, now: () => t, mic: () => 'ok', one_at_a_time: true, manual: true };
    if (ceiling !== undefined) opts.ceiling = ceiling;
    const r = core.createRunner(opts);
    r.start(); r.instructionDone(); r.begin();
    for (let k = 0; k < 7; k += 1) { t += 1000; r.nextCell('tap'); }
    t = 61000; r.tick();
    return r.view().result;
  }
  test('ON, counts ON: result.base_n 5', () => {
    expect(run(served({ ...ON, r8Counts: true }), true).base_n).toBe(5);
  });
  test('ON, counts OFF: result.base_n 4', () => {
    expect(run(served(ON), true).base_n).toBe(4);
  });
  test('the engine option OFF: no base_n on the result (today\'s result keys)', () => {
    expect(run(served({ ...ON, r8Counts: true })).hasOwnProperty('base_n')).toBe(false);
    expect(run(served({ rdfW3Forms: true, r8Counts: true }), true).hasOwnProperty('base_n')).toBe(false);
  });
});
