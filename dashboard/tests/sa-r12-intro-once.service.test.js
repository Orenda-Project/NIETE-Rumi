'use strict';
/**
 * Round 12 (the Urdu reviewer, 12 Nov: "Jugnu won't tell…" in the Whole battery: "play it on the first task only"):
 * every Whole-battery part says the same "your turn" line on its Ready screen, «اب آپ کی باری ہے۔ جگنو آخر تک نہیں بتائے
 * گا کہ جواب صحیح ہے یا نہیں۔» / "Now it is your turn. Jugnu will not say if an answer is right until the end.", so a child
 * hears it about thirty times. With sa_r12_intro_once ON the child hears it once, on the first Ready screen of the run that
 * carries it; later Ready screens say only their begin line. Lines of their own (listening, every RDF part) are untouched.
 * OFF: as before. Mounts the real UI on a jsdom page with a real runner, on the served Whole battery.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const { COMMON } = require('../../bot/shared/services/child-test/sa/scripts');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const SA = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const PROD = { rdfW3Forms: true, oneAtATime: true, sayThenNext: true, r8CompWaitNext: true, tickPrompt: true, storyScroll: true,
  audioGatedNext: true, r8Counts: true };
const served = (g, lang, on) => applySwitches(JSON.parse(fs.readFileSync(path.join(SA, `sa.coach.${g}.A.${lang}.json`), 'utf8')), on);
const GENERIC = { en: COMMON.test_intro.en, ur: COMMON.test_intro.ur };

describe('sa_r12_intro_once: the served battery', () => {
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) for (const lang of ['ur', 'en']) {
    test(`${g} ${lang}: ON marks the generic line on the Whole battery's parts only; OFF marks nothing`, () => {
      const on = served(g, lang, { ...PROD, r12IntroOnce: true });
      expect(on.ui.r12_intro_once).toBe(true);
      const generic = (t) => !!(t.script && t.script.test_intro && t.script.test_intro.text === GENERIC[lang]);
      const marked = on.tasks.filter((t) => t.script && t.script.test_intro && t.script.test_intro.once === true);
      expect(marked.length).toBeGreaterThan(25);
      expect(marked.map((t) => t.id)).toEqual(on.tasks.filter(generic).map((t) => t.id));
      expect(marked.some((t) => t.w3)).toBe(false);
      // the words are the same: only the mark is added
      for (const t of marked) expect(t.script.test_intro.text).toBe(GENERIC[lang]);
      const off = served(g, lang, PROD);
      expect(off.ui.r12_intro_once).toBeUndefined();
      expect(off.tasks.some((t) => t.script && t.script.test_intro && 'once' in t.script.test_intro)).toBe(false);
    });
  }
});

describe('sa_r12_intro_once: the engine route reads it', () => {
  async function body(read) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, r12IntroOnce: read }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G4.A.ur.json`);
      return r.json();
    } finally { srv.close(); }
  }
  test('ON: the served battery carries ui.r12_intro_once and the marked line', async () => {
    const b = await body(() => true);
    expect(b.ui && b.ui.r12_intro_once).toBe(true);
    expect(b.tasks.filter((t) => t.script && t.script.test_intro && t.script.test_intro.once === true).length).toBeGreaterThan(25);
  });
  test('OFF: neither', async () => {
    const b = await body(() => false);
    expect(b.ui && b.ui.r12_intro_once).toBeFalsy();
    expect(b.tasks.some((t) => t.script && t.script.test_intro && 'once' in t.script.test_intro)).toBe(false);
  });
});

maybe('sa-ui: the Whole battery says "Jugnu will not say…" once per run', () => {
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
  /** The first n parts of the Whole battery in one run (practice dropped, each part ended from its Ready screen): what
   *  Jugnu said on each part's Ready screen. */
  async function readies(b, lang, n, mode) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const ids = b.full.slice(0, n);
    const run = { ...b, tasks: ids.map((id) => ({ ...b.tasks.find((t) => t.id === id), practice: [] })) };
    for (const k of ['rdf_auto', 'rdf_manual', 'rdf_variants']) delete run[k];
    const said = [];
    const runner = core.createRunner({ battery: run, onEvent: () => {}, mic: () => 'ok', audio_check: false, warmup: false,
      mic_check: false, oral_practice: false, keypad_warmup: false, one_at_a_time: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery: run, lang, mode: mode || 'proctored',
      speak: (t, a) => { said.push(textOf(t) || a); return Promise.resolve(); } });
    views.push(view);
    runner.start(); view.render();
    await jest.advanceTimersByTimeAsync(3000);
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      let v = runner.view();
      expect([ids[i], v.phase]).toEqual([ids[i], 'instruction']);
      runner.instructionDone(); view.render();
      const from = said.length;
      await jest.advanceTimersByTimeAsync(3000);
      v = runner.view();
      expect([ids[i], v.phase]).toEqual([ids[i], 'ready']);
      out.push({ id: ids[i], said: said.slice(from) });
      runner.coachEnd(); view.render();
      await jest.advanceTimersByTimeAsync(3000);
      if (runner.view().phase === 'task_end') { runner.next(); view.render(); await jest.advanceTimersByTimeAsync(3000); }
    }
    return out;
  }

  for (const lang of ['ur', 'en']) {
    test(`${lang} OFF: every part that carries the line says it on its Ready screen (as before)`, async () => {
      const b = served('G4', lang, PROD);
      const parts = await readies(b, lang, 6);
      const withLine = parts.filter((p) => b.tasks.find((t) => t.id === p.id).script.test_intro.text === GENERIC[lang]);
      expect(withLine.length).toBeGreaterThanOrEqual(5);
      for (const p of withLine) expect({ id: p.id, n: p.said.filter((s) => s === GENERIC[lang]).length }).toEqual({ id: p.id, n: 1 });
    });

    test(`${lang} ON: the line is said once, on the first Ready screen that carries it; every Ready still says its begin line`, async () => {
      const b = served('G4', lang, { ...PROD, r12IntroOnce: true });
      const parts = await readies(b, lang, 6);
      const all = parts.flatMap((p) => p.said);
      expect(all.filter((s) => s === GENERIC[lang]).length).toBe(1);
      // the first part that carries it says it (on the Urdu page listening has its own line, which it keeps)
      const lineOf = (p) => b.tasks.find((t) => t.id === p.id).script.test_intro.text;
      const first = parts.findIndex((p) => lineOf(p) === GENERIC[lang]);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(parts[first].said).toContain(GENERIC[lang]);
      for (const p of parts.slice(first + 1)) expect({ id: p.id, said: p.said.includes(GENERIC[lang]) }).toEqual({ id: p.id, said: false });
      for (const p of parts) if (lineOf(p) !== GENERIC[lang]) expect({ id: p.id, own: p.said.includes(lineOf(p)) }).toEqual({ id: p.id, own: true });
      if (lang === 'ur') expect(first).toBe(1);
      for (const p of parts) {
        const begin = b.tasks.find((t) => t.id === p.id).script.begin.text;
        expect({ id: p.id, begin: p.said.includes(begin) }).toEqual({ id: p.id, begin: true });
      }
    });
  }

  test('ON: a single-block run says it on that block\'s first part', async () => {
    const b = served('G4', 'ur', { ...PROD, r12IntroOnce: true });
    const block = { ...b, full: b.blocks.B1 };
    const parts = await readies(block, 'ur', 3);
    expect(parts[0].said).toContain(GENERIC.ur);
    expect(parts.slice(1).some((p) => p.said.includes(GENERIC.ur))).toBe(false);
  });
});
