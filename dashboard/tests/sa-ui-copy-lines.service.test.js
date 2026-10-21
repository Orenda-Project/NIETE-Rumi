'use strict';
/**
 * Every line Jugnu says has a clip (dashboard/sa/sa-ui.js): the engine's own lines (right, try again, the answer shown,
 * the bubbles warm-up, the last-word question, all done, waiting for the map, the mic skip hint, give the phone to the
 * coach) are spoken from the battery's `lines` when the battery has them, so the voice plays the recorded clip; a
 * battery without them speaks the built-in words as before.
 * Runs where jsdom resolves (a portal dev dependency, not a dashboard one); skipped otherwise.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const NAMES = ['right', 'try_again', 'shown', 'warm_title', 'last_word', 'all_done', 'back_wait', 'mic_skip_say', 'give_coach'];
const LINES = Object.fromEntries(NAMES.map((n) => [n, { text: `line ${n}`, audio: `sa/v1/en/${n}.mp3` }]));

maybe('sa-ui: the engine\'s own lines come from the battery (with their clips)', () => {
  let dom;
  const keep = {};
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  let views = [];
  afterEach(() => { views.forEach((v) => v.destroy()); views = []; for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function mount(tasks, extra, lines) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks, lines };
    const runner = core.createRunner(Object.assign({ battery, onEvent: () => {} }, extra.runner));
    const said = [];
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'game', speak: (x) => { said.push(x); return Promise.resolve(); } }, extra.ui));
    views.push(view);
    return { runner, el, view, said };
  }
  const audioOf = (said, name) => said.filter((x) => x && x.audio === LINES[name].audio);
  const tap = { id: 'tap', mode: 'tap', items: [{ id: 't1', target: 'a', options: ['a', 'b'] }], practice: [{ id: 'p1', target: 'a', options: ['a', 'b'] }, { id: 'p2', target: 'a', options: ['a', 'b'] }] };
  const rec = { id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a b' }, items: [{ id: 'w', target: 'a', line: 1 }] };

  test('practice: right, try again, then the answer shown', async () => {
    const { runner, el, view, said } = mount([tap], { runner: {} }, LINES);
    runner.start(); runner.instructionDone(); view.render(); await wait(20);
    el.querySelector('[data-value="a"]').click();
    await wait(1400);
    expect(audioOf(said, 'right')).toHaveLength(1);
    el.querySelector('[data-value="b"]').click();
    await wait(1400);
    expect(audioOf(said, 'try_again')).toHaveLength(1);
    el.querySelector('[data-value="b"]').click();
    await wait(1400);
    expect(audioOf(said, 'shown')).toHaveLength(1);
  });

  test('the bubbles warm-up title, the last-word question, all done, waiting for the map', async () => {
    const { runner, view, said } = mount([rec], { runner: { warmup: true, mic: () => 'ok' } }, LINES);
    runner.start(); view.render(); await wait(20);
    expect(runner.view().phase).toBe('warmup');
    expect(audioOf(said, 'warm_title')).toHaveLength(1);
    runner.warmupDone(10, 3000); runner.instructionDone(); runner.begin(); runner.done();
    view.render(); await wait(20);
    expect(runner.view().phase).toBe('last_word');
    expect(audioOf(said, 'last_word')).toHaveLength(1);
    runner.lastWord(0); runner.next(); view.render(); await wait(20);
    expect(runner.view().phase).toBe('battery_end');
    expect(audioOf(said, 'all_done')).toHaveLength(1);
    view.backWait(); await wait(20);
    expect(audioOf(said, 'back_wait')).toHaveLength(1);
  });

  test('the game mic check\'s skip hint', async () => {
    const { runner, view, said } = mount([rec], { runner: { mic: () => 'unknown', mic_check: true }, ui: { micSkipMs: 60, micProbe: () => new Promise(() => {}) } }, LINES);
    runner.start(); view.render(); await wait(20);
    expect(runner.view().phase).toBe('mic_check');
    await wait(150);
    expect(audioOf(said, 'mic_skip_say')).toHaveLength(1);
  });

  test('proctored: give the phone to the coach', async () => {
    const { runner, view, said } = mount([tap], { runner: {}, ui: { mode: 'proctored' } }, LINES);
    runner.start(); runner.instructionDone();
    while (runner.view().phase === 'practice') runner.practiceAnswer('a');
    runner.begin(); runner.answer('a'); runner.next(); view.render(); await wait(20);
    expect(runner.view().phase).toBe('battery_end');
    expect(audioOf(said, 'give_coach')).toHaveLength(1);
  });

  test('a battery without the lines speaks the built-in words (no audio key)', async () => {
    const { runner, view, said } = mount([rec], { runner: { warmup: true, mic: () => 'ok' } }, undefined);
    runner.start(); view.render(); await wait(20);
    const w = said.find((x) => x && x.en === 'Pop the bubbles!');
    expect(w).toBeTruthy();
    expect(w.audio).toBeUndefined();
  });
});
