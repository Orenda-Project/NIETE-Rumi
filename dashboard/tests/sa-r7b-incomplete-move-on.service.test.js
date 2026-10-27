'use strict';
/**
 * Round 7b item 5, the tester's final rule (27 Oct): "If they can't finish any section (ie completion, not correctness),
 * it doesn't continue to the next section and automatically goes to the next subject."
 * Switch sa_incomplete_move_on (battery.ui.incomplete_move_on → the runner's opts.incomplete), RDF auto only.
 * A part is NOT complete when the phone knows the child did not reach its end:
 *   read-aloud cells (one at a time): time ran out before the child moved past the last cell → time_up;
 *                                     "I'm done" before the last cell → stopped_early
 *   any part EGRA/EGMA's own early-stop rule ended → stop_rule
 *   the story: time ran out → time_up; the last-word tap before the last word → last_word_early; the silence stop → silence;
 *              "I'm done" with no last-word step → complete (no other signal on the phone)
 *   tap / keypad parts: time ran out before the last item → time_up (all answered, right or wrong, is complete)
 *   spoken questions: a question left with no answer when its time ran out → time_up
 * Then the rest of that subject is skipped (skipped_incomplete) and the child goes to the next subject (ur → en → ma;
 * after maths the test ends). One incomplete_move_on event { by:'app', section, reason, reached, of }, only when
 * something is skipped. OFF, or RDF manual: the runner as before.
 */
const core = require('../sa/sa-core');

const tapItems = (n, pre) => Array.from({ length: n }, (_, i) => ({ id: `${pre}${i + 1}`, target: 'a', options: ['a', 'b'] }));
const TAP = (id, n = 4, extra = {}) => ({ id, mode: 'tap', items: tapItems(n, id.replace(/\W/g, '')), ...extra });
const CELLS = (id, n = 10) => ({ id, mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
  items: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, target: `w${i + 1}`, show: `w${i + 1}` })) });
const PASSAGE = (id, n = 20) => ({ id, mode: 'record', time_limit_s: 60, passage: { text: 'x' },
  items: Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, target: `w${i + 1}`, line: 1 + Math.floor(i / 5) })) });
const ORAL = (id) => ({ id, mode: 'oral', question_timeout_s: 10, items: [{ id: 'q1', prompt: { en: 'q' } }, { id: 'q2', prompt: { en: 'q' } }] });

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
const moveOn = (x) => x.events.filter((e) => e.type === 'incomplete_move_on');
const ON = { incomplete: true };

describe('sa_incomplete_move_on: a part not finished skips the rest of its subject (RDF auto)', () => {
  test('cells: time up before the last cell → time_up; the rest of Urdu skipped; English starts', () => {
    const x = run([CELLS('ur.w', 10), TAP('ur.b'), TAP('en.c')], ON);
    x.r.nextCell('tap'); x.r.nextCell('tap'); x.r.nextCell('tap');
    x.tick(61000);
    expect(ids(x)).toEqual([['ur.w', 'time_up'], ['ur.b', 'skipped_incomplete']]);
    expect(moveOn(x)).toHaveLength(1);
    expect(moveOn(x)[0]).toMatchObject({ task_id: 'ur.w', value: { by: 'app', section: 'ur', reason: 'time_up', reached: 3, of: 10 } });
    expect(x.r.results()[1]).toMatchObject({ scored_on: 'none', attempted: 0 });
    x.r.next();
    expect(x.r.view().task.id).toBe('en.c');
  });
  test('cells: moved past the last cell → complete, no move-on', () => {
    const x = run([CELLS('ur.w', 3), TAP('ur.b')], ON);
    x.r.nextCell('tap'); x.r.nextCell('tap'); x.r.nextCell('tap');
    expect(ids(x)).toEqual([['ur.w', 'complete']]);
    expect(moveOn(x)).toHaveLength(0);
    x.r.next();
    expect(x.r.view().task.id).toBe('ur.b');
  });
  test('cells: "I\'m done" before the last cell → stopped_early', () => {
    const x = run([CELLS('en.w', 10), TAP('en.b'), TAP('ma.c')], { ...ON, skip_last_word: true });
    x.r.nextCell('tap'); x.r.nextCell('tap');
    x.r.done();
    expect(ids(x)).toEqual([['en.w', 'complete'], ['en.b', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toEqual({ by: 'app', section: 'en', reason: 'stopped_early', reached: 2, of: 10 });
  });
  test('story: time up → time_up; its questions skipped; maths starts', () => {
    const x = run([PASSAGE('en.s', 20), ORAL('en.q'), TAP('ma.a')], { ...ON, skip_last_word: true });
    x.tick(61000);
    expect(ids(x)).toEqual([['en.s', 'time_up'], ['en.q', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toEqual({ by: 'app', section: 'en', reason: 'time_up', reached: null, of: 20 });
    x.r.next();
    expect(x.r.view().task.id).toBe('ma.a');
  });
  test('story: "I\'m done" with no last-word step → complete, the questions are asked', () => {
    const x = run([PASSAGE('en.s', 20), ORAL('en.q')], { ...ON, skip_last_word: true });
    x.tick(20000); x.r.done();
    expect(moveOn(x)).toHaveLength(0);
    x.r.next();
    expect(x.r.view().task.id).toBe('en.q');
  });
  test('story with the last-word step: a tap before the last word → last_word_early; on the last word → complete', () => {
    const early = run([PASSAGE('ur.s', 20), ORAL('ur.q'), TAP('en.a')], ON);
    early.tick(20000); early.r.done(); early.r.lastWord(5);
    expect(ids(early)).toEqual([['ur.s', 'complete'], ['ur.q', 'skipped_incomplete']]);
    expect(moveOn(early)[0].value).toEqual({ by: 'app', section: 'ur', reason: 'last_word_early', reached: 6, of: 20 });
    const whole = run([PASSAGE('ur.s', 20), ORAL('ur.q')], ON);
    whole.tick(20000); whole.r.done(); whole.r.lastWord(19);
    expect(moveOn(whole)).toHaveLength(0);
  });
  test('story: time up but the last word tapped is the last one → complete', () => {
    const x = run([PASSAGE('ur.s', 20), ORAL('ur.q')], ON);
    x.tick(61000); x.r.lastWord(19);
    expect(ids(x)).toEqual([['ur.s', 'time_up']]);
    expect(moveOn(x)).toHaveLength(0);
  });
  test('story: the silence stop → silence', () => {
    const x = run([PASSAGE('ur.s', 20), ORAL('ur.q'), TAP('en.a')], ON);
    x.r.silence(20);
    expect(ids(x)).toEqual([['ur.s', 'early_stop_silence'], ['ur.q', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toMatchObject({ reason: 'silence', section: 'ur' });
  });
  test('tap: every item answered, all wrong → complete (completion, not correctness)', () => {
    const x = run([TAP('ma.a', 4), TAP('ma.b')], ON);
    for (let i = 0; i < 4; i++) x.r.answer('b');
    expect(ids(x)).toEqual([['ma.a', 'complete']]);
    expect(moveOn(x)).toHaveLength(0);
  });
  test('tap, timed: time up before the last item → time_up; maths is the last subject, so the test ends', () => {
    const x = run([TAP('ma.a', 20, { time_limit_s: 60 }), TAP('ma.b')], ON);
    x.r.answer('a'); x.r.answer('a');
    x.tick(61000);
    expect(ids(x)).toEqual([['ma.a', 'time_up'], ['ma.b', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toEqual({ by: 'app', section: 'ma', reason: 'time_up', reached: 2, of: 20 });
    x.r.next();
    expect(x.r.view().phase).toBe('battery_end');
  });
  test('the early-stop rule → stop_rule', () => {
    const x = run([TAP('ma.a', 10, { stop: { consecutive_errors: 4 } }), TAP('ma.b')], ON);
    for (let i = 0; i < 4; i++) x.r.answer('b');
    expect(ids(x)).toEqual([['ma.a', 'consecutive_errors'], ['ma.b', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toMatchObject({ reason: 'stop_rule', reached: 4, of: 10 });
  });
  test('spoken questions: a question that timed out with no answer → time_up', () => {
    const x = run([ORAL('ma.o'), TAP('ma.b')], ON);
    x.r.answer('spoken');
    x.tick(11000);
    expect(ids(x)).toEqual([['ma.o', 'complete'], ['ma.b', 'skipped_incomplete']]);
    expect(moveOn(x)[0].value).toMatchObject({ reason: 'time_up', reached: 1, of: 2 });
  });
  test('spoken questions all answered → complete', () => {
    const x = run([ORAL('ma.o'), TAP('ma.b')], ON);
    x.r.answer('spoken'); x.r.answer('spoken');
    expect(moveOn(x)).toHaveLength(0);
  });
  test('the last part of a subject not finished: nothing to skip, no event', () => {
    const x = run([CELLS('ur.w', 10), TAP('en.c')], ON);
    x.tick(61000);
    expect(ids(x)).toEqual([['ur.w', 'time_up']]);
    expect(moveOn(x)).toHaveLength(0);
    x.r.next();
    expect(x.r.view().task.id).toBe('en.c');
  });
  test('a coach\'s End test is not this rule', () => {
    const x = run([TAP('ur.a', 10), TAP('ur.b')], ON);
    x.r.coachEnd();
    expect(moveOn(x)).toHaveLength(0);
  });
  test('OFF, or RDF manual: no move-on', () => {
    for (const o of [{}, { incomplete: true, manual: true }]) {
      const x = run([CELLS('ur.w', 10), TAP('ur.b')], o);
      x.tick(61000);
      if (x.r.view().phase === 'last_word') x.r.lastWord(2);
      expect(ids(x)).toEqual([['ur.w', 'time_up']]);
      x.r.next();
      expect(x.r.view().task.id).toBe('ur.b');
      expect(x.types()).not.toContain('incomplete_move_on');
    }
  });
});
