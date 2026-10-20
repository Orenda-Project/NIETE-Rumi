'use strict';
/**
 * The screens (dashboard/sa/sa-ui.js) on a real DOM: the game's mic check (probe → two tiles → the runner told), the
 * keypad warm-up (Done → keys counted), and the voice-not-ready refusal. Runs where jsdom resolves (a portal dev
 * dependency, not a dashboard one); skipped otherwise.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui on a DOM', () => {
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
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const flush = () => new Promise((r) => setTimeout(r, 20));
  function mount(battery, extra) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const calls = [];
    const runner = core.createRunner(Object.assign({ battery, onEvent: (e) => calls.push(e) }, extra.runner));
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve() }, extra.ui));
    return { runner, el, view, calls };
  }
  const rec = { id: 'story', mode: 'record', time_limit_s: 60, passage: { text: 'a b' }, items: [{ id: 'w', target: 'a', line: 1 }] };
  const keys = { id: 'add1', mode: 'keypad', time_limit_s: 60, items: [{ id: 'k', target: '4', shown: '1 + 3 =' }] };

  test('game mic check: the probe, then "I heard myself" tells the runner (pass + level)', async () => {
    const probes = [];
    const { runner, el, calls } = mount({ battery_id: 'b', tasks: [rec] }, {
      runner: { mic: () => 'unknown', mic_check: true },
      ui: { micProbe: () => { probes.push(1); return Promise.resolve({ ok: true, rms: 0.04, url: null }); } },
    });
    runner.start();
    (el.querySelector('.sae-primary') || el.querySelector('button')).click();
    await flush();
    expect(el.getAttribute('data-phase')).toBe('mic_check');
    const micBtn = [...el.querySelectorAll('button')].find((b) => /mic/i.test(b.className));
    micBtn.click();
    await flush(); await flush();
    expect(probes).toHaveLength(1);
    const tiles = [...el.querySelectorAll('button.sa-tile, button.sae-opt, button.sae-pic')];
    expect(tiles.length).toBeGreaterThanOrEqual(2);
    tiles[0].click();
    await flush();
    const ev = calls.find((e) => e.type === 'mic_check');
    expect(ev && ev.value).toEqual({ ok: true, rms: 0.04 });
    expect(runner.view().phase).toBe('instruction');
  });

  test('keypad warm-up: free typing, then Done → the runner gets the keys pressed', async () => {
    const { runner, el, calls } = mount({ battery_id: 'b', tasks: [keys] }, { runner: { keypad_warmup: true }, ui: {} });
    runner.start();
    (el.querySelector('.sae-primary') || el.querySelector('button')).click();
    await flush();
    expect(el.getAttribute('data-phase')).toBe('keypad_warmup');
    for (const k of ['1', '2', '3']) el.querySelector(`[data-key="${k}"]`).click();
    el.querySelector('.sae-primary').click();
    await flush();
    expect(calls.find((e) => e.type === 'keypad_warmup').value).toEqual({ keys: 3 });
    expect(runner.view().phase).toBe('instruction');
  });

  test('the passage: the star line is spoken first, the recorder opens only after it', async () => {
    let finishSpeech;
    const order = [];
    const { runner, view } = mount({ battery_id: 'b', tasks: [rec] }, {
      runner: { mic: () => 'ok' },
      ui: {
        speak: () => new Promise((r) => { order.push('speak'); finishSpeech = () => { order.push('spoken'); r(); }; }),
        onRecordStart: () => order.push('record'),
      },
    });
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    await flush();
    expect(order).not.toContain('record');
    finishSpeech && finishSpeech();
    await flush();
    expect(order.indexOf('record')).toBeGreaterThan(order.indexOf('spoken'));
  });

  test('proctored hand-back: the coach\'s 3-s press-and-hold reaches the engine (onUnlock), with no error', async () => {
    const unlocked = [];
    const errors = [];
    const onErr = (e) => errors.push(e.message || String(e));
    window.addEventListener('error', onErr);
    const one = { id: 'k', mode: 'keypad', items: [{ id: 'k1', target: '4' }] };
    const { runner, el, view } = mount({ battery_id: 'b', tasks: [one] }, { runner: {}, ui: { mode: 'proctored', onUnlock: () => unlocked.push(1), back: '/portal/leader/assess' } });
    runner.start(); runner.instructionDone(); runner.begin(); runner.answer('4'); runner.next();
    view.render();
    await flush();
    const hold = el.querySelector('.sae-hold');
    expect(hold).not.toBeNull();
    hold.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 3300));
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
    expect(unlocked).toEqual([1]);
  }, 10000);

  test('voice not ready: the whole screen says so; proctored has no way on', async () => {
    const { el, view } = mount({ battery_id: 'b', tasks: [keys], lines: { voice_not_ready: { en: 'Jugnu cannot speak on this phone yet.', ur: 'x' } } },
      { runner: {}, ui: { mode: 'proctored' } });
    view.refuse('voice');
    await flush();
    expect(el.textContent).toContain('Jugnu cannot speak on this phone yet.');
    expect(el.querySelectorAll('button.sae-primary')).toHaveLength(0);
  });
});
