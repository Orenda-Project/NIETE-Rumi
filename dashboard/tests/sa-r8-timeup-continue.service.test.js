'use strict';
/**
 * Round 8: a part's clock running out ends that part only (battery.ui.r8_timeup_continue, switch sa_r8_timeup_continue).
 * With round 7b's move-on rule (sa_incomplete_move_on) on in RDF auto, a time-up counted as "did not finish" and skipped
 * the rest of the subject: a slow child lost every later Urdu, English or maths part to one clock. ON: time-up = that
 * part done; the next part of the same subject runs. Still "did not finish" (the rest of the subject skipped): EGRA's /
 * EGMA's early-stop rule, the story's silence stop, "I'm done" before the last cell, the last-word tap before the last
 * word, and a spoken question left unanswered when its own wait ran out. OFF: the runner as before.
 */
const core = require('../sa/sa-core');

const PASSAGE = (id, n = 20) => ({ id, mode: 'record', subtask: 'oral_reading_fluency', time_limit_s: 60, passage: { text: 'x' },
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, target: `w${i + 1}`, line: 1 + Math.floor(i / 5) })) });
const QUESTIONS = (id, story) => ({ id, mode: 'oral', subtask: 'reading_comprehension', question_timeout_s: 10, depends_on: { task: story, upto_item: 'last_word_tap' },
  items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });
const CELLS = (id, n = 8) => ({ id, mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
  items: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, target: `w${i + 1}`, show: `w${i + 1}` })) });
const TAP = (id, n = 4, extra = {}) => ({ id, mode: 'tap', items: Array.from({ length: n }, (_, i) => ({ id: `${id.replace(/\W/g, '')}${i + 1}`, target: 'a', options: ['a', 'b'] })), ...extra });
const ORAL = (id) => ({ id, mode: 'oral', question_timeout_s: 10, items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });

// RDF auto as the engine starts it in prod: no last-word step, the move-on rule on.
const AUTO = { skip_last_word: true, incomplete: true };

function run(tasks, ui, o = {}) {
  let t = 0;
  const events = [];
  const battery = { battery_id: 'b', tasks, ...(ui ? { ui } : {}) };
  const r = core.createRunner({ battery, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e), ...AUTO, ...o });
  r.start();
  const enter = () => { if (r.view().phase === 'instruction') r.instructionDone(); if (r.view().phase === 'ready') r.begin(); };
  enter();
  const x = {
    r, events, enter,
    clock: (ms) => { t += ms; },
    tick: (ms) => { t += ms; return r.tick(); },
    // the recorder opened for the part on show (the engine logs it), and its ear listens for a voice
    recording: (watch = true) => { r.log('record_start', { task_id: r.view().task.id }); if (watch) r.voiceWatch(); },
    // one voice run of n reports, 100 ms apart (as sa-rec.js onVoice calls back), then a pause
    voiceRun: (n) => { for (let i = 0; i < n; i++) { t += 100; r.voice(); } t += 1000; },
    ids: () => r.results().map((res) => [res.task_id, res.stop_reason]),
    of: (type) => events.filter((e) => e.type === type),
  };
  return x;
}
const LANGS = ['ur', 'en'];
const next = (x) => { x.r.next(); return x.r.view().task && x.r.view().task.id; };

describe('r8_timeup_continue: a part\'s clock running out ends that part only', () => {
  const ONT = { r8_timeup_continue: true };
  for (const L of LANGS) {
    test(`${L}: letters one at a time, time up on cell 3 of 8 → the next part of ${L} runs`, () => {
      const x = run([CELLS(`${L}.letter_names5`), CELLS(`${L}.words4`, 4), TAP(L === 'ur' ? 'en.a' : 'ma.a')], ONT);
      x.r.nextCell('tap'); x.r.nextCell('tap');
      x.tick(61000);
      expect(x.ids()).toEqual([[`${L}.letter_names5`, 'time_up']]);
      expect(x.of('incomplete_move_on')).toHaveLength(0);
      expect(next(x)).toBe(`${L}.words4`);
    });
    test(`${L}: the story's time up → its questions are asked`, () => {
      const x = run([PASSAGE(`${L}.story_w3`), QUESTIONS(`${L}.story_comp_w3`, `${L}.story_w3`)], ONT);
      x.tick(61000);
      expect(x.of('incomplete_move_on')).toHaveLength(0);
      expect(next(x)).toBe(`${L}.story_comp_w3`);
    });
    test(`${L}: "I'm done" before the last cell still skips the rest of ${L} (stopped_early)`, () => {
      const x = run([CELLS(`${L}.letter_names5`), CELLS(`${L}.words4`, 4), TAP(L === 'ur' ? 'en.a' : 'ma.a')], ONT);
      x.r.nextCell('tap');
      x.r.done();
      expect(x.ids()).toEqual([[`${L}.letter_names5`, 'complete'], [`${L}.words4`, 'skipped_incomplete']]);
      expect(x.of('incomplete_move_on')[0].value).toMatchObject({ reason: 'stopped_early' });
    });
  }
  test('maths: number identification (one at a time) time up on number 3 of 8 → the next maths part runs', () => {
    const x = run([CELLS('ma.number_id8'), TAP('ma.discrimination2', 2)], ONT);
    x.r.nextCell('tap'); x.r.nextCell('tap');
    x.tick(61000);
    expect(x.ids()).toEqual([['ma.number_id8', 'time_up']]);
    expect(next(x)).toBe('ma.discrimination2');
  });
  test('maths: a timed tap part, time up before the last item → the next maths part runs', () => {
    const x = run([TAP('ma.a', 20, { time_limit_s: 60 }), TAP('ma.b')], ONT);
    x.r.answer('a');
    x.tick(61000);
    expect(x.ids()).toEqual([['ma.a', 'time_up']]);
    expect(next(x)).toBe('ma.b');
  });
  test('still skips: the early-stop rule (stop_rule)', () => {
    const x = run([TAP('ma.a', 10, { stop: { consecutive_errors: 4 } }), TAP('ma.b')], ONT);
    for (let i = 0; i < 4; i++) x.r.answer('b');
    expect(x.ids()).toEqual([['ma.a', 'consecutive_errors'], ['ma.b', 'skipped_incomplete']]);
  });
  test('still skips: the silence stop on the story', () => {
    const x = run([PASSAGE('ur.s'), QUESTIONS('ur.q', 'ur.s'), TAP('en.a')], ONT);
    x.r.silence(20);
    expect(x.ids()).toEqual([['ur.s', 'early_stop_silence'], ['ur.q', 'skipped_incomplete']]);
  });
  test('still skips: a spoken question left unanswered when its own wait ran out', () => {
    const x = run([ORAL('ma.o'), TAP('ma.b')], ONT);
    x.r.answer('spoken');
    x.tick(11000);
    expect(x.ids()).toEqual([['ma.o', 'complete'], ['ma.b', 'skipped_incomplete']]);
  });
  test('OFF: today exactly — a time-up skips the rest of the subject', () => {
    const x = run([CELLS('ma.number_id8'), TAP('ma.discrimination2', 2)], null);
    x.r.nextCell('tap');
    x.tick(61000);
    expect(x.ids()).toEqual([['ma.number_id8', 'time_up'], ['ma.discrimination2', 'skipped_incomplete']]);
  });
  test('without the move-on rule (sa_incomplete_move_on off) the switch changes nothing', () => {
    const x = run([CELLS('ur.w'), CELLS('ur.v', 4)], ONT, { incomplete: false });
    x.tick(61000);
    expect(next(x)).toBe('ur.v');
    expect(x.of('incomplete_move_on')).toHaveLength(0);
  });
});

