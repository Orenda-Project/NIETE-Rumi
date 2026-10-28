'use strict';
/**
 * Round 7b, part B (the tester's 27 Oct list, items 3–5): the runner (sa-core).
 *   sa_end_section   RDF manual: endSection() ends the task on show as end_section and skips the rest of its section
 *                    (Urdu → English → maths) as skipped_end_section; one end_section event { by:'coach', section }.
 *   (item 5, the move-on when a part is not finished: sa-r7b-incomplete-move-on.service.test.js)
 *   sa_silence_repeat RDF auto: a spoken part with no voice heard → silence_reminder (one silence_repeat event), then the
 *                    part again from its start; a second silence goes on as before.
 * Each OFF (no option): the runner as before.
 */
const core = require('../sa/sa-core');

const tapItems = (n, pre) => Array.from({ length: n }, (_, i) => ({ id: `${pre}${i + 1}`, target: 'a', options: ['a', 'b'] }));
const TAP = (id, n = 10) => ({ id, mode: 'tap', items: tapItems(n, id.replace(/\W/g, '')) });
const CELLS = (id, n = 10) => ({ id, mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
  items: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, target: `w${i + 1}`, show: `w${i + 1}` })) });
const PASSAGE = (id, n = 20) => ({ id, mode: 'record', time_limit_s: 60, passage: { text: 'x' },
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, target: `w${i + 1}`, line: 1 + Math.floor(i / 5) })) });
const ORAL = (id) => ({ id, mode: 'oral', items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });

function run(tasks, o = {}) {
  let t = 0;
  const events = [];
  const r = core.createRunner({ battery: { battery_id: 'b', tasks }, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e), ...o });
  r.start();
  const enter = () => { if (r.view().phase === 'instruction') r.instructionDone(); if (r.view().phase === 'ready') r.begin(); };
  enter();
  return { r, events, enter, tick: (ms) => { t += ms; return r.tick(); }, types: () => events.map((e) => e.type) };
}
const ids = (x) => x.r.results().map((res) => [res.task_id, res.stop_reason]);

describe('sa_end_section (RDF manual)', () => {
  const B = [TAP('ur.a', 4), TAP('ur.b', 4), TAP('en.c', 4), TAP('ma.d', 4)];
  test('ON: ends the task as end_section, skips the rest of the section, the test goes on at the next section', () => {
    const x = run(B, { manual: true, end_section: true });
    x.r.answer('a');
    x.r.endSection();
    expect(ids(x)).toEqual([['ur.a', 'end_section'], ['ur.b', 'skipped_end_section']]);
    const ev = x.events.find((e) => e.type === 'end_section');
    expect(ev).toMatchObject({ task_id: 'ur.a', value: { by: 'coach', section: 'ur' } });
    expect(x.events.filter((e) => e.type === 'end_section')).toHaveLength(1);
    expect(x.r.results()[1]).toMatchObject({ scored_on: 'none', attempted: 0 });
    expect(x.r.view().phase).toBe('task_end');
    x.r.next();
    expect(x.r.view().task.id).toBe('en.c');
    expect(x.r.snapshot().task_index).toBe(2);
  });
  test('ON, from the instruction screen too; the last section ends the battery after next()', () => {
    const x = run([TAP('ma.a', 2), TAP('ma.b', 2)], { manual: true, end_section: true });
    x.r.next(); // no-op while running
    x.r.endSection();
    expect(ids(x)).toEqual([['ma.a', 'end_section'], ['ma.b', 'skipped_end_section']]);
    x.r.next();
    expect(x.r.view().phase).toBe('battery_end');
  });
  test('OFF, or RDF auto: endSection does nothing', () => {
    for (const o of [{ manual: true }, { end_section: true }]) {
      const x = run(B, o);
      x.r.endSection();
      expect(x.r.results()).toEqual([]);
      expect(x.r.view().phase).toBe('running');
      expect(x.types()).not.toContain('end_section');
    }
  });
});

describe('sa_silence_repeat (RDF auto)', () => {
  const recOpen = (x, id) => x.r.log('record_start', { task_id: id });
  test('ON, a read-aloud part with no voice heard: the reminder, one event, then the part again from its start', () => {
    const x = run([CELLS('ur.w', 3), TAP('ur.b', 2)], { silence_repeat: true });
    recOpen(x, 'ur.w');
    x.r.nextCell('tap'); x.r.nextCell('tap'); x.r.nextCell('tap');
    expect(x.r.view().phase).toBe('silence_reminder');
    expect(x.r.results()).toEqual([]);
    expect(x.events.filter((e) => e.type === 'silence_repeat')).toEqual([expect.objectContaining({ task_id: 'ur.w', value: { by: 'app', attempt: 1 } })]);
    x.r.silenceRepeatDone();
    expect(x.r.view().phase).toBe('instruction');
    expect(x.r.view().task.id).toBe('ur.w');
    x.enter(); recOpen(x, 'ur.w');
    x.r.nextCell('tap'); x.r.nextCell('tap'); x.r.nextCell('tap');
    expect(ids(x)).toEqual([['ur.w', 'complete']]);
    expect(x.events.filter((e) => e.type === 'silence_repeat')).toHaveLength(1);
  });
  test('ON, a voice heard: no reminder', () => {
    const x = run([CELLS('ur.w', 2)], { silence_repeat: true });
    recOpen(x, 'ur.w');
    x.r.voice();
    x.r.nextCell('tap'); x.r.nextCell('tap');
    expect(ids(x)).toEqual([['ur.w', 'complete']]);
  });
  test('ON, the passage\'s silence stop (20 s, no voice): the reminder first, early_stop_silence the second time', () => {
    const x = run([PASSAGE('ur.s', 5)], { silence_repeat: true, skip_last_word: true });
    recOpen(x, 'ur.s');
    x.r.silence(20);
    expect(x.r.view().phase).toBe('silence_reminder');
    x.r.silenceRepeatDone(); x.enter(); recOpen(x, 'ur.s');
    x.r.silence(20);
    expect(ids(x)).toEqual([['ur.s', 'early_stop_silence']]);
  });
  test('ON, the ear unavailable, or no recording opened: no reminder', () => {
    const a = run([CELLS('ur.w', 1)], { silence_repeat: true });
    recOpen(a, 'ur.w'); a.r.earUnavailable(); a.r.nextCell('tap');
    expect(ids(a)).toEqual([['ur.w', 'complete']]);
    const b = run([CELLS('ur.w', 1)], { silence_repeat: true });
    b.r.nextCell('tap');
    expect(ids(b)).toEqual([['ur.w', 'complete']]);
  });
  test('the repeat is remembered across a reload (snapshot gates)', () => {
    const x = run([CELLS('ur.w', 1), TAP('ur.b', 1)], { silence_repeat: true });
    recOpen(x, 'ur.w'); x.r.nextCell('tap');
    expect(x.r.snapshot().gates.silence_repeated).toEqual({ 'ur.w': true });
  });
  test('OFF, or RDF manual: no reminder', () => {
    for (const o of [{}, { silence_repeat: true, manual: true }]) {
      const x = run([CELLS('ur.w', 1)], o);
      recOpen(x, 'ur.w'); x.r.nextCell('tap');
      expect(ids(x)).toEqual([['ur.w', 'complete']]);
    }
  });
});
