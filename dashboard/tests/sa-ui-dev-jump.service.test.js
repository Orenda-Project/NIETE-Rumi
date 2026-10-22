'use strict';
/**
 * The sandbox-only "Jump to…" list in the engine's header (dashboard/sa/sa-ui.js, RULING #43): drawn only in the coach
 * (proctored) mode and only when the engine hands the screens a devJump (it does so only when the server injected
 * SA_DEV_TOOLS). Never in game mode. On a real DOM where jsdom resolves; skipped otherwise.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui dev jump on a DOM', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'Event', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const battery = {
    battery_id: 'b',
    tasks: [
      { id: 'en.letters', title: { en: 'Letters', ur: 'حروف' }, mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] },
      { id: 'ma.add1', mode: 'keypad', items: [{ id: 'k', target: '3' }] },
    ],
  };
  function mounted(mode, devTools, devJump, lang) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery, onEvent: () => {}, dev_tools: devTools });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: lang || 'en', mode, devJump, speak: () => Promise.resolve() });
    const go = el.querySelector('.sae-foot button');
    if (mode === 'proctored' && go) go.click();
    views.push(view);
    runner.start();
    view.render();
    return { el, runner };
  }

  test('proctored with devJump: a list of the session\'s tasks; choosing one calls devJump(index)', () => {
    const jumps = [];
    const { el } = mounted('proctored', true, (i) => jumps.push(i));
    const sel = el.querySelector('select.sae-devjump');
    expect(sel).not.toBeNull();
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Jump to…', '1. Letters', '2. ma.add1']);
    sel.value = '1';
    sel.dispatchEvent(new Event('change'));
    expect(jumps).toEqual([1]);
  });

  test('UR: the label in Urdu, the task titles in the page language', () => {
    const { el } = mounted('proctored', true, () => {}, 'ur');
    const sel = el.querySelector('select.sae-devjump');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['اس حصے پر جائیں…', '1. حروف', '2. ma.add1']);
  });

  test('no devJump (the server did not inject SA_DEV_TOOLS): no list', () => {
    const { el } = mounted('proctored', true, null);
    expect(el.querySelector('.sae-devjump')).toBeNull();
  });

  test('game mode never shows it, even with devJump', () => {
    const { el } = mounted('game', true, () => {});
    expect(el.querySelector('.sae-devjump')).toBeNull();
  });
});
