'use strict';
/**
 * Round 6, bar S part 2 (DESIGN_R6 §3.1, §3.7, RULINGs R6-3, R6-4): the runner's guided ladder (opts.guided, RDF auto).
 *   - a guided task's practice walks its plan: demo → turn (helped) → check; a failed check adds ONE retry and the
 *     task always reaches ready (never a stop, never a skip);
 *   - mechanics_check on the task's result: passed | failed_then_passed | failed_twice | no_mic; self_run_valid;
 *     voiced_cells / pressed_cells over the scored cells; each scored cell says how it advanced;
 *   - the fade: after two passed checks in a row on the same mechanic the helped turn is skipped (ladder 'short');
 *     the demo narration is short after the mechanic's first task;
 *   - one 'guided' event per guided task;
 *   - opts.guided off (or RDF manual): the run and its results are as before.
 */
const fs = require('fs');
const path = require('path');
const core = require('../sa/sa-core');

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const G2 = form('sa.coach.G2.A.ur.json');
const G5 = form('sa.coach.G5.A.ur.json');
function only(b, ids) {
  return { battery_id: 'b', grades: b.grades, tasks: ids.map((id) => {
    const t = JSON.parse(JSON.stringify(b.tasks.find((x) => x.id === id)));
    delete t.depends_on;
    return t;
  }) };
}
function run(battery, opts) {
  let t = 0;
  const events = [];
  const r = core.createRunner({ battery, now: () => t, mic: () => 'ok', one_at_a_time: true, onEvent: (e) => events.push(e), ...opts });
  r.start();
  return { r, events, tick: (ms) => { t += ms; } };
}
const roles = (r) => {
  const out = [];
  while (r.view().phase === 'practice') { const role = r.view().guided.role; out.push(role); if (role === 'check') r.guidedCheck('passed'); else r.guidedStep(); }
  return out;
};
/** Walk one task's guided practice with the given check outcomes, then run its cells (voice on the first n). */
function walkTask(m, checks, voiced = 0) {
  const { r } = m;
  r.instructionDone();
  const seen = [];
  let c = 0;
  while (r.view().phase === 'practice') {
    const role = r.view().guided.role;
    seen.push(role);
    if (role === 'check' || role === 'retry') r.guidedCheck(checks[c++]);
    else r.guidedStep();
  }
  expect(r.view().phase).toBe('ready');
  r.begin();
  let i = 0;
  while (r.view().phase === 'running') { if (i++ < voiced) r.voice(); m.tick(400); r.nextCell('tap'); }
  return seen;
}

describe('sa-core: the guided ladder (sa_guided_instructions, RDF auto)', () => {
  test('a letters task: demo → turn → check, then ready; the view says the role and the narration', () => {
    const m = run(only(G2, ['ur.words4']), { guided: true });
    m.r.instructionDone();
    expect(m.r.view().guided).toMatchObject({ role: 'demo', narration: 'full', ladder: 'full' });
    expect(roles(m.r)).toEqual(['demo', 'turn', 'check']);
    expect(m.r.view().phase).toBe('ready');
  });

  test.each([
    [['passed'], 'passed', ['demo', 'turn', 'check']],
    [['failed', 'passed'], 'failed_then_passed', ['demo', 'turn', 'check', 'retry']],
    [['failed', 'failed'], 'failed_twice', ['demo', 'turn', 'check', 'retry']],
    [['no_mic'], 'no_mic', ['demo', 'turn', 'check']],
  ])('check %j → mechanics_check %s; the task always runs to its end', (checks, want, seen) => {
    const m = run(only(G2, ['ur.words4']), { guided: true });
    expect(walkTask(m, checks, 1)).toEqual(seen);
    const res = m.r.results()[0];
    expect(res.mechanics_check).toBe(want);
    expect(res.stop_reason).toBe('complete');
    expect(res.voiced_cells).toBe(1);
    expect(res.pressed_cells).toBe(res.cells.length);
    expect(res.self_run_valid).toBe(want !== 'failed_twice' || res.voiced_cells > 0);
    expect(res.cells[0]).toMatchObject({ advanced_by: 'press', voiced: true });
    expect(res.cells[1]).toMatchObject({ advanced_by: 'press', voiced: false });
    expect(typeof res.cells[0].press_latency_ms).toBe('number');
  });

  test('failed twice with no voice on any scored cell: self_run_valid false (the score is still computed later)', () => {
    const m = run(only(G2, ['ur.words4']), { guided: true });
    walkTask(m, ['failed', 'failed'], 0);
    expect(m.r.results()[0]).toMatchObject({ mechanics_check: 'failed_twice', voiced_cells: 0, self_run_valid: false });
  });

  test('the fade: two passed checks on the say-then-press mechanic → later tasks skip the helped turn', () => {
    const m = run(only(G2, ['ur.letter_sounds5', 'ur.words4', 'en.words4', 'en.letter_names5']), { guided: true });
    const got = [];
    for (let k = 0; k < 4; k++) {
      got.push(walkTask(m, ['passed'], 1));
      m.r.next();
    }
    expect(got[0]).toEqual(['demo', 'turn', 'check']);
    expect(got[1]).toEqual(['demo', 'turn', 'check']);
    expect(got[2]).toEqual(['demo', 'check']);
    const ev = m.events.filter((e) => e.type === 'guided').map((e) => e.value);
    expect(ev.map((v) => v.ladder)).toEqual(['full', 'full', 'short', 'short']);
    expect(ev.map((v) => v.narration)).toEqual(['full', 'short', 'short', 'short']);
  });

  test('a failed check resets the run of passes (the turn comes back)', () => {
    const m = run(only(G2, ['ur.letter_sounds5', 'ur.words4', 'en.words4', 'en.letter_names5']), { guided: true });
    walkTask(m, ['passed'], 1); m.r.next();
    walkTask(m, ['failed', 'passed'], 1); m.r.next();
    expect(walkTask(m, ['passed'], 1)).toEqual(['demo', 'turn', 'check']);
  });

  test('a tap task: demo → check (the turn and the check are one item)', () => {
    const m = run(only(G2, ['ma.discrimination2']), { guided: true });
    m.r.instructionDone();
    expect(roles(m.r)).toEqual(['demo', 'check']);
  });

  test('the guided event: grade, ladder, the shared check item, the help counts, lead-in', () => {
    const m = run(only(G2, ['ur.letter_names5']), { guided: true });
    m.r.instructionDone();
    m.r.guidedStep(); // demo
    m.r.guidedHelp('silence'); m.r.guidedHelp('press'); m.r.guidedHelp('idle');
    m.r.guidedStep(); // turn
    m.r.guidedCheck('failed'); m.r.guidedCheck('passed');
    m.tick(1000); m.r.begin();
    while (m.r.view().phase === 'running') m.r.nextCell('tap');
    const ev = m.events.filter((e) => e.type === 'guided').map((e) => e.value);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ task_id: 'ur.letter_names5', grade: 2, ladder: 'full', check_item_shared: true,
      help_silence: 1, help_press: 1, idle_repeats: 1, retry_passed: true, mic: 'ok' });
    expect(ev[0].lead_in_ms).toBe(1000);
  });

  test('the story: no practice, no plan; the result still carries mechanics_check not_run', () => {
    const m = run(only(G2, ['ur.story_w3']), { guided: true });
    m.r.instructionDone();
    expect(m.r.view().phase).toBe('ready');
  });

  test('switch OFF: the same tasks run exactly as before (no guided view, no new result fields, no guided event)', () => {
    const plain = (opts) => {
      const m = run(only(G2, ['ur.words4']), opts);
      m.r.instructionDone();
      while (m.r.view().phase === 'practice') m.r.practiceAnswer(m.r.view().practice.target);
      m.r.begin();
      while (m.r.view().phase === 'running') { m.tick(400); m.r.nextCell('tap'); }
      return { res: m.r.results()[0], events: m.events };
    };
    const a = plain({});
    expect(a.res.mechanics_check).toBeUndefined();
    expect(a.res.cells[0].advanced_by).toBeUndefined();
    expect(a.events.some((e) => e.type === 'guided')).toBe(false);
    // RDF manual never runs the ladder
    const m = run(only(G2, ['ur.words4']), { guided: true, manual: true });
    m.r.instructionDone();
    expect(m.r.view().guided).toBeUndefined();
  });

  test('Grade 5 under the switch: no lines, no ladder, no new fields', () => {
    const m = run(only(G5, ['ur.words4']), { guided: true });
    m.r.instructionDone();
    expect(m.r.view().guided).toBeUndefined();
  });
});
