'use strict';
/**
 * Round 13b (the Urdu reviewer, 12 Nov: "one unanswered question shouldn't end the subject ... move the child on only
 * when they leave 2 questions in a row unanswered"): sa_r13_oral_rule, an integer N (default OFF = today, one is enough).
 * With N, a spoken part (listening, the story's questions, segmentation) ends the subject only when N questions in a row
 * run out with nobody pressing "I've answered" / Next; an answered question, and every new part, resets the count. Below
 * N the part goes on and is finished. Every mode the move-on rule runs in (the Whole battery, RDF auto, the B-blocks);
 * RDF manual unchanged. Drives the real engine, runner and UI on a jsdom page over the served batteries.
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
// the switches ON on staging and prod today (12 Nov) that touch a spoken part: the move-on rule, the time-up-goes-on rule,
// the questions' longer waits (30 s), the story's questions by the voice heard
const LIVE = { rdfW3Forms: true, oneAtATime: true, sayThenNext: true, r8CompWaitNext: true, tickPrompt: true, storyScroll: true,
  audioGatedNext: true, r8Counts: true, incompleteMoveOn: true, r8TimeupContinue: true, r8ReadingPosition: true, autoNoLastWord: true,
  r9QuestionTime: true, r9CompText: true, r9ScrollCue: true };
const ON2 = { ...LIVE, r13OralRule2: true };
const served = (g, lang, on) => applySwitches(JSON.parse(fs.readFileSync(path.join(SA, `sa.coach.${g}.A.${lang}.json`), 'utf8')), on);

describe('sa_r13_oral_rule: the served battery', () => {
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) for (const lang of ['ur', 'en']) {
    test(`${g} ${lang}: N on battery.ui.r13_oral_rule; OFF puts nothing; the tasks are untouched`, () => {
      expect(served(g, lang, ON2).ui.r13_oral_rule).toBe(2);
      expect(served(g, lang, { ...LIVE, r13OralRule3: true }).ui.r13_oral_rule).toBe(3);
      expect(served(g, lang, LIVE).ui.r13_oral_rule).toBeUndefined();
      expect(served(g, lang, ON2).tasks).toEqual(served(g, lang, LIVE).tasks);
    });
  }
  test('with no other switch ON the battery gains only ui.r13_oral_rule', () => {
    expect(served('G4', 'ur', { r13OralRule2: true }).ui).toEqual({ r13_oral_rule: 2 });
  });
});

describe('sa_r13_oral_rule: the stored value', () => {
  const reader = (value, match) => createBrotliFlag({ key: 'sa_r13_oral_rule', match,
    db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }) }) }) }) });
  const read = async (value, match) => { const f = reader(value, match); f(); await f.ready(); return f(); };
  const { MATCH } = require('../routes/sa-battery-switches');
  const all = async (v) => [await read(v, MATCH.r13OralRule2), await read(v, MATCH.r13OralRule3), await read(v, MATCH.r13OralRule4), await read(v, MATCH.r13OralRule5)];
  test('2 and "2" read as 2; 3, 4, 5 as themselves', async () => {
    expect(await all(2)).toEqual([true, false, false, false]);
    expect(await all('2')).toEqual([true, false, false, false]);
    expect(await all(3)).toEqual([false, true, false, false]);
    expect(await all(5)).toEqual([false, false, false, true]);
  });
  test('no row, 1, 0, 6, true, "yes", 2.5, {n: 2}: OFF (today: one unanswered question is enough)', async () => {
    for (const v of [undefined, 1, '1', 0, 6, true, false, 'yes', 2.5, { n: 2 }, null]) expect([v, await all(v)]).toEqual([v, [false, false, false, false]]);
  });
});

describe('sa_r13_oral_rule: the engine route reads it', () => {
  async function body(readers) {
    const { createSaEngineRouter } = require('../routes/sa-engine.routes');
    const off = () => false;
    const app = express();
    app.use(createSaEngineRouter({ on: () => true, practiceAllMaths: off, passageRotation: off, voiceV2: off, ...readers }));
    const srv = app.listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G4.A.ur.json`);
      return r.json();
    } finally { srv.close(); }
  }
  test('2', async () => { expect((await body({ r13OralRule2: () => true })).ui.r13_oral_rule).toBe(2); });
  test('OFF', async () => { const b = await body({ r13OralRule2: () => false }); expect(b.ui && b.ui.r13_oral_rule).toBeFalsy(); });
});

maybe('the real engine + UI: N unanswered spoken questions in a row', () => {
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
  function cut(b, ids, n = {}) {
    const out = { ...b, tasks: ids.map((id) => {
      const t = b.tasks.find((k) => k.id === id);
      return { ...t, practice: [], ...(n[id] ? { items: t.items.slice(0, n[id]) } : {}) };
    }) };
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
      clock: async (ms) => { t += ms; if (e.view && e.view.render) e.view.render(); await jest.advanceTimersByTimeAsync(ms > 3000 ? 3000 : ms); },
      id: () => (e.runner.view().task || {}).id,
      phase: () => e.runner.view().phase,
      ids: () => e.runner.results().map((r) => [r.task_id, r.stop_reason]),
      result: (id) => e.runner.results().find((r) => r.task_id === id),
      moves: async () => (await s.events(e.session_id)).filter((v) => v.type === 'incomplete_move_on'),
      async enter() {
        if (x.phase() === 'battery_intro' || x.phase() === 'intro') { e.runner.start(); await x.clock(50); }
        if (x.phase() === 'instruction') { e.runner.instructionDone(); await x.clock(50); }
        if (x.phase() === 'ready') { e.runner.begin(); await x.clock(50); }
      },
      async next() { if (x.phase() === 'task_end') { e.runner.next(); await x.clock(50); } return x.id(); },
      /** The spoken question on show: "I've answered". */
      async said1() { e.runner.answer('spoken'); await x.clock(500); },
      /** The spoken question on show runs out with nobody pressing anything (the page's frame loop calls tick()). */
      async silent() {
        const q = (e.runner.view().item || {}).id;
        for (let i = 0; i < 40 && x.phase() === 'running' && (e.runner.view().item || {}).id === q; i++) { await x.clock(3000); e.runner.tick(); }
        await x.clock(50);
      },
      /** A pattern over the part's questions: 'a' answered, 's' silent. */
      async walk(p) { for (const c of p) { if (x.phase() !== 'running') break; if (c === 'a') await x.said1(); else await x.silent(); } },
    };
    e.runner.start(); await x.clock(50);
    return x;
  }

  const URDU = ['ur.listening', 'ur.vocabulary', 'ur.letters', 'en.listening'];

  test('OFF (today): one listening question unanswered → the rest of Urdu is skipped', async () => {
    const x = await engine(cut(served('G4', 'ur', LIVE), URDU), 'ur', { whole: true });
    await x.enter(); await x.walk('saaaaa');
    expect(x.ids()).toEqual([['ur.listening', 'complete'], ['ur.vocabulary', 'skipped_incomplete'], ['ur.letters', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.listening');
  });

  for (const lang of ['ur', 'en']) {
    test(`${lang} N=2, Whole battery: one listening question unanswered → the part goes on, the next Urdu part runs`, async () => {
      const x = await engine(cut(served('G4', lang, ON2), URDU), lang, { whole: true });
      await x.enter(); await x.walk('saaaaa');
      expect(x.ids()).toEqual([['ur.listening', 'complete']]);
      expect(x.result('ur.listening').answers.map((a) => a.value)).toEqual(Array(6).fill('spoken'));
      expect(await x.moves()).toEqual([]);
      expect(await x.next()).toBe('ur.vocabulary');
    });
  }

  test('N=2, Whole battery: two in a row → the part ends there, the rest of Urdu is skipped, English runs', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), URDU), 'ur', { whole: true });
    await x.enter(); await x.walk('ass');
    expect(x.ids()).toEqual([['ur.listening', 'time_up'], ['ur.vocabulary', 'skipped_incomplete'], ['ur.letters', 'skipped_incomplete']]);
    // the stored answers keep today's values ('spoken'), only the three questions reached
    expect(x.result('ur.listening').answers.map((a) => a.value)).toEqual(['spoken', 'spoken', 'spoken']);
    expect(await x.moves()).toEqual([expect.objectContaining({ task_id: 'ur.listening',
      value: expect.objectContaining({ by: 'app', section: 'ur', reason: 'time_up', reached: 1, of: 6, in_a_row: 2 }) })]);
    expect(await x.next()).toBe('en.listening');
  });

  test('N=2: unanswered, answered, unanswered → no move-on', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), URDU), 'ur', { whole: true });
    await x.enter(); await x.walk('sasasa');
    expect(x.ids()).toEqual([['ur.listening', 'complete']]);
    expect(await x.next()).toBe('ur.vocabulary');
  });

  test('N=2: the last two both unanswered → the part ends complete and the rest of the subject is skipped', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), URDU), 'ur', { whole: true });
    await x.enter(); await x.walk('aaaass');
    expect(x.ids()).toEqual([['ur.listening', 'complete'], ['ur.vocabulary', 'skipped_incomplete'], ['ur.letters', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.listening');
  });

  test('N=2: the last two unanswered on the subject\'s last part → nothing to skip, the next subject runs', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), ['ur.story_comp', 'en.listening']), 'ur', { whole: true });
    await x.enter(); await x.walk('aaaass');
    expect(x.ids()).toEqual([['ur.story_comp', 'complete']]);
    expect(await x.next()).toBe('en.listening');
  });

  test('N=2: a part with one question can never reach 2 → the subject goes on', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), URDU, { 'ur.listening': 1 }), 'ur', { whole: true });
    await x.enter(); await x.walk('s');
    expect(x.ids()).toEqual([['ur.listening', 'complete']]);
    expect(await x.next()).toBe('ur.vocabulary');
  });

  test('N=2: the count starts again in every part (one unanswered at the end of one part, one at the start of the next)', async () => {
    const x = await engine(cut(served('G4', 'en', ON2), ['en.listening', 'en.segmentation', 'en.letters']), 'en', { whole: true });
    await x.enter(); await x.walk('aaaaas');
    expect(await x.next()).toBe('en.segmentation');
    await x.enter(); await x.walk('saaaaaaaaa');
    expect(x.ids()).toEqual([['en.listening', 'complete'], ['en.segmentation', 'complete']]);
    expect(await x.next()).toBe('en.letters');
  });

  test('N=2: segmentation, two in a row → the rest of English is skipped', async () => {
    const x = await engine(cut(served('G4', 'en', ON2), ['en.segmentation', 'en.letters', 'ma.number_id']), 'en', { whole: true });
    await x.enter(); await x.walk('aass');
    expect(x.ids()).toEqual([['en.segmentation', 'time_up'], ['en.letters', 'skipped_incomplete']]);
    expect(await x.next()).toBe('ma.number_id');
  });

  test('N=2: EGRA\'s early-stop rule still ends the subject (a tap part: first sounds, first line all wrong)', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), ['ur.initial_sound', 'ur.letters', 'en.listening']), 'ur', { whole: true });
    await x.enter();
    for (let i = 0; i < 10 && x.phase() === 'running'; i++) {
      const it = x.e.runner.view().item;
      x.e.runner.answer((it.options || []).find((o) => String(o) !== String(it.target)));
      await x.clock(500);
    }
    expect(x.ids()).toEqual([['ur.initial_sound', expect.stringMatching(/^(early_stop_first_line|consecutive_errors)$/)], ['ur.letters', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.listening');
  });

  test('N=2, the story\'s questions after the story\'s minute ran out (asked): one unanswered → goes on; two → English', async () => {
    const b = cut(served('G4', 'ur', ON2), ['ur.story', 'ur.story_comp', 'ur.letters', 'en.listening']);
    let x = await engine(b, 'ur', { whole: true });
    await x.enter(); await x.clock(61000); x.e.runner.tick(); await x.clock(500);
    expect(x.ids()).toEqual([['ur.story', 'time_up']]);
    expect(await x.next()).toBe('ur.story_comp');
    await x.enter(); await x.walk('saaaaa');
    expect(await x.next()).toBe('ur.letters');
    x = await engine(b, 'ur', { whole: true });
    await x.enter(); await x.clock(61000); x.e.runner.tick(); await x.clock(500);
    await x.next(); await x.enter(); await x.walk('ss');
    expect(x.ids()).toEqual([['ur.story', 'time_up'], ['ur.story_comp', 'time_up'], ['ur.letters', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.listening');
  });

  test('N=2, RDF auto (not whole): the story\'s questions follow the rule too', async () => {
    const b = cut(served('G4', 'ur', ON2), ['ur.story_comp_w3', 'ur.letter_names5', 'en.letter_names5']);
    let x = await engine(b, 'ur', { whole: false });
    await x.enter(); await x.walk('saaaaa');
    expect(await x.next()).toBe('ur.letter_names5');
    x = await engine(b, 'ur', { whole: false });
    await x.enter(); await x.walk('ss');
    expect(x.ids()).toEqual([['ur.story_comp_w3', 'time_up'], ['ur.letter_names5', 'skipped_incomplete']]);
    expect(await x.next()).toBe('en.letter_names5');
  });

  test('N=2, RDF manual (coach-led): unchanged, the coach moves on (no question runs out, nothing skipped)', async () => {
    const x = await engine(cut(served('G4', 'ur', ON2), URDU), 'ur', { whole: false, manual: true });
    await x.enter(); await x.walk('ss');
    expect(x.phase()).toBe('running');
    expect(x.ids()).toEqual([]);
  });

  test('N=2 + the r12 intro-once line: two in a row skip its first carrier; the first part reached after says it once', async () => {
    const b = cut(served('G4', 'ur', { ...ON2, r12IntroOnce: true }), ['ur.listening', 'ur.vocabulary', 'ur.letters', 'en.initial_sound']);
    const x = await engine(b, 'ur', { whole: true });
    await x.enter(); await x.walk('ss');
    expect(x.ids()).toEqual([['ur.listening', 'time_up'], ['ur.vocabulary', 'skipped_incomplete'], ['ur.letters', 'skipped_incomplete']]);
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(0);
    expect(await x.next()).toBe('en.initial_sound');
    x.e.runner.instructionDone(); await x.clock(3000);
    expect(x.phase()).toBe('ready');
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(1);
  });

  test('N=2 + intro-once, one unanswered (no skip): vocabulary says the line once, letters does not', async () => {
    const b = cut(served('G4', 'ur', { ...ON2, r12IntroOnce: true }), ['ur.listening', 'ur.vocabulary', 'ur.letters']);
    const x = await engine(b, 'ur', { whole: true });
    await x.enter(); await x.walk('saaaaa');
    expect(await x.next()).toBe('ur.vocabulary');
    x.e.runner.instructionDone(); await x.clock(3000);
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(1);
    x.e.runner.begin(); await x.clock(50);
    for (let i = 0; i < 20 && x.phase() === 'running'; i++) { const it = x.e.runner.view().item; x.e.runner.answer(String(it.target)); await x.clock(500); }
    expect(await x.next()).toBe('ur.letters');
    x.e.runner.instructionDone(); await x.clock(3000);
    expect(x.said.filter((s) => s === COMMON.test_intro.ur).length).toBe(1);
  });
});
