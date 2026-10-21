'use strict';
/**
 * RDF manual (sa_rdf_manual, block rdf_manual): the coach gives every instruction and reads every spoken item.
 * In a manual run Jugnu says ONE line per task, "Your coach will now give the instructions", and nothing else:
 * no instruction, practice or item clips, no feedback lines. Every item that auto mode speaks is on the coach's
 * screen for the coach to read out. RDF auto is unchanged.
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const LINE = { en: 'Your coach will now give the instructions.', ur: 'اب آپ کے کوچ ہدایات دیں گے۔' };

/** One task of a real form, on its own (its gates and dependencies off, so every item is asked). */
function alone(f, id) {
  const t = JSON.parse(JSON.stringify(form(f).tasks.find((x) => x.id === id)));
  delete t.depends_on;
  (t.items || []).forEach((it) => { delete it.gate; });
  return t;
}
const cases = [];
[['sa.coach.G3.A.en.json', 'en'], ['sa.coach.G5.A.ur.json', 'ur']].forEach(([f, lang]) => form(f).rdf_manual.forEach((id) => cases.push([f, id, lang])));

maybe('sa-ui: RDF manual is silent but for the coach line', () => {
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
  function mount(battery, manual, lang) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    let t = 0;
    const clock = { now: () => t, add: (ms) => { t += ms; } };
    const runner = core.createRunner({ battery, now: clock.now, mic: () => 'ok', one_at_a_time: true, manual });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'proctored', manual, speak: (x, a) => { said.push([x, a]); return Promise.resolve(); } });
    views.push(view);
    return { runner, el, view, said, clock };
  }
  const button = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);

  /** Walk one task through the screens (taps where the child taps), to its end. */
  async function walk(m) {
    const { runner, el, view, clock } = m;
    runner.start(); view.render(); await flush();
    for (let n = 0; n < 400; n++) {
      const v = runner.view();
      if (v.phase === 'task_end' || v.phase === 'battery_end') break;
      if (v.phase === 'instruction') {
        const b = button(el, 'Give the phone to the child') || button(el, 'اب فون بچے کو دیں') || el.querySelector('.sae-instr .sae-primary');
        b.click();
      } else if (v.phase === 'practice') {
        const target = String(v.practice.target);
        const next = el.querySelector('.sae-practice .sa-next');
        const tile = /^(keypad|keyboard)$/.test(v.task.mode) ? null : [...el.querySelectorAll('.sae-practice button')].find((b) => b.textContent === target);
        if (next) next.click(); else if (tile) tile.click(); else runner.practiceAnswer(v.practice.target);
        await flush(1300);
      } else if (v.phase === 'ready') {
        el.querySelector('.sae-go').click();
      } else if (v.phase === 'running' && v.cell != null) {
        el.querySelector('.sa-next').click();
      } else if (v.phase === 'running' && v.item) {
        runner.answer(v.task.mode === 'oral' ? 'spoken' : v.item.target);
      } else if (v.phase === 'running') {
        runner.done();
      } else if (v.phase === 'last_word') {
        runner.lastWord(0);
      } else if (v.phase === 'listen') {
        clock.add(1);
      } else {
        throw new Error('phase ' + v.phase);
      }
      view.render(); await flush();
    }
    await flush(50);
    return runner.view();
  }

  test.each(cases)('%s %s: a manual run plays exactly one clip, the coach line', async (f, id, lang) => {
    const m = mount({ battery_id: 'b', tasks: [alone(f, id)] }, true, lang);
    const end = await walk(m);
    expect(['task_end', 'battery_end']).toContain(end.phase);
    expect(m.said.map((x) => words(x[0], lang))).toEqual([LINE[lang]]);
  }, 60000);

  test.each(cases.filter(([f, id]) => (alone(f, id).items || []).some((it) => it.say || it.prompt)))('%s %s: every item auto speaks is on the coach screen', async (f, id, lang) => {
    const t = alone(f, id);
    const m = mount({ battery_id: 'b', tasks: [t] }, true, lang);
    m.runner.start(); m.view.render(); await flush();
    const brief = m.el.querySelector('.sae-coach-brief');
    expect(brief).not.toBeNull();
    const listed = [...brief.querySelectorAll('.sae-coach-items li')].map((li) => li.textContent);
    const spoken = t.items.filter((it) => it.say || it.prompt).map((it) => (typeof it.say === 'string' ? it.say : words(it.say || it.prompt)));
    expect(spoken.length).toBeGreaterThan(0);
    expect(listed).toEqual(spoken);
  });

  test('manual: on the child\'s screen an oral question is shown for the coach to read, with no replay', async () => {
    const t = alone('sa.coach.G3.A.en.json', 'en.story_comp_w3');
    const m = mount({ battery_id: 'b', tasks: [t] }, true, 'en');
    m.runner.start(); m.runner.instructionDone();
    while (m.runner.view().phase === 'practice') m.runner.practiceAnswer(m.runner.view().practice.target);
    m.runner.begin(); m.view.render(); await flush();
    const q = m.el.querySelector('.sae-run-oral .sae-coach-says');
    expect(q).not.toBeNull();
    expect(q.textContent).toContain(words(t.items[0].say || t.items[0].prompt));
    expect(m.el.querySelector('.sae-run-oral .sae-replay')).toBeNull();
  });

  test('manual: a spoken question has no answer clock (the coach reads it, then the child answers)', () => {
    const core = require('../sa/sa-core');
    const t = alone('sa.coach.G3.A.en.json', 'en.story_comp_w3');
    let now = 0;
    const r = core.createRunner({ battery: { battery_id: 'b', tasks: [t] }, now: () => now, mic: () => 'ok', manual: true });
    r.start(); r.instructionDone();
    while (r.view().phase === 'practice') r.practiceAnswer(r.view().practice.target);
    r.begin(); r.promptDone();
    const first = r.view().item.id;
    now += 120000; r.tick();
    expect(r.view().item.id).toBe(first);
  });

  test('auto is unchanged: the same task speaks its instruction and items', async () => {
    const t = alone('sa.coach.G3.A.en.json', 'en.story_comp_w3');
    const m = mount({ battery_id: 'b', tasks: [t] }, false, 'en');
    await walk(m);
    const said = m.said.map((x) => words(x[0]));
    expect(said).toContain(words(t.script.intro));
    expect(said).toContain(words(t.items[0].say || t.items[0].prompt));
    expect(said).not.toContain(LINE.en);
  }, 60000);
});
