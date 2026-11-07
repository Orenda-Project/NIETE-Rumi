'use strict';
/**
 * Round 10, audio 1 (the reviewers: "Say each one out loud, then press Next" plays twice, in the task's instruction and
 * again as the hint): with sa_r10_hint_once ON the child hears it once per task, in the instruction. The say-then-press
 * hint (r7_say_next, r7_say_done, r7_say_next_q) stays on the screen but is no longer said after the instruction, nor on
 * the instruction's replay. The other hints (type then tick, the story goes on below) are still said. OFF: as before.
 * Mounts the real UI on a jsdom page with a real runner, on the served RDF batteries, and records what Jugnu says.
 */
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const R7A = require('../routes/sa-r7a-content');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const SA = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
// The switches prod has ON that shape the instruction screen (say_then_next adds the hints; the RDF forms; Next on questions).
const PROD = { rdfW3Forms: true, oneAtATime: true, sayThenNext: true, r8CompWaitNext: true, tickPrompt: true, storyScroll: true,
  audioGatedNext: true, r8Counts: true };
const served = (g, lang, on) => applySwitches(JSON.parse(fs.readFileSync(path.join(SA, `sa.coach.${g}.A.${lang}.json`), 'utf8')), on);
const SAY = ['r7_say_next', 'r7_say_done', 'r7_say_next_q'];

maybe('sa-ui: the say-then-press hint is heard once per task', () => {
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
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    jest.useRealTimers();
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const textOf = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text != null ? x.text : (x.en || x.ur || ''));
  /** Each task of the battery's RDF auto form on its own, from its instruction screen: what was said there and on its replay. */
  async function instructions(b, lang) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const ids = Array.isArray(b.rdf_auto) ? b.rdf_auto : b.tasks.map((t) => t.id);
    const out = [];
    for (const id of ids) {
      const one = { ...b, tasks: b.tasks.filter((t) => t.id === id), rdf_auto: [id] };
      if (!one.tasks.length) continue;
      const said = [];
      const runner = core.createRunner({ battery: one, onEvent: () => {}, mic: () => 'ok', audio_check: false, warmup: false,
        mic_check: false, oral_practice: false, keypad_warmup: false, one_at_a_time: true });
      const el = document.getElementById('m');
      const view = ui.mount(el, { runner, battery: one, lang, mode: 'proctored',
        speak: (t, a) => { said.push(textOf(t) || a); return Promise.resolve(); } });
      views.push(view);
      runner.start(); view.render();
      await jest.advanceTimersByTimeAsync(3000);
      const v = runner.view();
      if (v.phase !== 'instruction') { out.push({ id, phase: v.phase, said: said.slice(), hint: null, replayed: false }); continue; }
      const first = said.slice();
      const replay = el.querySelector('.sae-replay');
      if (replay) { replay.click(); await jest.advanceTimersByTimeAsync(3000); }
      const hint = el.querySelector('.sae-r7-hint');
      out.push({ id, phase: v.phase, said: said.slice(), first, hint: hint ? hint.textContent : null, replayed: !!replay });
      views.splice(0).forEach((x) => { try { x.destroy(); } catch (_) { /* gone */ } });
      el.innerHTML = '';
    }
    return out;
  }
  const sayHints = (b) => SAY.map((k) => b.lines && b.lines[k] && b.lines[k].text).filter(Boolean);

  for (const lang of ['ur', 'en']) {
    test(`${lang} ON: no say-then-press hint is said on any task's instruction or its replay; the hint stays on screen`, async () => {
      const b = served('G3', lang, { ...PROD, r10HintOnce: true });
      expect(b.ui.r10_hint_once).toBe(true);
      const hints = sayHints(b);
      expect(hints.length).toBeGreaterThan(0);
      const tasks = await instructions(b, lang);
      expect(tasks.length).toBeGreaterThan(5);
      const shown = tasks.filter((t) => t.hint && hints.includes(t.hint));
      expect(shown.length).toBeGreaterThan(3); // the cells and the story questions show it
      for (const t of tasks) for (const h of hints) expect({ id: t.id, n: t.said.filter((s) => s === h).length }).toEqual({ id: t.id, n: 0 });
      expect(tasks.some((t) => t.replayed)).toBe(true);
    });
    test(`${lang} OFF: the hint is said after the instruction, as before`, async () => {
      const b = served('G3', lang, PROD);
      const hints = sayHints(b);
      const tasks = await instructions(b, lang);
      const shown = tasks.filter((t) => t.hint && hints.includes(t.hint));
      expect(shown.length).toBeGreaterThan(3);
      for (const t of shown) expect({ id: t.id, said: t.first.includes(t.hint) }).toEqual({ id: t.id, said: true });
    });
  }
  test('ON: the type-then-tick hint is still said (only the say-then-press hint was heard twice)', async () => {
    const lang = 'en';
    const tick = { text: R7A.LINES.r7_type_tick[lang], audio: R7A.keyOf(lang, R7A.LINES.r7_type_tick[lang]) };
    const b = { battery_id: 'b', lang, ui: { tick_prompt: true, say_then_next: true, r10_hint_once: true }, lines: { r7_type_tick: tick },
      tasks: [{ id: 'ma.kp', mode: 'keypad', intro: { en: 'Type the answer.' }, items: [{ id: 'k1', prompt: { en: '2 + 3' }, answer: '5' }] }] };
    const tasks = await instructions(b, lang);
    expect(tasks[0].said).toContain(tick.text);
  });
});
