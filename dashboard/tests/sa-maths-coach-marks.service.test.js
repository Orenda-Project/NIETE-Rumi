'use strict';
/**
 * Coach-marked mental maths (switch sa_maths_coach_marks, OFF by default): the paper-EGMA way. On the spoken maths
 * tasks (number identification, mental addition / subtraction / multiplication, the 1-minute fluency) the coach's
 * screen shows each item, its answer and big Right / Wrong buttons; one tap marks the item and shows the next. The
 * fluency keeps its 60 s clock (with the seconds left for the coach), one tap per item, and stops at time. The score
 * is the phone's (scored_on 'coach'), posted with the batch; the recording goes on as a backup.
 * OFF: no ui key on the battery, the runner and the screens are what they were.
 * The DOM tests run where jsdom resolves (the portal's dev dependency); the rest run everywhere.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const core = require('../sa/sa-core');

function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const ADD = {
  id: 'ma.add2i', subtask: 'mental_addition', response: 'record', present: 'one_at_a_time', time_limit_s: null, advance_after_s: null,
  next_at_s: 15, say_on: 'replay', items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19, answer: 19, say: '13 plus 6' }, { id: 'ma.add2i.02', show: '18 + 7', target: 25, answer: 25, say: '18 plus 7' }],
};
const FLUENCY = {
  id: 'ma.fluency1m', subtask: 'mental_math_fluency', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5, say_on: 'replay',
  items: Array.from({ length: 20 }, (_, k) => ({ id: `ma.fluency1m.${k + 1}`, show: `${k} + 1`, target: k + 1, answer: k + 1 })),
};
const NUMBERS = {
  id: 'ma.number_id8', subtask: 'number_identification', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 5,
  items: [{ id: 'n1', show: '9', target: 9 }, { id: 'n2', show: '14', target: 14 }],
};
const LETTERS = {
  id: 'en.letter_names5', subtask: 'letter_name_identification', response: 'record', present: 'one_at_a_time', time_limit_s: 60, advance_after_s: 3,
  lang: 'en', grid: ['i', 'y'], items: [{ id: 'l1', show: 'i', target: 'i' }, { id: 'l2', show: 'y', target: 'y' }],
};

function run(task, opts) {
  const c = clock();
  const events = [];
  const r = core.createRunner(Object.assign({ battery: { battery_id: 'b', tasks: [task] }, now: c.now, onEvent: (e) => events.push(e), mic: () => 'ok' }, opts || {}));
  r.start(); r.instructionDone(); r.begin();
  return { r, c, events };
}

describe('the runner (coach_marks)', () => {
  test('a mental sum: Right / Wrong mark the item, the next one shows, and the result is the coach\'s score', () => {
    const { r, c, events } = run(ADD, { coach_marks: true });
    expect(r.view().coach_marks).toBe(true);
    expect(r.view().cell_item.target).toBe(19);
    c.add(2500);
    r.mark(true);
    expect(r.view().cell).toBe('18 + 7');
    c.add(4000);
    r.mark(false);
    const v = r.view();
    expect(v.phase).toBe('task_end');
    expect(v.result).toEqual(expect.objectContaining({ scored_on: 'coach', correct: 1, incorrect: 1, attempted: 2, stop_reason: 'complete', per_minute: null }));
    expect(v.result.answers).toEqual([
      { item_id: 'ma.add2i.01', value: 'right', ok: true, ms: 2500, by: 'coach' },
      { item_id: 'ma.add2i.02', value: 'wrong', ok: false, ms: 4000, by: 'coach' },
    ]);
    expect(v.result.cells.map((x) => x.how)).toEqual(['mark', 'mark']);
    expect(events.filter((e) => e.type === 'coach_mark').map((e) => [e.item_id, e.value])).toEqual([['ma.add2i.01', 'right'], ['ma.add2i.02', 'wrong']]);
  });

  test('the fluency: 60 s across the items, one tap per item, never moved on by itself, stops at time with a rate', () => {
    const { r, c } = run(FLUENCY, { coach_marks: true, one_at_a_time: true });
    c.add(6000); expect(r.tick()).toBeNull();
    expect(r.view().cell_index).toBe(0); // 5 s alone no longer moves it on: the coach taps
    r.mark(true); c.add(10000); r.mark(true); c.add(10000); r.mark(false);
    c.add(40000); r.tick();
    const v = r.view();
    expect(v.phase).toBe('task_end');
    expect(v.result).toEqual(expect.objectContaining({ scored_on: 'coach', stop_reason: 'time_up', correct: 2, incorrect: 1, attempted: 3, per_minute: 2 }));
  });

  test('number identification is coach-marked too; a letter task is not (its mark() does nothing)', () => {
    const n = run(NUMBERS, { coach_marks: true });
    expect(n.r.view().coach_marks).toBe(true);
    const l = run(LETTERS, { coach_marks: true });
    expect(l.r.view().coach_marks).toBeFalsy();
    l.r.mark(true);
    expect(l.r.view().cell_index).toBe(0);
    l.c.add(70000); l.r.tick();
    expect(l.r.view().result.scored_on).toBe('later');
  });

  test('OFF: no marking, the fluency moves on by itself at 5 s, and the result is scored later as before', () => {
    const { r, c } = run(FLUENCY, { one_at_a_time: true });
    expect(r.view().coach_marks).toBeFalsy();
    expect(typeof r.mark).toBe('function');
    r.mark(true);
    expect(r.view().cell_index).toBe(0);
    c.add(5100); expect(r.tick()).toBe('go_on');
    expect(r.view().cell_index).toBe(1);
    c.add(60000); r.tick();
    expect(r.view().result).toEqual(expect.objectContaining({ scored_on: 'later', correct: null }));
  });
});

describe('the battery as served (sa-battery-switches)', () => {
  const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
  const b = { battery_id: 'x', tasks: [{ id: 't', mode: 'tap' }] };
  test('sa_maths_coach_marks ON adds ui.maths_coach_marks; OFF the battery is byte for byte as before', () => {
    expect(SWITCHES.mathsCoachMarks).toBe('sa_maths_coach_marks');
    expect(applySwitches(b, { mathsCoachMarks: true }).ui).toEqual({ maths_coach_marks: true });
    expect(JSON.stringify(applySwitches(b, { mathsCoachMarks: false }))).toBe(JSON.stringify(b));
  });
});

describe('the engine passes ui.maths_coach_marks to the runner (coach mode only)', () => {
  const storeMod = require('../sa/sa-store');
  const { start } = require('../sa/sa-engine');
  async function boot(battery, extra) {
    let runnerOpts = null;
    const store = await storeMod.open({ idb: null });
    const e = await start(Object.assign({ mount: {}, mode: 'proctored', lang: 'en', audio_check: false, warmup: false, battery }, extra),
      { core: { ...core, createRunner: (o) => { runnerOpts = o; return core.createRunner(o); } }, store: { open: async () => store },
        ui: { mount: () => ({}) }, voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, win: {}, micState: () => 'ok' });
    return { e, runnerOpts };
  }
  test('ON in coach mode; a game never; OFF false', async () => {
    const on = await boot({ battery_id: 'b', tasks: [ADD], ui: { maths_coach_marks: true } }, {});
    expect(on.runnerOpts.coach_marks).toBe(true);
    on.e.destroy();
    const game = await boot({ battery_id: 'b2', tasks: [ADD], ui: { maths_coach_marks: true } }, { mode: 'game' });
    expect(game.runnerOpts.coach_marks).toBe(false);
    game.e.destroy();
    const off = await boot({ battery_id: 'b3', tasks: [ADD] }, {});
    expect(off.runnerOpts.coach_marks).toBe(false);
    off.e.destroy();
  });
});

maybe('the coach\'s marking screen', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms) => new Promise((r) => setTimeout(r, ms || 20));
  function mount(task, runnerOpts, uiOpts) {
    const c2 = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    let t = 0;
    const clk = { now: () => t, add: (ms) => { t += ms; } };
    const runner = c2.createRunner(Object.assign({ battery: { battery_id: 'b', tasks: [task] }, now: clk.now, mic: () => 'ok' }, runnerOpts));
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: { tasks: [task] }, lang: 'en', mode: 'proctored', speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    return { runner, el, view, said, clk };
  }

  test.each([['en', 'Answer', 'Right', 'Wrong'], ['ur', 'جواب', 'صحیح', 'غلط']])('%s: the item, its answer, Right / Wrong; a tap marks and shows the next', async (lang, answer, right, wrong) => {
    const { runner, el } = mount(ADD, { coach_marks: true }, { lang });
    await flush();
    expect(el.querySelector('.sae-onecell').textContent).toBe('13 + 6');
    const panel = el.querySelector('.sae-marks.is-coach');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('.sae-mark-answer').textContent).toBe(`${answer}: 19`);
    expect(panel.querySelector('.sa-mark-right').textContent).toContain(right);
    expect(panel.querySelector('.sa-mark-wrong').textContent).toContain(wrong);
    expect(el.querySelector('.sa-next')).toBeNull();
    panel.querySelector('.sa-mark-right').click(); await flush();
    expect(el.querySelector('.sae-onecell').textContent).toBe('18 + 7');
    expect(el.querySelector('.sae-mark-answer').textContent).toBe(`${answer}: 25`);
    el.querySelector('.sa-mark-wrong').click(); await flush();
    expect(runner.results()[0]).toEqual(expect.objectContaining({ scored_on: 'coach', correct: 1, incorrect: 1 }));
  });

  test('the fluency shows the coach the seconds left, counting down', async () => {
    const { el, clk } = mount(FLUENCY, { coach_marks: true, one_at_a_time: true }, {});
    await flush();
    expect(el.querySelector('.sae-mark-secs').textContent).toBe('60 s');
    clk.add(12400); await flush(300);
    expect(el.querySelector('.sae-mark-secs').textContent).toBe('48 s');
  });

  test('OFF: Next as before, no marking panel', async () => {
    const { el } = mount(ADD, {}, {});
    await flush();
    expect(el.querySelector('.sae-marks')).toBeNull();
    expect(el.querySelector('.sa-next')).not.toBeNull();
  });
});
