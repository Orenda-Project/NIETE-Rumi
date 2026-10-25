'use strict';
/**
 * Round 6, bar S (DESIGN_R6 §3): the guided tier in RDF auto on the Grade 1-3 forms (switch sa_guided_instructions,
 * default OFF → battery.ui.guided → the runner's and the page's guided, coach mode, never manual).
 *   runner  the practice walks the plan (demo → turn → check), a missed check adds ONE retry and never stops the task,
 *           nudges cap at 2, one 'guided' event per task; the scored items and clock are the task's own (R6-3);
 *   page    the steps said in order and lit, the demo done by Jugnu, help on silence, the check's miss → the retry line,
 *           the ready line in place of test_intro + begin;
 *   switch  OFF strips script.guided (the served battery as before); ON adds ui.guided; the engine passes it on.
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
function alone(f, id) {
  const b = form(f);
  const t = JSON.parse(JSON.stringify(b.tasks.find((x) => x.id === id)));
  delete t.depends_on;
  return { battery_id: 'b', grades: b.grades, tasks: [t] };
}
const words = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text || x.en || '');

describe('runner: the guided practice plan (sa-core)', () => {
  const core = require('../sa/sa-core');
  function run(battery, o = {}) {
    let t = 0;
    const events = [];
    const r = core.createRunner({ battery, now: () => t, mic: () => 'ok', one_at_a_time: true, onEvent: (e) => events.push(e), ...o });
    r.start();
    return { r, events, add: (ms) => { t += ms; } };
  }
  const b = () => alone('sa.coach.G2.A.en.json', 'en.words4');

  test('demo → turn → check on the plan\'s items, then ready', () => {
    const bat = b();
    const { r } = run(bat, { guided: true });
    r.instructionDone();
    const seen = [];
    while (r.view().phase === 'practice') { const v = r.view(); seen.push([v.guided_role, v.practice.id]); r.practiceAnswer(v.practice.target); }
    const pr = bat.tasks[0].practice;
    expect(seen).toEqual([['demo', pr[0].id], ['turn', pr[1].id], ['check', pr[2].id]]);
    expect(r.view().phase).toBe('ready');
  });

  test('a missed check adds one retry on the plan\'s retry item, once; the task goes on (R6-4)', () => {
    const bat = b();
    const { r, events } = run(bat, { guided: true });
    r.instructionDone();
    r.practiceAnswer(r.view().practice.target); // demo
    r.practiceAnswer(r.view().practice.target); // turn
    expect(r.view().guided_role).toBe('check');
    r.guidedCheck(false, true);
    expect(r.view().guided_role).toBe('retry');
    expect(r.view().practice.id).toBe(bat.tasks[0].practice[0].id);
    r.practiceAnswer(r.view().practice.target);
    expect(r.view().phase).toBe('ready');
    r.begin(); r.coachEnd();
    const g = events.find((e) => e.type === 'guided');
    expect(g.value).toMatchObject({ task_id: 'en.words4', grade: 2, check: 'failed', help_lines: 0, nudges: 0 });
    expect(typeof g.value.lead_in_ms).toBe('number');
  });

  test('help lines and nudges are counted; a third nudge is refused', () => {
    const { r, events } = run(b(), { guided: true });
    r.instructionDone();
    r.practiceAnswer(r.view().practice.target);
    expect(r.guidedHelp('silence')).toBe(true);
    r.practiceAnswer(r.view().practice.target);
    r.guidedCheck(true, false);
    r.practiceAnswer(r.view().practice.target);
    r.begin();
    expect([r.guidedHelp('nudge'), r.guidedHelp('nudge'), r.guidedHelp('nudge')]).toEqual([true, true, false]);
    r.coachEnd();
    expect(events.find((e) => e.type === 'guided').value).toMatchObject({ check: 'helped', help_lines: 1, nudges: 2 });
  });

  test('R6-3: the scored items, their order and the clock are the same guided or not', () => {
    const a = run(b(), { guided: true }).r;
    const n = run(b(), {}).r;
    for (const r of [a, n]) { r.instructionDone(); while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target); r.begin(); }
    const pick = (v) => ({ cells: v.cells_n, time_left_ms: v.time_left_ms, first: v.cell_item && v.cell_item.id });
    expect(pick(a.view())).toEqual(pick(n.view()));
  });

  test('not guided (switch OFF), manual, or a Grade 5 form: the practice list as before, no guided event', () => {
    const cases = [[b(), {}], [b(), { guided: true, manual: true }], [alone('sa.coach.G5.A.en.json', 'en.words4'), { guided: true }]];
    for (const [bat, o] of cases) {
      const { r, events } = run(bat, o);
      r.instructionDone();
      const ids = [];
      while (r.view().phase === 'practice') { expect(r.view().guided_role).toBeUndefined(); ids.push(r.view().practice.id); r.practiceAnswer(r.view().practice.target); }
      expect(ids).toEqual(bat.tasks[0].practice.map((p) => p.id));
      r.begin(); r.coachEnd();
      expect(events.some((e) => e.type === 'guided')).toBe(false);
    }
  });
});

maybe('page: the guided screens and lines (sa-ui)', () => {
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
  const flush = (ms) => new Promise((res) => setTimeout(res, ms || 20));
  function mount(battery, o = {}) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    let level = null;
    const runner = core.createRunner({ battery, now: () => Date.now(), mic: () => 'ok', one_at_a_time: true, guided: o.guided !== false });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: o.lang || 'en', mode: 'proctored', guided: o.guided !== false,
      guide_ms: { silence: 120, press: 120, check: 150, instr: 150, nudge: 100, ...(o.guide_ms || {}) },
      micLevel: (cb) => { level = cb; return () => { level = null; }; },
      speak: (x) => { said.push(words(x)); return Promise.resolve(); } });
    views.push(view);
    runner.start(); view.render();
    return { runner, el, view, said, voice: () => level && level(0.9) };
  }
  const g = (bat) => bat.tasks[0].script.guided;

  test('the instruction: each step said in order and lit; not the one-clip intro', async () => {
    const bat = alone('sa.coach.G2.A.ur.json', 'ur.words4');
    const x = mount(bat, { lang: 'ur' });
    await flush(60);
    const steps = g(bat).steps.map(words);
    expect(x.said.slice(0, steps.length)).toEqual(steps);
    expect(x.said).not.toContain(words(bat.tasks[0].instruction || bat.tasks[0].script.intro));
    const lis = x.el.querySelectorAll('.sae-guided .sae-steps li');
    expect(lis.length).toBe(steps.length);
    expect(lis[steps.length - 1].className).toBe('is-now');
    expect(x.el.querySelector('.sae-guided-ex.sae-dim')).not.toBeNull();
    await flush(250);
    expect(x.said).toContain(words(g(bat).instr_silence));
  });

  test('the demo is Jugnu\'s: the demo line, the model, the press; then the child\'s turn, helped on silence', async () => {
    const bat = alone('sa.coach.G2.A.en.json', 'en.words4');
    const x = mount(bat);
    await flush(30);
    x.el.querySelector('.sae-foot .sa-next').click();
    await flush(700);
    const p0 = bat.tasks[0].practice[0];
    expect(x.said).toContain(words(g(bat).demo));
    expect(x.said).toContain(words(p0.model[0]));
    expect(x.said).toContain(words(g(bat).demo_after));
    expect(x.runner.view().guided_role).toBe('turn');
    expect(x.said).toContain(words(g(bat).turn));
    await flush(250);
    expect(x.said).toContain(words(g(bat).help_silence));
    expect(x.said).toContain(words(g(bat).help_say_now));
  });

  test('the check missed (no voice, no Next) → the retry line on the retry item; then the ready line, no test_intro', async () => {
    const bat = alone('sa.coach.G2.A.en.json', 'en.words4');
    const x = mount(bat);
    await flush(30);
    x.el.querySelector('.sae-foot .sa-next').click();
    await flush(700);
    x.voice();
    x.el.querySelector('.sae-foot .sa-next').click(); // the turn, with voice
    await flush(60);
    expect(x.runner.view().guided_role).toBe('check');
    await flush(300);
    expect(x.runner.view().guided_role).toBe('retry');
    expect(x.said).toContain(words(g(bat).retry));
    x.el.querySelector('.sae-foot .sa-next').click();
    await flush(60);
    expect(x.runner.view().phase).toBe('ready');
    expect(x.said).toContain(words(g(bat).ready));
    expect(x.said).not.toContain(words(bat.tasks[0].script.test_intro));
  });

  test('a tap task: Jugnu taps the demo; a tap in time passes the check', async () => {
    const bat = alone('sa.coach.G2.A.en.json', 'ma.missing4');
    const x = mount(bat, { guide_ms: { check: 5000 } });
    await flush(30);
    x.el.querySelector('.sae-foot .sa-next').click();
    await flush(60);
    expect(x.el.querySelector('.sae-guided .sae-demo-press.is-right')).not.toBeNull();
    await flush(900);
    expect(x.runner.view().guided_role).toBe('check');
    const tgt = String(x.runner.view().practice.target);
    [...x.el.querySelectorAll('.sae-practice button')].find((b) => b.textContent === tgt).click();
    await flush(1500);
    expect(x.runner.view().phase).toBe('ready');
  });

  test('OFF (the page not guided): the one-clip intro, as before', async () => {
    const bat = alone('sa.coach.G2.A.en.json', 'en.words4');
    const x = mount(bat, { guided: false });
    await flush(30);
    expect(x.el.querySelector('.sae-guided')).toBeNull();
    expect(x.said).toContain(words(bat.tasks[0].instruction || bat.tasks[0].script.intro));
  });
});

describe('the switch: sa_guided_instructions → ui.guided; OFF strips the lines', () => {
  test('named; OFF strips script.guided from every task; ON keeps it and adds ui.guided', () => {
    expect(SWITCHES.guidedInstructions).toBe('sa_guided_instructions');
    const b = form('sa.coach.G2.A.ur.json');
    expect(b.tasks.some((t) => t.script && t.script.guided)).toBe(true);
    const off = applySwitches(b, { rdfW3Forms: true });
    expect(off.tasks.some((t) => t.script && t.script.guided)).toBe(false);
    expect(off.ui).toBeUndefined();
    const on = applySwitches(b, { rdfW3Forms: true, guidedInstructions: true });
    expect(on.ui).toEqual({ guided: true });
    expect(on.tasks.filter((t) => t.script && t.script.guided).length).toBe(17);
  });
  test('engine: battery.ui.guided → the runner\'s and the page\'s guided, auto only', async () => {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    const got = {};
    for (const manual of [false, true]) {
      const store = await storeMod.open({ idb: null });
      const bat = alone('sa.coach.G2.A.en.json', 'en.words4');
      await start({ mount: {}, battery: { ...bat, ui: { guided: true, rdf_manual: true } }, mode: 'proctored', lang: 'en', session_id: `s-g-${manual}`, audio_check: false, warmup: false, manual }, {
        core: { ...core, createRunner: (o) => { got[`r${manual}`] = o.guided; return core.createRunner(o); } },
        store: { open: async () => store }, ui: { mount: (el, o) => { got[`u${manual}`] = o.guided; return {}; } },
        voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
      });
    }
    expect(got).toEqual({ rfalse: true, ufalse: true, rtrue: false, utrue: false });
  });
  test('route: ON serves ui.guided and the lines; OFF neither', async () => {
    const express = require('express');
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    for (const on of [true, false]) {
      const app = express();
      app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, guidedInstructions: () => on, env: {} }));
      const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
      try {
        const bat = await (await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G2.A.ur.json`)).json();
        expect([!!(bat.ui && bat.ui.guided), bat.tasks.some((t) => t.script && t.script.guided)]).toEqual([on, on]);
      } finally { srv.close(); }
    }
  });
});
