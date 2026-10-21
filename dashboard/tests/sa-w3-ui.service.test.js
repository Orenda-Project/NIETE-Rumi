'use strict';
/**
 * Wave 3 on the page (dashboard/sa/sa-ui.js, sa-page.js, sa-engine.js) and where the battery is served
 * (routes/sa-battery-switches.js, sa-engine.routes.js), each behind its own switch, OFF by default:
 *   sa_one_at_a_time   one big cell and Next; a cell moved on by the runner → Jugnu: "Please go on."
 *   sa_passage_punct   the passage drawn from passage.text: «۔ ، ؟» and ". , ?" stay on the page
 *   sa_rdf_manual      block rdf_manual: before each task Jugnu says only "Your coach will now give the instructions",
 *                      a coach screen shows the words to read out, then "Give the phone to the child"
 * The DOM tests run where jsdom resolves (the portal's dev dependency: NODE_PATH=../portal/node_modules); the rest
 * run everywhere.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const coachForms = fs.readdirSync(FORMS).filter((f) => /^sa\.coach\..*\.(en|ur)\.json$/.test(f));
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const ARABIC_PUNCT = /[۔،؟]/;
const LATIN_PUNCT = /[.,?!]/;

describe('the passage as printed (passageWords)', () => {
  const { passageWords } = require('../sa/sa-ui');
  const passages = [];
  coachForms.forEach((f) => form(f).tasks.forEach((t) => {
    if (!t.passage || !Array.isArray(t.items) || !t.items.length || t.response !== 'record') return;
    passages.push([f, t.id, 'form', t]);
    (t.variants || []).forEach((v) => passages.push([f, t.id, v.id, { ...t, passage: v.passage, items: v.items }]));
  }));

  test('the coach forms have read-aloud passages to check', () => {
    expect(passages.length).toBeGreaterThanOrEqual(4);
  });

  test.each(passages.map((p) => [p[0], p[1], p[2], p[3]]))('%s %s (%s): every word lines up, punctuation kept', (f, id, v, t) => {
    const words = passageWords(t);
    expect(words).not.toBeNull();
    expect(words).toHaveLength(t.items.length);
    expect(words.join(' ')).toBe(t.passage.text.split(/\s+/).filter(Boolean).join(' '));
    expect(words.join(' ')).toMatch(/^ur\./.test(id) ? ARABIC_PUNCT : LATIN_PUNCT);
  });

  test('a text that does not line up with its items gives null (the page keeps the items\' words)', () => {
    const t = { passage: { text: 'آج بلال گیا۔' }, items: [{ id: 'a', target: 'آج' }, { id: 'b', target: 'احمد' }, { id: 'c', target: 'گیا' }] };
    expect(passageWords(t)).toBeNull();
    expect(passageWords({ passage: { text: 'one two three.' }, items: [{ id: 'a', target: 'one' }, { id: 'b', target: 'two' }] })).toBeNull();
    expect(passageWords({ passage: { text: 'Hello, ٹیں ٹیں!' }, items: [{ id: 'a', target: 'Hello' }, { id: 'b', target: 'ٹیں ٹیں' }] })).toEqual(['Hello,', 'ٹیں ٹیں!']);
  });
});

describe('the battery as served (sa-battery-switches)', () => {
  const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
  const b = { battery_id: 'x', tasks: [{ id: 't', mode: 'tap' }] };

  test('the three Wave 3 switch names', () => {
    expect(SWITCHES.oneAtATime).toBe('sa_one_at_a_time');
    expect(SWITCHES.passagePunct).toBe('sa_passage_punct');
    expect(SWITCHES.rdfManual).toBe('sa_rdf_manual');
  });

  test('ON adds battery.ui for the engine; OFF the battery has no ui key, as before', () => {
    expect(applySwitches(b, { oneAtATime: true, passagePunct: true, rdfManual: true }).ui).toEqual({ one_at_a_time: true, passage_punct: true, rdf_manual: true });
    expect(applySwitches(b, { passagePunct: true }).ui).toEqual({ passage_punct: true });
    const off = applySwitches(b, {});
    expect(off).toEqual(b);
    expect(Object.prototype.hasOwnProperty.call(off, 'ui')).toBe(false);
    expect(JSON.stringify(applySwitches(form('sa.coach.G3.A.ur.json'), {}))).toBe(JSON.stringify(applySwitches(form('sa.coach.G3.A.ur.json'), { passageRotation: false })));
  });

  test('the route serves battery.ui only for the switches that are ON', async () => {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const get = async (flags) => {
      const app = express();
      const f = (k) => () => flags[k] === true;
      app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => false, passageRotation: () => false, voiceV2: () => false,
        oneAtATime: f('one'), passagePunct: f('punct'), rdfManual: f('manual') }));
      const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      try {
        const res = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G3.A.ur.json`);
        return await res.json();
      } finally { srv.close(); }
    };
    expect((await get({ one: true, manual: true })).ui).toEqual({ one_at_a_time: true, rdf_manual: true });
    expect((await get({})).ui).toBeUndefined();
  });
});

describe('the page (sa-page)', () => {
  const page = require('../sa/sa-page');
  const battery = { battery_id: 'f', tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], rdf: ['a'], rdf_auto: ['b', 'c'], rdf_manual: ['b', 'c'] };

  test('block rdf_auto / rdf_manual: the form\'s own lists; rdf as before', () => {
    expect(page.params('?s=abcdef12&form=sa.coach.G3.A.ur&block=rdf_manual').block).toBe('rdf_manual');
    expect(page.params('?s=abcdef12&form=sa.coach.G3.A.ur&block=rdf_auto').block).toBe('rdf_auto');
    expect(page.pick(battery, 'rdf_auto').tasks.map((t) => t.id)).toEqual(['b', 'c']);
    expect(page.pick(battery, 'rdf_manual').battery_id).toBe('f#rdf_manual');
    expect(page.pick(battery, 'rdf').tasks.map((t) => t.id)).toEqual(['a']);
  });

  test('coach-led only for rdf_manual with the server\'s switch on the battery', () => {
    expect(page.manualOf({ ...battery, ui: { rdf_manual: true } }, 'rdf_manual')).toBe(true);
    expect(page.manualOf(battery, 'rdf_manual')).toBe(false);
    expect(page.manualOf({ ...battery, ui: { rdf_manual: true } }, 'rdf_auto')).toBe(false);
  });
});

describe('the engine passes battery.ui on', () => {
  const core = require('../sa/sa-core');
  const storeMod = require('../sa/sa-store');
  const { start } = require('../sa/sa-engine');
  async function boot(battery, extra) {
    let uiOpts = null;
    let runnerOpts = null;
    const store = await storeMod.open({ idb: null });
    const e = await start(Object.assign({ mount: {}, mode: 'proctored', lang: 'en', audio_check: false, warmup: false, battery }, extra),
      { core: { ...core, createRunner: (o) => { runnerOpts = o; return core.createRunner(o); } }, store: { open: async () => store },
        ui: { mount: (el, o) => { uiOpts = o; return {}; } }, voice: { create: () => ({ speak: async () => {}, stop() {}, setMuted() {} }) },
        win: {}, micState: () => 'ok' });
    return { e, uiOpts, runnerOpts };
  }
  const tasks = [{ id: 't', mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] }];

  test('ON: one_at_a_time to the runner, passage_punct and manual to the screens', async () => {
    const { e, uiOpts, runnerOpts } = await boot({ battery_id: 'b', tasks, ui: { one_at_a_time: true, passage_punct: true } }, { manual: true });
    expect(runnerOpts.one_at_a_time).toBe(true);
    expect(runnerOpts.manual).toBe(true);
    expect(uiOpts.passage_punct).toBe(true);
    expect(uiOpts.manual).toBe(true);
    e.destroy();
  });

  test('OFF (no ui on the battery, no manual): everything false; a game is never coach-led', async () => {
    const a = await boot({ battery_id: 'b', tasks }, {});
    expect([a.runnerOpts.one_at_a_time, a.runnerOpts.manual, a.uiOpts.passage_punct, a.uiOpts.manual]).toEqual([false, false, false, false]);
    a.e.destroy();
    const g = await boot({ battery_id: 'b2', tasks }, { mode: 'game', manual: true });
    expect(g.runnerOpts.manual).toBe(false);
    g.e.destroy();
  });
});

maybe('sa-ui: Wave 3 screens', () => {
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
  function mount(battery, runnerOpts, uiOpts) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    let t = 0;
    const clock = { now: () => t, add: (ms) => { t += ms; } };
    const runner = core.createRunner(Object.assign({ battery, now: clock.now, mic: () => 'ok' }, runnerOpts));
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak: (x) => { said.push(x); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    return { runner, el, view, said, clock };
  }
  const text = (x) => (x && (x.text || x.en)) || '';
  const grid = { battery_id: 'b', tasks: [{ id: 'en.letters', subtask: 'letter_name_identification', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m', 'S', 't'], items: [] }] };

  test('one cell at a time: one big cell, Next shows the next; the grid is not drawn', async () => {
    const { runner, el, view } = mount(grid, { one_at_a_time: true }, { child: { first_name: 'Ali Testwala' } });
    runner.start(); runner.instructionDone(); runner.begin();
    view.render(); await flush();
    expect(el.querySelector('.sae-grid')).toBeNull();
    expect(el.querySelector('.sae-onecell').textContent).toBe('m');
    el.querySelector('.sa-next').click(); await flush();
    expect(el.querySelector('.sae-onecell').textContent).toBe('S');
  });

  test('a cell the runner moves on: Jugnu says "Please go on."', async () => {
    const { runner, el, view, said, clock } = mount(grid, { one_at_a_time: true }, {});
    runner.start(); runner.instructionDone(); runner.begin();
    view.render(); await flush();
    clock.add(3100);
    await flush(400);
    expect(said.map(text)).toContain('Please go on.');
    expect(el.querySelector('.sae-onecell').textContent).toBe('S');
  });

  test('OFF: the grid is the page it was', async () => {
    const { runner, el, view } = mount(grid, {}, {});
    runner.start(); runner.instructionDone(); runner.begin();
    view.render(); await flush();
    expect(el.querySelectorAll('.sae-grid .sae-cell')).toHaveLength(3);
    expect(el.querySelector('.sae-onecell')).toBeNull();
  });

  test('manual: the coach screen with the words to read; Jugnu says only the carrier line; then the child\'s screen', async () => {
    const t = { id: 'en.letters', subtask: 'letter_name_identification', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m', 'S'], items: [],
      title: 'Letter names', instruction: { text: 'Tell me the names of these letters.' }, coach_text: { en: 'Point to the first letter and ask the name.', ur: 'پہلے حرف کی طرف اشارہ کریں۔' } };
    const b = { battery_id: 'b', tasks: [t] };
    const { runner, el, view, said } = mount(b, { manual: true }, { manual: true });
    runner.start(); view.render(); await flush();
    expect(el.querySelector('.sae-coach-brief')).not.toBeNull();
    expect(el.querySelector('.sae-coach-text').textContent).toBe('Point to the first letter and ask the name.');
    expect(said.map(text)).toEqual(['Your coach will now give the instructions.']);
    expect(el.textContent).toContain('Give the phone to the child');
    [...el.querySelectorAll('button')].find((x) => x.textContent === 'Give the phone to the child').click();
    await flush();
    expect(runner.view().phase).toBe('ready');
    expect(el.querySelector('.sae-coach-brief')).toBeNull();
  });

  test('auto (no manual): the instruction is spoken as before, no coach screen', async () => {
    const t = { id: 'en.letters', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m'], items: [], instruction: { text: 'Tell me the names of these letters.' } };
    const { runner, el, view, said } = mount({ battery_id: 'b', tasks: [t] }, {}, {});
    runner.start(); view.render(); await flush();
    expect(el.querySelector('.sae-coach-brief')).toBeNull();
    expect(said.map(text)).toEqual(['Tell me the names of these letters.']);
  });

  test.each([['sa.coach.G3.A.ur.json', 'ur.story', 'ur', /۔/], ['sa.coach.G3.A.en.json', 'en.story', 'en', /\./]])('passage_punct: %s %s shows its punctuation; OFF does not', async (f, id, lang, rx) => {
    const t = form(f).tasks.find((x) => x.id === id);
    delete t.depends_on;
    const b = { battery_id: 'b', tasks: [t] };
    const on = mount(b, {}, { passage_punct: true, lang });
    on.runner.start(); on.runner.instructionDone();
    while (on.runner.view().phase === 'practice') on.runner.practiceAnswer(on.runner.view().practice.target);
    on.runner.begin(); on.view.render(); await flush();
    const p = on.el.querySelector('.sae-passage');
    expect(p.classList.contains('is-printed')).toBe(true);
    expect(p.textContent).toMatch(rx);
    expect(p.querySelectorAll('.sae-word')).toHaveLength(t.items.length);
    on.view.destroy();
    document.getElementById('m').innerHTML = '';
    const off = mount(b, {}, { lang });
    off.runner.start(); off.runner.instructionDone();
    while (off.runner.view().phase === 'practice') off.runner.practiceAnswer(off.runner.view().practice.target);
    off.runner.begin(); off.view.render(); await flush();
    expect(off.el.querySelector('.sae-passage').textContent).not.toMatch(lang === 'ur' ? /[۔،؟]/ : /[.,?]/);
  });

  test.each([['sa.coach.G3.A.ur.json', 'ur.story', 'ur', '۔', 6, 6], ['sa.coach.G3.A.en.json', 'en.story', 'en', '.', 7, 7]])('passage_punct: %s %s (rwp2026) is one sentence per line, as on the booklet page', async (f, id, lang, stop, n, lines) => {
    const t = form(f).tasks.find((x) => x.id === id);
    const v = t.variants.find((x) => x.id === 'rwp2026');
    const task = { ...t, passage: v.passage, items: v.items };
    delete task.variants; delete task.depends_on;
    const { runner, el, view } = mount({ battery_id: 'b', tasks: [task] }, {}, { passage_punct: true, lang });
    runner.start(); runner.instructionDone();
    while (runner.view().phase === 'practice') runner.practiceAnswer(runner.view().practice.target);
    runner.begin(); view.render(); await flush();
    const rows = [...el.querySelectorAll('.sae-passage .sae-pline')].map((r) => r.textContent.trim());
    expect(rows).toHaveLength(lines);
    rows.forEach((r) => expect(r.endsWith(stop)).toBe(true));
    expect(rows.join(' ').split(stop).length - 1).toBe(n);
    if (lang === 'en') expect(rows.join(' ').split(',').length - 1).toBe(1);
  });

  test('mental maths: the sum is shown big while the answer is spoken', async () => {
    const t = { id: 'ma.fluency', subtask: 'mental_math_fluency', time_limit_s: 60, items: [{ id: 'f1', shown: '3 + 4', target: '7' }] };
    const { runner, el, view } = mount({ battery_id: 'b', tasks: [t] }, { one_at_a_time: true }, {});
    runner.start(); runner.instructionDone(); runner.begin();
    view.render(); await flush();
    expect(el.querySelector('.sae-run-oral .sae-label').textContent).toContain('3 + 4');
  });
});
