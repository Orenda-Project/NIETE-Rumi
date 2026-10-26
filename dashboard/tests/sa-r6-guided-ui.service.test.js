'use strict';
/**
 * Round 6, bar S part 2 (DESIGN_R6 §3.1-3.5, §3.8): the guided ladder on the page (opts.guided, RDF auto, Grades 1-3).
 *   - the intro: the example item big, "what you will see" then "what you do"; the big button drawn but inert;
 *   - the demo: Jugnu says "watch", models the item, his hand presses the big button ("…and the next one comes");
 *   - the helped turn: "if you do not know one…", "now it is your turn"; a press before any voice gets "first say
 *     it" (helped, never failed); voice (3 frames above the floor-based threshold) then a press → the model → the check;
 *   - the check: voice and a press within 10 s → passed; nothing in 10 s → one retry (re-explained), then on;
 *   - the ready line is the task's own test_intro + begin; idle on the ready screen repeats the short line at 10 s;
 *   - a tap task: Jugnu taps the right tile; any tap within 10 s passes;
 *   - opts.guided off: today's screens.
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const G2 = form('sa.coach.G2.A.ur.json');
function alone(id) {
  const t = JSON.parse(JSON.stringify(G2.tasks.find((x) => x.id === id)));
  delete t.depends_on;
  return t;
}
const words = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text || x.ur || x.en || '');

maybe('sa-ui: the guided ladder (sa_guided_instructions)', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    jest.useFakeTimers({ now: 1e12 });
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => {
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
    jest.useRealTimers();
  });
  const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const tick = async (ms) => { const step = 100; for (let t = 0; t < ms; t += step) { jest.advanceTimersByTime(Math.min(step, ms - t)); await settle(); } };

  function mount(tasks, { guided = true, mic = true } = {}) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', grades: [2], tasks };
    const said = [];
    const meter = { cb: null };
    const runner = core.createRunner({ battery, now: () => Date.now(), mic: () => 'ok', one_at_a_time: true, guided });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'proctored', guided,
      micLevel: mic ? (cb) => { meter.cb = cb; return () => { meter.cb = null; }; } : undefined,
      speak: (x) => { said.push(words(x)); return Promise.resolve(); } });
    views.push(view);
    return { runner, el, view, said, meter, battery };
  }
  /** Ambient for the floor's first second, then the child's voice (3+ frames above the threshold). */
  async function voice(m, level = 0.4) {
    for (let i = 0; i < 12; i++) { if (m.meter.cb) m.meter.cb(0.01); await tick(100); }
    for (let i = 0; i < 4; i++) { if (m.meter.cb) m.meter.cb(level); await tick(80); }
  }
  const phase = (m) => m.runner.view().phase;
  const role = (m) => (m.runner.view().guided || {}).role;
  const press = async (m) => { m.el.querySelector('.sae-foot .sa-next').click(); await tick(100); };

  test('words: intro → demo → helped turn → check → the task\'s own ready line', async () => {
    const t = alone('ur.words4');
    const g = t.script.guided;
    const m = mount([t]);
    m.runner.start();
    for (let n = 0; n < 20 && phase(m) !== 'instruction'; n++) { if (phase(m) === 'oral_practice') m.runner.oralPracticeDone(true); else m.runner.instructionDone(); }
    expect(phase(m)).toBe('instruction');
    m.view.render(); await settle();
    // the intro: the example big, the button inert, then the steps spoken
    expect(m.el.querySelector('.sae-guided .sae-onecell').textContent).toBe(String(t.practice[g.plan.demo].show || t.practice[g.plan.demo].target));
    expect(m.el.querySelector('.sae-foot .sa-next').getAttribute('aria-disabled')).toBe('true');
    await tick(200);
    expect(m.said).toEqual(expect.arrayContaining([words(g.see), words(g.do)]));
    expect(m.said.indexOf(words(g.see))).toBeLessThan(m.said.indexOf(words(g.do)));
    // the demo, then on by itself
    await tick(2000);
    expect(m.said).toEqual(expect.arrayContaining([words(g.demo.watch), words(g.demo.press), words(g.demo.next)]));
    expect(role(m)).toBe('turn');
    expect(m.said).toEqual(expect.arrayContaining([words(g.dont_know), words(g.turn)]));
    // a press before any voice: "first say it", still the turn (helped, never failed)
    await press(m);
    expect(m.said).toContain(words(g.help_press_first));
    expect(role(m)).toBe('turn');
    // voice, then the press: the model, then the check
    await voice(m);
    expect(m.el.querySelector('.sae-gmeter').classList.contains('is-heard')).toBe(true);
    await press(m); await tick(500);
    expect(role(m)).toBe('check');
    expect(m.said).toContain(words(g.check));
    await voice(m);
    await press(m); await tick(500);
    expect(phase(m)).toBe('ready');
    expect(m.said.slice(-2)).toEqual([words(t.script.test_intro), words(t.script.begin)]);
    // idle on the ready screen: the short line at 10 s
    await tick(10500);
    expect(m.said[m.said.length - 1]).toBe(words(g.idle));
    expect(m.el.querySelector('.sae-foot .sae-primary').classList.contains('sae-pulse')).toBe(true);
    m.el.querySelector('.sae-go').click(); m.view.render(); await settle();
    for (let n = 0; n < 50 && phase(m) === 'running'; n++) { m.el.querySelector('.sa-next').click(); await settle(); }
    expect(m.runner.results()[0].mechanics_check).toBe('passed');
  }, 30000);

  test('a silent check: after 10 s one retry, re-explained; silent again → on to ready (failed_twice)', async () => {
    const t = alone('ur.words4');
    const g = t.script.guided;
    const m = mount([t]);
    m.runner.start();
    while (phase(m) !== 'instruction') { if (phase(m) === 'oral_practice') m.runner.oralPracticeDone(true); else m.runner.instructionDone(); }
    m.view.render(); await tick(3000);
    expect(role(m)).toBe('turn');
    // silent on the turn: Jugnu says it with the child, then another item
    await tick(8500); await tick(500);
    expect(m.said).toContain(words(g.help_silence));
    expect(role(m)).toBe('check');
    await tick(10500);
    expect(role(m)).toBe('retry');
    expect(m.said).toEqual(expect.arrayContaining([words(g.retry)]));
    await tick(10500);
    expect(phase(m)).toBe('ready');
    m.runner.begin();
    while (phase(m) === 'running') m.runner.nextCell('tap');
    expect(m.runner.results()[0]).toMatchObject({ mechanics_check: 'failed_twice', voiced_cells: 0, self_run_valid: false });
  }, 30000);

  test('no microphone: the voice half is waived (no_mic)', async () => {
    const t = alone('ur.words4');
    const m = mount([t], { mic: false });
    m.runner.start();
    while (phase(m) !== 'instruction') { if (phase(m) === 'oral_practice') m.runner.oralPracticeDone(true); else m.runner.instructionDone(); }
    m.view.render(); await tick(3000);
    await press(m); await tick(500);
    expect(role(m)).toBe('check');
    await press(m); await tick(500);
    expect(phase(m)).toBe('ready');
    m.runner.begin();
    while (phase(m) === 'running') m.runner.nextCell('tap');
    expect(m.runner.results()[0].mechanics_check).toBe('no_mic');
  }, 30000);

  test('a tap task: Jugnu taps the right tile; any tap within 10 s passes', async () => {
    const t = alone('ma.discrimination2');
    const g = t.script.guided;
    const m = mount([t]);
    m.runner.start();
    while (phase(m) !== 'instruction') { if (phase(m) === 'oral_practice') m.runner.oralPracticeDone(true); else if (phase(m) === 'keypad_warmup') m.runner.keypadWarmupDone(); else m.runner.instructionDone(); }
    m.view.render(); await tick(300);
    expect(m.said).toEqual(expect.arrayContaining([words(g.see), words(g.do)]));
    await tick(1500);
    expect(role(m)).toBe('check');
    expect(m.said).toContain(words(g.demo.watch));
    const tiles = [...m.el.querySelectorAll('.sae-guided .sae-opt')];
    expect(tiles.length).toBeGreaterThan(1);
    tiles.find((b) => b.getAttribute('data-value') !== String(t.practice[g.plan.check].target)).click();
    await tick(2000);
    expect(phase(m)).toBe('ready');
  }, 30000);

  test('switch OFF: today\'s instruction screen and practice, no guided screen, no guided lines', async () => {
    const t = alone('ur.words4');
    const m = mount([t], { guided: false });
    m.runner.start();
    while (phase(m) !== 'instruction') { if (phase(m) === 'oral_practice') m.runner.oralPracticeDone(true); else m.runner.instructionDone(); }
    m.view.render(); await tick(500);
    expect(m.el.querySelector('.sae-guided')).toBeNull();
    expect(m.el.querySelector('.sae-instr')).not.toBeNull();
    expect(m.said).not.toContain(words(t.script.guided.see));
  }, 30000);
});
