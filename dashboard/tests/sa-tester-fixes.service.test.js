'use strict';
/**
 * The external tester's findings on the engine side of the content:
 *   - /sa/batteries/ applies sa_practice_all_maths (OFF: today's practice; ON: practice for every maths task);
 *   - the page runs the RDF short form (block=rdf) with its item caps, and the whole battery never runs RDF-only tasks;
 *   - a practice line naming an item of the other language is said as a chain of clips, and the right-answer line is
 *     the battery's own (feedback.correct);
 *   - the disabled demo copy of item 1 shows with the instruction (the picture tiles are #3427's).
 * The DOM tests run where jsdom resolves (a portal dev dependency); skipped otherwise.
 */
const express = require('express');
const { createSaEngineRouter } = require('../routes/sa-engine.routes');
const { applySwitches } = require('../routes/sa-battery-switches');
const { pick, params } = require('../sa/sa-page');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

async function serve(practice) {
  const app = express();
  app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => practice }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { srv, base: `http://127.0.0.1:${srv.address().port}` };
}
const byId = (b, id) => b.tasks.find((t) => t.id === id);

describe('sa_practice_all_maths at /sa/batteries/', () => {
  test('OFF: today\'s practice, no practice_v2, no demo copy; ON: every maths task practises first', async () => {
    const off = await serve(false);
    let b;
    try { b = await (await fetch(`${off.base}/sa/batteries/sa.coach.G3.A.ur.json`)).json(); } finally { off.srv.close(); }
    expect(byId(b, 'ma.add1').practice).toEqual([]);
    expect(b.tasks.filter((t) => t.practice_v2)).toEqual([]);
    expect(byId(b, 'ma.patterns').script.demo_item).toBeUndefined();
    expect(byId(b, 'ma.missing').practice).toHaveLength(2);

    const on = await serve(true);
    try { b = await (await fetch(`${on.base}/sa/batteries/sa.coach.G3.A.ur.json`)).json(); } finally { on.srv.close(); }
    expect(byId(b, 'ma.add1').practice.map((p) => [p.shown, p.target])).toEqual([['1 + 4 =', 5]]);
    expect(byId(b, 'ma.patterns').script.demo_item.disabled).toBe(true);
    for (const t of b.tasks.filter((x) => x.id.startsWith('ma.'))) expect([t.id, t.practice.length > 0 || !!t.script.demo_item]).toEqual([t.id, true]);
  });

  test('applySwitches leaves its input alone and a task without the new fields as it was', () => {
    const t = { id: 'ma.add1', practice: [], practice_v2: [{ id: 'p' }], script: {} };
    const plain = { id: 'ur.words', practice: [{ id: 'q' }], script: {} };
    const b = { tasks: [t, plain] };
    const on = applySwitches(b, { practiceAllMaths: true });
    expect(on.tasks[0].practice).toEqual([{ id: 'p' }]);
    expect(on.tasks[1]).toBe(plain);
    expect(b.tasks[0].practice).toEqual([]);
    expect(applySwitches(b, {}).tasks[0]).toEqual({ id: 'ma.add1', practice: [], script: {} });
  });
});

describe('the RDF short form on the page', () => {
  const b = {
    battery_id: 'x', full: ['a', 'w'], rdf: ['r', 'w'], rdf_items: { w: 3 },
    tasks: [{ id: 'a' }, { id: 'w', items: [1, 2, 3, 4, 5, 6] }, { id: 'r', items: [] }],
  };
  test('block=rdf runs exactly the rdf list, word problems capped at 3, and the page accepts it', () => {
    const r = pick(b, 'rdf');
    expect(r.tasks.map((t) => t.id)).toEqual(['r', 'w']);
    expect(r.tasks[1].items).toEqual([1, 2, 3]);
    expect(b.tasks[1].items).toHaveLength(6);
    expect(r.battery_id).toBe('x#rdf');
    expect(params('?s=abcdef12&form=sa.coach.G3.A.ur&block=rdf', '').block).toBe('rdf');
  });
  test('the whole battery is its full order: an RDF-only task never runs in it', () => {
    expect(pick(b, 'full').tasks.map((t) => t.id)).toEqual(['a', 'w']);
    expect(pick(b, null).tasks.map((t) => t.id)).toEqual(['a', 'w']);
    expect(pick(b, 'full').battery_id).toBe('x');
    expect(pick(b, 'full').tasks[1].items).toHaveLength(6);
  });
  test('rdf_items {drop} leaves those items out (variants too), and a task whose dependency RDF does not run runs on its own', () => {
    const d = {
      battery_id: 'y', full: ['w', 's', 'c'], rdf: ['wr', 's', 'c'], rdf_items: { c: { drop: ['q4'] } },
      tasks: [{ id: 'w' }, { id: 's', depends_on: { task: 'w', skip_if_stop: 'early_stop_first_line' } },
        { id: 'c', depends_on: { task: 's', upto_item: 'last_word_tap' }, items: [{ id: 'q1' }, { id: 'q4' }, { id: 'q5' }], variants: [{ id: 'v0', items: [{ id: 'q1' }, { id: 'q4' }] }] },
        { id: 'wr', items: [] }],
    };
    const r = pick(d, 'rdf');
    expect(r.tasks.map((t) => t.id)).toEqual(['wr', 's', 'c']);
    expect(r.tasks[1].depends_on).toBeUndefined();
    expect(r.tasks[2].depends_on).toEqual({ task: 's', upto_item: 'last_word_tap' });
    expect(r.tasks[2].items.map((q) => q.id)).toEqual(['q1', 'q5']);
    expect(r.tasks[2].variants[0].items.map((q) => q.id)).toEqual(['q1']);
    expect(d.tasks[1].depends_on).toBeDefined();
    expect(pick(d, 'full').tasks[1].depends_on).toBeDefined();
  });
  test('a battery whose tasks are its full order is returned as it is', () => {
    const g = { battery_id: 'g', full: ['a'], tasks: [{ id: 'a' }] };
    expect(pick(g, 'full')).toBe(g);
  });
});

maybe('sa-ui: chains, the right line and the demo copy', () => {
  let dom;
  let views = [];
  const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  // Every view is destroyed (its timers stopped) before the DOM goes, so nothing fires into the next test file.
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  function mount(battery, spoken, lang = 'ur') {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery, onEvent: () => {} });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'game', speak: (t, a) => { spoken.push([t && (t.text || t[lang]), (t && t.lang) || null, a || (t && t.audio) || null]); return Promise.resolve(); } });
    views.push(view);
    return { runner, el };
  }
  const toPractice = async (el, runner) => {
    runner.start();
    for (let i = 0; i < 6 && runner.view().phase !== 'practice'; i += 1) {
      const b = el.querySelector('.sae-primary') || el.querySelector('button');
      if (b) b.click();
      await flush();
    }
    expect(runner.view().phase).toBe('practice');
  };
  const letters = (feedback) => ({
    battery_id: 'b', tasks: [{
      id: 'en.letters', mode: 'tap', lang: 'en', script: {}, items: [{ id: 'i1', target: 'a', options: ['a', 'b'], say: 'a' }],
      practice: [{ id: 'p1', target: 'T', options: ['T', 'S'], say: 'T', feedback }],
    }],
  });

  test('a right answer says feedback.correct; a chain is said clip by clip, the item in its own language', async () => {
    const spoken = [];
    const fb = {
      correct: [{ text: 'شاباش! اس حرف کا نام ہے:', audio: 'sa/v1/ur/aaaaaaaaaaaa.mp3', lang: 'ur' }, { text: 'T', audio: 'sa/v1/en/bbbbbbbbbbbb.mp3', lang: 'en' }],
      wrong: { text: 'x', audio: null },
    };
    const { runner, el } = mount(letters(fb), spoken);
    await toPractice(el, runner);
    spoken.length = 0;
    el.querySelector('[data-value="T"]').click();
    await flush(50);
    expect(spoken.slice(0, 2)).toEqual([
      ['شاباش! اس حرف کا نام ہے:', 'ur', 'sa/v1/ur/aaaaaaaaaaaa.mp3'],
      ['T', 'en', 'sa/v1/en/bbbbbbbbbbbb.mp3'],
    ]);
    expect(el.querySelector('.sae-fb').textContent).toBe('شاباش! اس حرف کا نام ہے: T');
  });

  test('a one-line feedback.correct is said as it is (the same-language page)', async () => {
    const spoken = [];
    const { runner, el } = mount(letters({ correct: { text: 'Yes! The name of this letter is T.', audio: 'sa/v1/en/cccccccccccc.mp3' }, wrong: { text: 'w' } }), spoken, 'en');
    await toPractice(el, runner);
    spoken.length = 0;
    el.querySelector('[data-value="T"]').click();
    await flush(50);
    expect(spoken[0]).toEqual(['Yes! The name of this letter is T.', null, 'sa/v1/en/cccccccccccc.mp3']);
  });

  test('the demo copy of item 1 shows under the instruction, every tile disabled, no answer marked', async () => {
    const spoken = [];
    const t = {
      id: 'ma.patterns', mode: 'tap', items: [{ id: 'ma.patterns.1a', target: 'circle', options: ['star', 'circle'], glyphs: ['★', '●'], say: 'q' }],
      script: { demo_item: { id: 'ma.patterns.1a.demo', options: ['star', 'circle'], glyphs: ['★', '●'], shown: '● ▲ ● ▲', disabled: true } },
    };
    const { runner, el } = mount({ battery_id: 'b', tasks: [t] }, spoken, 'en');
    runner.start();
    await flush();
    for (let i = 0; i < 6 && el.getAttribute('data-phase') !== 'instruction'; i += 1) { (el.querySelector('.sae-primary') || el.querySelector('button')).click(); await flush(); }
    expect(el.getAttribute('data-phase')).toBe('instruction');
    const demo = el.querySelector('.sae-demo');
    expect(demo).not.toBeNull();
    const b = [...demo.querySelectorAll('button')];
    expect(b).toHaveLength(2);
    expect(b.every((x) => x.disabled)).toBe(true);
    expect(demo.querySelector('.is-right')).toBeNull();
  });
});

describe('sa_passage_rotation', () => {
  const { rotate } = require('../sa/sa-page');
  const b = {
    battery_id: 'x', tasks: [
      { id: 'ur.story', passage: { text: 'A' }, items: ['a'], stop: { first_line_n: 5 }, variants: [{ id: 'v0', passage: { text: 'A' }, items: ['a'], stop: { first_line_n: 5 } }, { id: 'v1', src: 's1', fielded: true, passage: { text: 'B' }, items: ['b'], stop: { first_line_n: 9 } }, { id: 'v2', passage: { text: 'C' }, items: ['c'] }] },
      { id: 'ur.story_comp', items: ['qa'], variants: [{ id: 'v0', items: ['qa'] }, { id: 'v1', items: ['qb'] }, { id: 'v2', items: ['qc'] }] },
      { id: 'ma.add1', items: [1] },
    ],
  };
  test('one index per child for every rotating task: a passage and its questions stay together; the same child, the same texts', () => {
    const seen = new Set();
    for (const s of ['sess-aaaaaa', 'sess-bbbbbb', 'sess-cccccc', 'sess-dddddd', 'sess-eeeeee', 'sess-ffffff']) {
      const r = rotate(b, s);
      const story = r.tasks[0];
      const comp = r.tasks[1];
      expect(comp.items[0]).toBe(`q${story.items[0]}`);
      expect(story.variants).toBeUndefined();
      expect(story.variant.id).toBe(`v${'abc'.indexOf(story.items[0])}`);
      expect(rotate(b, s).tasks[0].items).toEqual(story.items);
      expect(r.tasks[2]).toBe(b.tasks[2]);
      seen.add(story.items[0]);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(b.tasks[0].variants).toHaveLength(3);
  });
  test('a battery with no variants (switch OFF) is returned as it is', () => {
    const plain = { tasks: [{ id: 'ur.story', items: ['a'] }] };
    expect(rotate(plain, 's')).toBe(plain);
  });
  test('the route drops variants while the switch is OFF and keeps them ON', async () => {
    const serveR = async (rot) => {
      const app = express();
      app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: () => false, passageRotation: () => rot }));
      const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
      try { return await (await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G3.A.ur.json`)).json(); } finally { srv.close(); }
    };
    const off = await serveR(false);
    expect(off.tasks.filter((t) => t.variants)).toEqual([]);
    const on = await serveR(true);
    expect(byId(on, 'ur.story').variants.map((v) => v.id)).toEqual(['rwp2026', 'select2024', 'prpkp2020']);
  });
});
