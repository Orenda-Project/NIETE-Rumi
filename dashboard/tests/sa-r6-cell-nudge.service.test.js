'use strict';
/**
 * Round 6, R6-9: the toolkit's "Please go on" for every child who hesitates. Under sa_cell_next_only a letter or word
 * cell waits for Next; with switch sa_cell_nudge (default OFF, all grades, RDF auto and RDF manual) a cell with no voice
 * and no press for 5 s (from the cell showing, or from the child's voice stopping) gets Jugnu's existing please_go_on
 * line once and a pulse on the big button; every further 5 s the pulse repeats, silently, uncapped. The clock runs,
 * nothing is marked; each nudge's time (ms since the task clock started) is kept on the cell's event as nudges[].
 * Maths cells keep their pace and the passage its silence rule: no nudge. OFF: results, events and screens as before.
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
const fs = require('fs');
const path = require('path');
const core = require('../sa/sa-core');
const storeMod = require('../sa/sa-store');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const GRADES = [1, 2, 3, 4, 5];
const LANGS = ['en', 'ur'];
const formName = (g, lang) => `sa.coach.G${g}.A.${lang}.json`;
const LETTER_WORD = ['ur.letter_names5', 'ur.letter_sounds5', 'ur.words4', 'en.letter_names5', 'en.letter_sounds5', 'en.words4'];

function alone(f, id) {
  const t = JSON.parse(JSON.stringify(f.tasks.find((x) => x.id === id)));
  delete t.depends_on;
  (t.items || []).forEach((it) => { delete it.gate; });
  return t;
}
function clock() { let t = 0; return { now: () => t, add: (ms) => { t += ms; } }; }
const MODES = { auto: {}, manual: { manual: true } };

function run(t, opts) {
  const c = clock();
  const evs = [];
  const r = core.createRunner(Object.assign({ battery: { battery_id: 'b', tasks: [t] }, now: c.now, wall: () => 'w', mic: () => 'ok', one_at_a_time: true,
    onEvent: (e) => evs.push(e) }, opts || {}));
  r.start(); r.instructionDone();
  while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target);
  r.begin();
  const said = [];
  const step = (ms, each) => { for (let x = 0; x < ms; x += 100) { c.add(100); if (each) each(); const v = r.tick(); if (v) said.push([c.now(), v]); } };
  const cells = () => evs.filter((e) => e.type === 'cell_next').map((e) => e.value);
  return { r, c, evs, step, said, cells };
}

describe('the switch: sa_cell_nudge → battery.ui.cell_nudge', () => {
  const b = { battery_id: 'b', tasks: [{ id: 't' }] };
  test('named sa_cell_nudge; ON adds ui.cell_nudge; OFF no ui key', () => {
    expect(SWITCHES.cellNudge).toBe('sa_cell_nudge');
    expect(applySwitches(b, { cellNudge: true, rdfW3Forms: true }).ui).toEqual({ cell_nudge: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
});

describe('the route reads the switch (failed read = OFF)', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  async function serve(reader) {
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, cellNudge: reader, env: {} }));
    const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
    return { srv, base: `http://127.0.0.1:${srv.address().port}` };
  }
  test('ON: the served battery carries ui.cell_nudge; OFF and an unreadable switch: it does not', async () => {
    for (const [name, reader, want] of [['on', () => true, true], ['off', () => false, false], ['throws', () => { throw new Error('db'); }, false]]) {
      const x = await serve(reader);
      try {
        const b = await (await fetch(`${x.base}/sa/batteries/sa.coach.G3.A.en.json`)).json();
        expect([name, !!(b.ui && b.ui.cell_nudge)]).toEqual([name, want]);
      } finally { x.srv.close(); }
    }
  });
});

describe('the runner: a next-only letter/word cell is nudged at 5 s, then every 5 s, all grades, auto and manual', () => {
  for (const g of GRADES) {
    for (const lang of LANGS) {
      const f = form(formName(g, lang));
      for (const id of LETTER_WORD) {
        for (const [mode, extra] of Object.entries(MODES)) {
          test(`G${g} ${lang} ${id} · ${mode}`, () => {
            const x = run(alone(f, id), Object.assign({ cell_next_only: true, cell_nudge: true }, extra));
            x.step(4900);
            expect(x.said).toEqual([]);
            x.step(100);
            expect(x.said).toEqual([[5000, 'nudge']]);
            x.step(5000);
            expect(x.said).toEqual([[5000, 'nudge'], [10000, 'nudge_pulse']]);
            x.step(15000);
            expect(x.said.map((s) => s[1])).toEqual(['nudge', 'nudge_pulse', 'nudge_pulse', 'nudge_pulse', 'nudge_pulse']);
            // nothing is marked, the cell stays; the clock runs
            expect([x.r.view().phase, x.r.view().cell_index]).toEqual(['running', 0]);
            x.r.nextCell('tap');
            expect(x.cells()[0]).toMatchObject({ i: 0, how: 'tap', ms: 25000, nudges: [5000, 10000, 15000, 20000, 25000] });
            expect(x.r.view().cell_index).toBe(1);
          });
        }
      }
    }
  }

  test('the voice heard resets the wait: 5 s counts from when the voice stops; the next is silent', () => {
    const f = form(formName(2, 'ur'));
    const x = run(alone(f, 'ur.letter_names5'), { cell_next_only: true, cell_nudge: true });
    x.step(3000);
    x.step(2000, () => x.r.voice()); // the child reads from 3 s to 5 s
    x.step(4900);
    expect(x.said).toEqual([]);
    x.step(100);
    expect(x.said).toEqual([[10000, 'nudge']]);
    x.step(2000, () => x.r.voice()); // reads again 10–12 s
    x.step(4900);
    expect(x.said).toEqual([[10000, 'nudge']]);
    x.step(100);
    expect(x.said).toEqual([[10000, 'nudge'], [17000, 'nudge_pulse']]);
  });

  test('a press ends the cell as today; the next cell starts its own 5 s, voiced once again', () => {
    const f = form(formName(4, 'en'));
    const x = run(alone(f, 'en.words4'), { cell_next_only: true, cell_nudge: true });
    x.step(2000);
    x.r.nextCell('tap');
    expect(x.cells()[0]).toMatchObject({ i: 0, how: 'tap', ms: 2000, nudges: [] });
    x.step(5000);
    expect(x.said).toEqual([[7000, 'nudge']]);
    x.r.nextCell('tap');
    expect(x.cells()[1]).toMatchObject({ i: 1, how: 'tap', ms: 5000, nudges: [7000] });
  });

  test('time up on a nudged cell keeps its nudges on the cell event', () => {
    const t = alone(form(formName(1, 'en')), 'en.letter_names5');
    const x = run(t, { cell_next_only: true, cell_nudge: true });
    x.step(t.time_limit_s * 1000);
    expect(x.r.view().phase).toBe('task_end');
    const last = x.cells()[0];
    expect(last.nudges.length).toBe(Math.floor((t.time_limit_s * 1000 - 1) / 5000));
    expect(last.nudges[0]).toBe(5000);
  });

  test('maths cells keep their pace and get no nudge; the passage gets none', () => {
    const f = form(formName(3, 'en'));
    for (const id of ['ma.number_id8', 'ma.add2i', 'ma.sub2i', 'ma.mul2i']) {
      const x = run(alone(f, id), { cell_next_only: true, cell_nudge: true });
      x.step(20000);
      expect([id, x.said.some((s) => /nudge/.test(s[1]))]).toEqual([id, false]);
      expect([id, x.cells().some((c) => 'nudges' in c)]).toEqual([id, false]);
    }
    for (const id of ['en.story_w3', 'ur.story_w3']) {
      const x = run(alone(f, id), { cell_next_only: true, cell_nudge: true });
      x.step(30000);
      expect([id, x.said.some((s) => /nudge/.test(s[1]))]).toEqual([id, false]);
    }
  });

  test('only where sa_cell_next_only holds: cell_nudge alone changes nothing', () => {
    const t = alone(form(formName(2, 'en')), 'en.letter_names5');
    const a = run(t, {});
    const b = run(t, { cell_nudge: true });
    a.step(20000); b.step(20000);
    expect(JSON.stringify(b.evs)).toBe(JSON.stringify(a.evs));
    expect(b.said).toEqual(a.said);
  });

  test('OFF: byte-identical events and results to today (no nudges key)', () => {
    for (const [mode, extra] of Object.entries(MODES)) {
      const t = alone(form(formName(5, 'ur')), 'ur.words4');
      const script = (x) => { x.step(7000); x.r.nextCell('tap'); x.step(12000); x.r.nextCell('tap'); x.step(80000); };
      const a = run(t, Object.assign({ cell_next_only: true }, extra));
      const b = run(t, Object.assign({ cell_next_only: true, cell_nudge: false }, extra));
      script(a); script(b);
      expect([mode, JSON.stringify(b.evs)]).toEqual([mode, JSON.stringify(a.evs)]);
      expect(JSON.stringify(b.r.results())).toBe(JSON.stringify(a.r.results()));
      expect(JSON.stringify(a.evs)).not.toMatch(/nudges/);
    }
  });
});

describe('the engine: battery.ui.cell_nudge reaches the runner and the page', () => {
  const { start } = require('../sa/sa-engine');
  async function boot(ui) {
    const store = await storeMod.open({ idb: null });
    let got = null;
    const c = clock();
    const t = alone(form(formName(3, 'en')), 'en.letter_names5');
    const e = await start({ mount: {}, battery: { battery_id: 'b', ui, tasks: [t] }, mode: 'proctored', lang: 'en', session_id: 's-nudge-' + Math.random(), audio_check: false, warmup: false, now: c.now }, {
      core, store: { open: async () => store }, ui: { mount: (el, o) => { got = o; return {}; } },
      voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok', now: c.now,
    });
    const r = e.runner;
    r.start(); r.instructionDone();
    while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target);
    r.begin();
    let said = null;
    for (let x = 0; x < 5000; x += 100) { c.add(100); const v = r.tick(); if (v) said = v; }
    return { got, said };
  }
  test('ON: the page gets cell_nudge and the runner nudges at 5 s', async () => {
    const x = await boot({ one_at_a_time: true, cell_next_only: true, cell_nudge: true });
    expect(x.got.cell_nudge).toBe(true);
    expect(x.said).toBe('nudge');
  });
  test('OFF: neither', async () => {
    const x = await boot({ one_at_a_time: true, cell_next_only: true });
    expect(x.got.cell_nudge).toBeFalsy();
    expect(x.said).toBeNull();
  });
});

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui: Jugnu says please_go_on once, the big button pulses, the meter hears the child', () => {
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
  const words = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text || x.en || x.ur || '');

  async function mount(f, id, o) {
    const c = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const t = alone(f, id);
    const battery = { battery_id: 'b', lines: f.lines, tasks: [t] };
    const said = [];
    const evs = [];
    const mic = { cb: null, opened: 0, stopped: 0 };
    const clk = clock();
    const runner = c.createRunner({ battery, now: clk.now, mic: () => 'ok', one_at_a_time: true, manual: !!o.manual, cell_next_only: true,
      cell_nudge: o.nudge === true, onEvent: (e) => evs.push(e) });
    const el = document.getElementById('m');
    const opts = { runner, battery, lang: f.lang || t.lang, mode: 'proctored', manual: !!o.manual,
      speak: (x, a) => { said.push([words(x), a]); return Promise.resolve(); },
      micLevel: (cb) => { mic.cb = cb; mic.opened++; return () => { mic.stopped++; }; } };
    if (o.nudge != null) opts.cell_nudge = o.nudge;
    const view = ui.mount(el, opts);
    views.push(view);
    runner.start(); runner.instructionDone();
    while (runner.view().phase === 'practice') runner.practiceAnswer(runner.view().practice.target);
    runner.begin(); view.render(); await flush();
    const after = async (ms) => { clk.add(ms); await flush(320); };
    const cells = () => evs.filter((e) => e.type === 'cell_next').map((e) => e.value);
    return { runner, el, view, said, evs, mic, clk, after, cells, t };
  }
  const goOn = (f) => words(f.lines.please_go_on);
  const btn = (el) => el.querySelector('.sae-run-cell .sa-next');

  for (const g of GRADES) {
    for (const lang of LANGS) {
      for (const [mode, manual] of [['auto', false], ['manual', true]]) {
        const id = `${lang}.letter_names5`;
        test(`G${g} ${lang} ${id} · ${mode}: said once at 5 s, pulse at 5 s and 10 s, Next keeps the nudges`, async () => {
          const f = form(formName(g, lang));
          const m = await mount(f, id, { nudge: true, manual });
          const before = m.said.length;
          await m.after(4800);
          expect(m.said.length).toBe(before);
          expect(btn(m.el).classList.contains('sae-pulse')).toBe(false);
          await m.after(200);
          expect(m.said.slice(before).map((s) => s[0])).toEqual([goOn(f)]);
          expect(m.said[before][1] == null || m.said[before][1] === f.lines.please_go_on.audio).toBe(true);
          expect(btn(m.el).classList.contains('sae-pulse')).toBe(true);
          expect(btn(m.el).getAttribute('data-nudges')).toBe('1');
          await m.after(5000);
          expect(m.said.slice(before).map((s) => s[0])).toEqual([goOn(f)]); // silent
          expect(btn(m.el).getAttribute('data-nudges')).toBe('2');
          expect(m.runner.view().cell_index).toBe(0);
          btn(m.el).click();
          await flush();
          expect(m.cells()[0]).toMatchObject({ i: 0, how: 'tap', nudges: [5000, 10000] });
          expect(m.runner.view().cell_index).toBe(1);
          expect(btn(m.el).classList.contains('sae-pulse')).toBe(false);
        }, 20000);
      }
    }
  }

  test('the meter: floor from the first second, heard = 3 frames above max(0.05, floor*2.5+0.02); the wait counts from the voice', async () => {
    const f = form(formName(2, 'en'));
    const m = await mount(f, 'en.words4', { nudge: true });
    expect(m.mic.opened).toBe(1);
    for (let i = 0; i < 10; i++) m.mic.cb(0.04); // the room: floor 0.04 → threshold 0.12
    await m.after(3000);
    m.mic.cb(0.1); m.mic.cb(0.11); m.mic.cb(0.1); // under the threshold: not a voice
    await m.after(1000);
    m.mic.cb(0.3); m.mic.cb(0.3); // two frames only
    m.mic.cb(0.01);
    await m.after(1000);
    expect(m.said.filter((s) => s[0] === goOn(f)).length).toBe(1); // 5 s: nudged (nothing above counted)
    await m.after(2000);
    m.mic.cb(0.3); m.mic.cb(0.3); m.mic.cb(0.3); // heard at 7 s: the next nudge is 5 s after it, not at 10 s
    await m.after(4800);
    expect(btn(m.el).getAttribute('data-nudges')).toBe('1');
    await m.after(200);
    expect(btn(m.el).getAttribute('data-nudges')).toBe('2');
    expect(m.said.filter((s) => s[0] === goOn(f)).length).toBe(1);
  }, 20000);

  test('maths cells and the passage: no nudge, no pulse, no mic opened for it', async () => {
    const f = form(formName(3, 'en'));
    for (const id of ['ma.number_id8', 'ma.add2i']) {
      const m = await mount(f, id, { nudge: true });
      await m.after(5000); await m.after(5000);
      expect([id, m.el.querySelector('.sae-pulse')]).toEqual([id, null]);
      expect([id, m.cells().some((c) => 'nudges' in c)]).toEqual([id, false]);
      expect([id, m.mic.opened]).toEqual([id, 0]);
    }
    const p = await mount(f, 'en.story_w3', { nudge: true });
    await p.after(5000); await p.after(5000);
    expect(p.el.querySelector('.sae-pulse')).toBeNull();
    expect(p.mic.opened).toBe(0);
  }, 30000);

  test('OFF: no line, no pulse, no mic, the screen and the events as today', async () => {
    const f = form(formName(1, 'ur'));
    const a = await mount(f, 'ur.letter_sounds5', { nudge: null });
    const htmlA = a.el.innerHTML;
    await a.after(5000); await a.after(5000);
    const saidA = a.said.slice();
    const elA = a.el.innerHTML;
    btn(a.el).click(); await flush();
    const evA = JSON.stringify(a.evs.map((e) => Object.assign({}, e, { at: null })));
    a.view.destroy();
    const b = await mount(f, 'ur.letter_sounds5', { nudge: false });
    expect(b.el.innerHTML).toBe(htmlA);
    await b.after(5000); await b.after(5000);
    expect(b.said).toEqual(saidA);
    expect(b.el.innerHTML).toBe(elA);
    expect(b.mic.opened).toBe(0);
    btn(b.el).click(); await flush();
    expect(JSON.stringify(b.evs.map((e) => Object.assign({}, e, { at: null })))).toBe(evA);
    expect(evA).not.toMatch(/nudges/);
  }, 30000);
});
