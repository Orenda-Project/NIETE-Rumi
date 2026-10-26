'use strict';
/**
 * Round 6, bar C (DESIGN_R6 §4, RULING R6-2): in RDF manual the coach says the instruction and the app asks every
 * question. Switch sa_app_asks (default OFF) → battery.ui.app_asks → the page's app_asks (manual runs only).
 * ON, a manual run:
 *   - Jugnu says the coach line, then every question: each comprehension question, each tap item's question (the
 *     task's tap line), every practice model and practice feedback; a sum stays on its replay tile, as in auto;
 *   - the instruction stays the coach's (no intro clip); the ready line ("Now it is your turn… Ready? Begin") is the
 *     app's, said once (C2, RULING R6-11 item 1);
 *   - the coach screen (DESIGN §4.2): "You say" (coach_text_c, the coach's words with Jugnu named) apart from a folded
 *     "Do not say these to the child — Jugnu asks them" list (with the ready line), how the child answers, and
 *     "Jugnu speaks after you give the phone";
 *   - on the child's screen nothing is shown for the coach (no folded preview); the replay tile is back;
 *   - a sum is child-read: presentation 'child_read' on the task, replay_presses on each cell.
 * OFF: manual as round 5 (sa-w3-manual-mute.service.test.js).
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
const LINE = { en: 'Your coach will now give the instructions.', ur: 'اب آپ کے کوچ ہدایات دیں گے۔' };

function alone(f, id) {
  const t = JSON.parse(JSON.stringify(form(f).tasks.find((x) => x.id === id)));
  delete t.depends_on;
  (t.items || []).forEach((it) => { delete it.gate; });
  return t;
}
const speaks = (it) => !!(it.say || it.prompt || it.prompt_audio);
const cases = [];
[['sa.coach.G3.A.en.json', 'en'], ['sa.coach.G5.A.ur.json', 'ur']].forEach(([f, lang]) => form(f).rdf_manual.forEach((id) => cases.push([f, id, lang])));

maybe('sa-ui: RDF manual, the app asks the questions (sa_app_asks)', () => {
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
  const words = (x, lang) => (x == null ? '' : typeof x === 'string' ? x : x.text || x[lang || 'en'] || x.en || x.ur || '');
  function mount(battery, lang, asks) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    let t = 0;
    const clock = { now: () => t, add: (ms) => { t += ms; } };
    const events = [];
    const runner = core.createRunner({ battery, now: clock.now, mic: () => 'ok', one_at_a_time: true, manual: true, app_asks: asks !== false, onEvent: (e) => events.push(e) });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'proctored', manual: true, app_asks: asks !== false,
      speak: (x, a) => { said.push([x, a]); return Promise.resolve(); } });
    views.push(view);
    return { runner, el, view, said, clock, events };
  }
  async function walk(m) {
    const { runner, el, view, clock } = m;
    runner.start(); view.render(); await flush();
    for (let n = 0; n < 400; n++) {
      const v = runner.view();
      if (v.phase === 'task_end' || v.phase === 'battery_end') break;
      if (v.phase === 'instruction') el.querySelector('.sae-foot .sae-primary').click();
      else if (v.phase === 'practice') {
        const next = el.querySelector('.sae-practice .sa-next');
        const tile = /^(keypad|keyboard)$/.test(v.task.mode) ? null
          : [...el.querySelectorAll('.sae-practice button')].find((b) => b.textContent === String(v.practice.target));
        if (next) next.click(); else if (tile) tile.click(); else runner.practiceAnswer(v.practice.target);
        await flush(1300);
      } else if (v.phase === 'ready') el.querySelector('.sae-go').click();
      else if (v.phase === 'running' && v.cell != null) el.querySelector('.sa-next').click();
      else if (v.phase === 'running' && v.item) runner.answer(v.task.mode === 'oral' ? 'spoken' : v.item.target);
      else if (v.phase === 'running') runner.done();
      else if (v.phase === 'last_word') runner.lastWord(0);
      else if (v.phase === 'listen') clock.add(1);
      else throw new Error('phase ' + v.phase);
      view.render(); await flush();
    }
    await flush(50);
    return runner.view();
  }
  const itemSaid = (it) => (typeof it.say === 'string' ? it.say : words(it.say || it.prompt));

  const isTap = (t) => ['tap', 'keypad'].includes(t.mode || t.response);

  test.each(cases)('%s %s: the coach line, then Jugnu asks every question; the instruction stays the coach\'s', async (f, id, lang) => {
    const t = alone(f, id);
    const m = mount({ battery_id: 'b', tasks: [t] }, lang);
    const end = await walk(m);
    expect(['task_end', 'battery_end']).toContain(end.phase);
    const said = m.said.map((x) => words(x[0], lang));
    expect(said[0]).toBe(LINE[lang]);
    for (const it of t.items.filter((x) => speaks(x) && t.say_on !== 'replay')) expect(said).toContain(itemSaid(it));
    for (const p of t.practice || []) if (Array.isArray(p.model)) expect(said).toContain(words(p.model[0], lang));
    if (isTap(t)) {
      const q = words(t.instruction || t.script.intro, lang);
      expect(said.filter((x) => x === q).length).toBeGreaterThanOrEqual(t.items.length);
      // the walk taps a tap task's practice tile (the UI's feedback path); a keypad practice is answered on the runner
      const fb = (t.response === 'tap' ? t.practice || [] : []).map((p) => p.feedback && p.feedback.correct).filter(Boolean);
      for (const c of fb) expect(said).toContain(words(Array.isArray(c) ? c[0] : c, lang));
    } else {
      const intro = t.instruction || (t.script && t.script.intro);
      if (intro) expect(said).not.toContain(words(intro, lang));
    }
    // the ready line is the app's, once (RULING R6-11 item 1)
    if (t.script && t.script.begin) expect(said.filter((x) => x === words(t.script.begin, lang)).length).toBe(1);
    if (t.script && t.script.test_intro) expect(said.filter((x) => x === words(t.script.test_intro, lang)).length).toBe(1);
  }, 60000);

  test.each(cases)('%s %s: the coach screen splits "You say" from a folded "Jugnu asks", and says how the child answers', async (f, id, lang) => {
    const t = alone(f, id);
    const m = mount({ battery_id: 'b', tasks: [t] }, lang);
    m.runner.start(); m.view.render(); await flush();
    const brief = m.el.querySelector('.sae-coach-brief');
    expect(brief.querySelector('.sae-coach-yousay .sae-coach-text').textContent).toBe(words(t.coach_text_c, lang));
    expect(brief.textContent).not.toMatch(/Read each one out|ہر ایک سامنے آنے پر/);
    expect(brief.querySelector('.sae-answers-by').textContent).toMatch(lang === 'ur' ? /^جواب ایسے دینا ہے: (بول کر|دبا کر|بٹن سے لکھ کر)$/ : /^The child answers by: (saying it aloud|tapping|typing on the buttons)$/);
    expect(brief.querySelector('.sae-app-after').textContent).toBe(lang === 'ur' ? 'فون دینے کے بعد جگنو بولے گا۔' : 'Jugnu speaks after you give the phone.');
    expect(brief.textContent).not.toMatch(/بچہ جواب دے گا|جگنو پوچھے گا — یہ آپ نہ پڑھیں/);
    const asked = brief.querySelector('details.sae-coach-appasks');
    expect(asked.querySelector('summary').textContent).toBe(lang === 'ur' ? 'یہ بچے کو نہ سنائیں — جگنو خود پوچھے گا:' : 'Do not say these to the child — Jugnu asks them:');
    // the ready line is in the list (Jugnu says it; the coach does not)
    if (t.script && t.script.begin) expect([...asked.querySelectorAll('li')].map((li) => li.textContent).join(' ')).toContain(words(t.script.begin, lang));
    expect(asked.open).toBe(false);
    for (const li of asked.querySelectorAll('li')) expect(li.querySelector('.sae-li-say')).not.toBeNull();
    const listed = [...asked.querySelectorAll('li')].map((li) => li.textContent.replace(/^🔊 /, ''));
    for (const it of t.items.filter(speaks)) expect(listed).toContain(itemSaid(it));
  });

  test('a question screen: nothing shown for the coach (no folded preview), the replay tile is back', async () => {
    const t = alone('sa.coach.G3.A.en.json', 'en.story_comp_w3');
    const m = mount({ battery_id: 'b', tasks: [t] }, 'en');
    m.runner.start(); m.runner.instructionDone();
    while (m.runner.view().phase === 'practice') m.runner.practiceAnswer(m.runner.view().practice.target);
    m.runner.begin(); m.view.render(); await flush();
    expect(m.el.querySelector('.sae-run-oral .sae-coach-says')).toBeNull();
    expect(m.el.querySelector('.sae-run-oral').textContent).not.toMatch(/Read this|Jugnu asks/);
    expect(m.el.querySelector('.sae-run-oral .sae-replay')).not.toBeNull();
  });

  test('a mental sum stays on its replay tile (the child reads it), and the tile says it', async () => {
    const t = alone('sa.coach.G3.A.en.json', 'ma.add2i');
    expect(t.say_on).toBe('replay');
    const m = mount({ battery_id: 'b', tasks: [t] }, 'en');
    m.runner.start(); m.runner.instructionDone();
    while (m.runner.view().phase === 'practice') m.runner.practiceAnswer(m.runner.view().practice.target);
    m.runner.begin(); m.view.render(); await flush();
    const first = m.runner.view().cell_item || m.runner.view().item;
    expect(m.said.map((x) => words(x[0]))).not.toContain(itemSaid(first));
    m.el.querySelector('.sae-replay').click(); await flush();
    expect(m.said.map((x) => words(x[0]))).toContain(itemSaid(first));
    m.el.querySelector('.sae-replay').click(); await flush();
    m.el.querySelector('.sa-next').click(); m.view.render(); await flush();
    // R6-3: the sum is the child's to read; each cell counts its replay presses
    const ev = m.events.filter((e) => e.type === 'cell_next').map((e) => e.value);
    expect(ev[0].replay_presses).toBe(2);
    while (m.runner.view().phase === 'running') { m.el.querySelector('.sa-next').click(); m.view.render(); await flush(); }
    const r = m.runner.results ? m.runner.results().find((x) => x.task_id === t.id) : null;
    expect(r && r.presentation).toBe('child_read');
    expect(r.cells.map((c) => c.replay_presses)).toEqual([2, ...r.cells.slice(1).map(() => 0)]);
  });

  test('RDF auto with the switch ON also writes child_read and replay_presses; switch OFF writes neither', async () => {
    for (const on of [true, false]) {
      const t = alone('sa.coach.G3.A.en.json', 'ma.add2i');
      const core = require('../sa/sa-core');
      let ck = 0;
      const runner = core.createRunner({ battery: { battery_id: 'b', tasks: [t] }, now: () => ck, mic: () => 'ok', one_at_a_time: true, app_asks: on });
      runner.start(); runner.instructionDone();
      while (runner.view().phase === 'practice') runner.practiceAnswer(runner.view().practice.target);
      runner.begin(); runner.replayPressed(); ck += 10;
      while (runner.view().phase === 'running') runner.nextCell('tap');
      const r = runner.results().find((x) => x.task_id === t.id);
      expect(r.presentation).toBe(on ? 'child_read' : undefined);
      expect(r.cells[0].replay_presses).toBe(on ? 1 : undefined);
    }
  });

  test('the coach-text for manual-C is served only with the switch ON', () => {
    const b = form('sa.coach.G3.A.en.json');
    expect(b.tasks.filter((x) => x.coach_text_c).length).toBeGreaterThan(0);
    const off = applySwitches(b, { rdfW3Forms: true });
    expect(off.tasks.filter((x) => x.coach_text_c).length).toBe(0);
    const on = applySwitches(b, { rdfW3Forms: true, appAsks: true });
    expect(on.tasks.filter((x) => x.coach_text_c).length).toBe(b.rdf_manual.length);
  });

  test('OFF: round 5 manual (the coach line only, the coach reads the items)', async () => {
    const t = alone('sa.coach.G3.A.en.json', 'ma.discrimination2');
    const m = mount({ battery_id: 'b', tasks: [t] }, 'en', false);
    await walk(m);
    expect(m.said.map((x) => words(x[0]))).toEqual([LINE.en]);
  }, 60000);
});

describe('the switch reaches the battery as ui.app_asks, and the engine passes it to the page', () => {
  test('named sa_app_asks; ON adds ui.app_asks; OFF no ui key', () => {
    const b = { battery_id: 'b', tasks: [{ id: 't' }] };
    expect(SWITCHES.appAsks).toBe('sa_app_asks');
    expect(applySwitches(b, { appAsks: true, rdfW3Forms: true }).ui).toEqual({ app_asks: true });
    expect(JSON.stringify(applySwitches(b, { rdfW3Forms: true }))).toBe(JSON.stringify(b));
  });
  test('engine: battery.ui.app_asks → the page\'s app_asks (manual runs only)', async () => {
    const core = require('../sa/sa-core');
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    const got = {};
    for (const manual of [true, false]) {
      const store = await storeMod.open({ idb: null });
      await start({ mount: {}, battery: { battery_id: 'b', ui: { rdf_manual: true, app_asks: true }, tasks: [{ id: 'x', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60, passage: { text: 'Ali went.' }, items: [{ id: 'w1', target: 'Ali', line: 1 }, { id: 'w2', target: 'went', line: 1 }] }] },
        mode: 'proctored', lang: 'en', session_id: `s-asks-${manual}`, audio_check: false, warmup: false, manual }, {
        core, store: { open: async () => store }, ui: { mount: (el, o) => { got[manual] = o; return {}; } },
        voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) }, rec: { create: () => null }, micState: () => 'ok',
      });
    }
    expect(got[true].app_asks).toBe(true);
    expect(got[false].app_asks).toBe(false);
  });
});

describe('the route reads the switch', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  test('ON: the served battery carries ui.app_asks; OFF: it does not', async () => {
    for (const on of [true, false]) {
      const app = express();
      app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, appAsks: () => on, env: {} }));
      const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
      try {
        const b = await (await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G3.A.en.json`)).json();
        expect(!!(b.ui && b.ui.app_asks)).toBe(on);
      } finally { srv.close(); }
    }
  });
});
