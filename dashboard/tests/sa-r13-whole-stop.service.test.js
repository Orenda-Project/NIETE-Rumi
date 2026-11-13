'use strict';
/**
 * Round 13 (the Urdu reviewer, 12 Nov: "if a child is not able to complete any sub-part, it does not continue to the next
 * sub-part, and instead goes to the next section"): the Whole battery's move-on rule, behind sa_r13_whole_stop (default
 * OFF). The value picks what "not finished" means, so the reviewer's answer is a data change:
 *   "all" (or true)  round 7b's definition, a time-up included: a timed part whose minute ends before its last item, and a
 *                    story whose minute ends, skip the rest of the subject (Urdu → English → maths → end of test)
 *   "early"          only a part the test ended early skips the rest (EGRA's / EGMA's own stop rule, the silence stop, a
 *                    spoken question left unanswered); a minute that ends is that part finished
 * Only the Whole battery (the page's block "full", or none); RDF auto, RDF manual and the B-blocks keep their own rule.
 * Drives the real engine, runner and UI on a jsdom page over the served Whole battery.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { applySwitches } = require('../routes/sa-battery-switches');
const { createBrotliFlag } = require('../routes/web-quiz-brotli-flag');
const { COMMON } = require('../../bot/shared/services/child-test/sa/scripts');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const SA = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
// prod's switches today (12 Nov): the move-on rule and the time-up-goes-on rule are both ON
const PROD = { rdfW3Forms: true, oneAtATime: true, sayThenNext: true, r8CompWaitNext: true, tickPrompt: true, storyScroll: true,
  audioGatedNext: true, r8Counts: true, incompleteMoveOn: true, r8TimeupContinue: true, r8ReadingPosition: true, autoNoLastWord: true };
const served = (g, lang, on) => applySwitches(JSON.parse(fs.readFileSync(path.join(SA, `sa.coach.${g}.A.${lang}.json`), 'utf8')), on);

describe('sa_r13_whole_stop: the served battery', () => {
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) for (const lang of ['ur', 'en']) {
    test(`${g} ${lang}: "all" / "early" put the definition on battery.ui; OFF puts nothing`, () => {
      expect(served(g, lang, { ...PROD, r13WholeStopAll: true }).ui.r13_whole_stop).toBe('all');
      expect(served(g, lang, { ...PROD, r13WholeStopEarly: true }).ui.r13_whole_stop).toBe('early');
      expect(served(g, lang, PROD).ui.r13_whole_stop).toBeUndefined();
      // the tasks are untouched: only the engine's reading of a finished part changes
      expect(served(g, lang, { ...PROD, r13WholeStopAll: true }).tasks).toEqual(served(g, lang, PROD).tasks);
    });
  }
  test('with no other switch ON the battery gains only ui.r13_whole_stop', () => {
    const b = served('G4', 'ur', { r13WholeStopAll: true });
    expect(b.ui).toEqual({ r13_whole_stop: 'all' });
  });
});

describe('sa_r13_whole_stop: the stored value', () => {
  const reader = (value, match) => createBrotliFlag({ key: 'sa_r13_whole_stop', match,
    db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) }) });
  const read = async (value, match) => { const f = reader(value, match); f(); await f.ready(); return f(); };
  const { R13_ALL, R13_EARLY } = require('../routes/sa-battery-switches');
  test('"all" and true read as "all"; "early" as "early"; anything else as OFF', async () => {
    expect([await read('all', R13_ALL), await read(true, R13_ALL), await read('early', R13_ALL)]).toEqual([true, true, false]);
    expect([await read('early', R13_EARLY), await read('all', R13_EARLY), await read(true, R13_EARLY)]).toEqual([true, false, false]);
    for (const v of [undefined, false, 'yes', 'ALL', 1, { value: 'all' }]) {
      expect([await read(v, R13_ALL), await read(v, R13_EARLY)]).toEqual([false, false]);
    }
  });
  test('a flag without match is the strict boolean rule, unchanged', async () => {
    expect([await read(true), await read('all'), await read('true')]).toEqual([true, false, false]);
  });
});

describe('sa_r13_whole_stop: the engine route reads it', () => {
  async function body(all, early) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off,
      r13WholeStopAll: () => all, r13WholeStopEarly: () => early }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G4.A.ur.json`);
      return r.json();
    } finally { srv.close(); }
  }
  test('"all"', async () => { expect((await body(true, false)).ui.r13_whole_stop).toBe('all'); });
  test('"early"', async () => { expect((await body(false, true)).ui.r13_whole_stop).toBe('early'); });
  test('OFF', async () => { const b = await body(false, false); expect(b.ui && b.ui.r13_whole_stop).toBeFalsy(); });
});

describe('sa-page: only the Whole battery is "whole"', () => {
  const page = require('../sa/sa-page');
  test('block full or none: whole; every other block: not', () => {
    expect([page.wholeOf('full'), page.wholeOf(null), page.wholeOf(undefined)]).toEqual([true, true, true]);
    for (const b of ['rdf_auto', 'rdf_manual', 'rdf', 'B1', 'B5', 'maths', 'tower']) expect([b, page.wholeOf(b)]).toEqual([b, false]);
  });
});

maybe('the real engine + UI over the served Whole battery', () => {
  let dom;
  const keep = {};
  const live = [];
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
    live.splice(0).forEach((e) => { try { e.destroy(); } catch (_) { /* gone */ } });
    jest.useRealTimers();
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const textOf = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text != null ? x.text : (x.en || x.ur || ''));
  /** The served battery cut to `ids` (in that order, practice dropped), as the page hands it to SAE.start. */
  function cut(b, ids) {
    const out = { ...b, tasks: ids.map((id) => ({ ...b.tasks.find((t) => t.id === id), practice: [] })) };
    for (const k of ['rdf_auto', 'rdf_manual', 'rdf_variants', 'full', 'blocks']) delete out[k];
    return out;
  }
  async function engine(b, lang, opts) {
    const storeMod = require('../sa/sa-store');
    const { start } = require('../sa/sa-engine');
    let t = 0;
    const said = [];
    const s = await storeMod.open({ idb: null });
    const deps = {
      core: require('../sa/sa-core'), ui: require('../sa/sa-ui'), store: { open: () => Promise.resolve(s) },
      voice: { create: () => ({ speak: (x, a) => { said.push(textOf(x) || a); return Promise.resolve(); }, stop() {}, setMuted() {} }) },
      now: () => t, micState: () => 'ok', win: dom.window,
    };
    const e = await start({ mount: document.getElementById('m'), battery: b, mode: 'proctored', lang, session_id: `s-${Math.random()}`,
      audio_check: false, warmup: false, oral_practice: false, keypad_warmup: false, ...opts }, deps);
    live.push(e);
    const x = {
      e, said, s,
      // every runner call is followed by a render, as the UI's own taps do
      clock: async (ms) => { t += ms; if (e.view && e.view.render) e.view.render(); await jest.advanceTimersByTimeAsync(ms > 3000 ? 3000 : ms); },
      id: () => (e.runner.view().task || {}).id,
      phase: () => e.runner.view().phase,
      ids: () => e.runner.results().map((r) => [r.task_id, r.stop_reason]),
      /** The part on show, from its instruction to its Ready screen, then begun. */
      async enter() {
        if (x.phase() === 'battery_intro' || x.phase() === 'intro') { e.runner.start(); await x.clock(50); }
        if (x.phase() === 'instruction') { e.runner.instructionDone(); await x.clock(50); }
        if (x.phase() === 'ready') { e.runner.begin(); await x.clock(50); }
      },
      async next() { if (x.phase() === 'task_end') { e.runner.next(); await x.clock(50); } return x.id(); },
      /** n answers, right or wrong, on a tap / keypad part. */
      async answer(n, right) {
        for (let i = 0; i < n && x.phase() === 'running'; i++) {
          const it = e.runner.view().item;
          e.runner.answer(right ? String(it.target) : (it.options || []).find((o) => String(o) !== String(it.target)) || '9999');
          await x.clock(500);
        }
      },
      // the page's frame loop calls tick(); jsdom's frames do not follow jest's clock, so the walk calls it as the loop does
      async timeUp() { await x.clock(61000); e.runner.tick(); await x.clock(500); },
    };
    e.runner.start(); await x.clock(50);
    return x;
  }

  const URDU = ['ur.vocabulary', 'ur.letters', 'ur.nonwords', 'ur.words', 'en.initial_sound', 'en.letters', 'en.words'];
  const MATHS = ['ma.number_id', 'ma.discrimination', 'ma.missing'];

  test('OFF (prod today): letters\' minute ends → Urdu goes on to nonwords', async () => {
    const x = await engine(cut(served('G4', 'ur', PROD), URDU), 'ur', { whole: true });
    await x.enter(); await x.answer(10, true);
    expect(x.ids()).toEqual([['ur.vocabulary', 'complete']]);
    await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
    expect(x.ids().pop()).toEqual(['ur.letters', 'time_up']);
    expect(await x.next()).toBe('ur.nonwords');
  });

  for (const lang of ['ur', 'en']) {
    test(`${lang} "all": letters' minute ends → the rest of Urdu is skipped, the test goes on at English's first part`, async () => {
      const x = await engine(cut(served('G4', lang, { ...PROD, r13WholeStopAll: true }), URDU), lang, { whole: true });
      await x.enter(); await x.answer(10, true);
      await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
      expect(x.ids()).toEqual([['ur.vocabulary', 'complete'], ['ur.letters', 'time_up'], ['ur.nonwords', 'skipped_incomplete'], ['ur.words', 'skipped_incomplete']]);
      const ev = (await x.s.events(x.e.session_id)).filter((v) => v.type === 'incomplete_move_on');
      expect(ev).toEqual([expect.objectContaining({ task_id: 'ur.letters', value: expect.objectContaining({ by: 'app', section: 'ur', reason: 'time_up', reached: 3 }) })]);
      expect(await x.next()).toBe('en.initial_sound');
    });
  }

  test('"all": maths, number identification\'s minute ends before the last number → the rest of maths is skipped, the test ends', async () => {
    const x = await engine(cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true }), MATHS), 'ur', { whole: true });
    await x.enter(); await x.answer(4, true); await x.timeUp();
    expect(x.ids()).toEqual([['ma.number_id', 'time_up'], ['ma.discrimination', 'skipped_incomplete'], ['ma.missing', 'skipped_incomplete']]);
    await x.next();
    expect(x.phase()).toBe('battery_end');
  });

  test('"all": a part finished in its minute goes on (number identification, all 20 numbers)', async () => {
    const x = await engine(cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true }), MATHS), 'ur', { whole: true });
    await x.enter(); await x.answer(20, true);
    expect(x.ids()).toEqual([['ma.number_id', 'complete']]);
    expect(await x.next()).toBe('ma.discrimination');
  });

  test('"all": the story\'s minute ends → its questions are skipped; English goes on', async () => {
    const x = await engine(cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true }), ['ur.story', 'ur.story_comp', 'en.initial_sound']), 'ur', { whole: true });
    await x.enter(); await x.timeUp();
    expect(x.ids()).toEqual([['ur.story', 'time_up'], ['ur.story_comp', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.initial_sound');
  });

  test('"early": the minute ends → the next Urdu part; EGRA\'s early stop on nonwords → English', async () => {
    // the other two switches OFF: "early" alone brings the rule and the time-up-goes-on reading
    const on = { ...PROD, incompleteMoveOn: false, r8TimeupContinue: false, r13WholeStopEarly: true };
    const x = await engine(cut(served('G4', 'ur', on), URDU), 'ur', { whole: true });
    await x.enter(); await x.answer(10, true);
    await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
    expect(await x.next()).toBe('ur.nonwords');
    await x.enter(); await x.answer(5, false);
    expect(x.ids().slice(-2)).toEqual([['ur.nonwords', 'early_stop_first_line'], ['ur.words', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.initial_sound');
  });

  test('OFF with the two older switches OFF: no move-on at all (the switch is the only thing that brings it)', async () => {
    const on = { ...PROD, incompleteMoveOn: false, r8TimeupContinue: false };
    const x = await engine(cut(served('G4', 'ur', on), URDU), 'ur', { whole: true });
    await x.enter(); await x.answer(10, true);
    await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
    expect(await x.next()).toBe('ur.nonwords');
    await x.enter(); await x.answer(5, false);
    expect(await x.next()).toBe('ur.words');
  });

  for (const [label, opts] of [['RDF auto (block rdf_auto)', { whole: false }], ['no whole flag', {}], ['RDF manual', { whole: true, manual: true }]]) {
    test(`switch ON, ${label}: unchanged (the minute ends → the next part of the subject)`, async () => {
      const x = await engine(cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true }), URDU), 'ur', opts);
      await x.enter(); await x.answer(10, true);
      await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
      expect(x.ids().pop()).toEqual(['ur.letters', 'time_up']);
      expect(x.ids().some(([, why]) => why === 'skipped_incomplete')).toBe(false);
      if (!opts.manual) expect(await x.next()).toBe('ur.nonwords');
    });
  }

  test('"all" + the r12 intro-once line: said once in the run; the next subject\'s first part says only its own lines', async () => {
    const b = cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true, r12IntroOnce: true }), URDU);
    const x = await engine(b, 'ur', { whole: true });
    await x.enter(); await x.answer(10, true);
    await x.next(); await x.enter(); await x.answer(3, true); await x.timeUp();
    expect(await x.next()).toBe('en.initial_sound');
    const from = x.said.length;
    x.e.runner.instructionDone(); await x.clock(3000);
    expect(x.phase()).toBe('ready');
    const ready = x.said.slice(from);
    const t = b.tasks.find((k) => k.id === 'en.initial_sound');
    expect(ready).toContain(t.script.begin.text);
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(1);
  });

  test('"all" + intro-once, the line\'s first carrier skipped: the first part reached after the skip says it', async () => {
    // listening (its own line) left unanswered skips the rest of Urdu, vocabulary (the line's first carrier) included
    const b = cut(served('G4', 'ur', { ...PROD, r13WholeStopAll: true, r12IntroOnce: true }), ['ur.listening', 'ur.vocabulary', 'ur.letters', 'en.initial_sound']);
    const x = await engine(b, 'ur', { whole: true });
    await x.enter();
    for (let i = 0; i < 40 && x.phase() !== 'task_end'; i++) { await x.clock(3000); x.e.runner.tick(); }
    expect(x.ids()).toEqual([['ur.listening', 'complete'], ['ur.vocabulary', 'skipped_incomplete'], ['ur.letters', 'skipped_incomplete']]);
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(0);
    expect(await x.next()).toBe('en.initial_sound');
    x.e.runner.instructionDone(); await x.clock(3000);
    expect(x.phase()).toBe('ready');
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(1);
  });
});
