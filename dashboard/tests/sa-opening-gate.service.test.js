'use strict';
/**
 * RULING W3-18 (switch sa_voice_gate_v2, battery.ui.voice_gate_v2): Jugnu's opening words (the welcome, the sound
 * check) wait for their clips' prefetch before they are spoken, at most 3 s; on the cap the voice's own retry and
 * fallback take over. Before, the page spoke the opening the moment it showed, ~2 s before the service worker's
 * prefetch began, so on a rate-limited tunnel the first answer for the welcome clip was a refusal.
 *   sa-offline.js  prepare() tells o.onLines when the opening lines are on the phone (or given up on);
 *                  prepareSession() passes onLines through
 *   sa-page.js     with the switch ON the engine gets opening = (lines prefetched | preparation over); OFF, none
 *   sa-ui.js       the welcome and the sound-check prompt wait for opening (cap 3 s); a screen left meanwhile is silent
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const flush = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const words = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text || x.en || x.ur || '');
const lines = { welcome: { en: 'Assalam o alaikum! Welcome.', ur: 'السلام علیکم!' }, audio_check: { en: 'Can you hear Jugnu?', ur: 'کیا آپ کو جگنو کی آواز آ رہی ہے؟' } };
const task = { id: 'en.letters', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m'], items: [], instruction: { text: 'Tell me the names of these letters.' } };

describe('sa-offline: the opening lines report when they are on the phone', () => {
  const { prepareSession } = require('../sa/sa-offline');

  test('prepareSession passes onLines to the preparation', async () => {
    let seen = null;
    const onLines = () => {};
    await prepareSession({ tasks: [] }, { lang: 'en', onLines, offline: async (o) => { seen = o.onLines; return { ready: true, clips: 0 }; }, speech: null, storage: null, localStorage: null });
    expect(seen).toBe(onLines);
  });

  test('prepare: onLines fires once the lines list is answered, before the task clips are', async () => {
    const order = [];
    const sw = {
      postMessage(msg, [port]) {
        const first = msg.urls.some((u) => /lines-clip/.test(u));
        order.push(first ? 'ask:lines' : 'ask:other');
        setTimeout(() => { order.push(first ? 'done:lines' : 'done:other'); port.postMessage({ ok: true, missing: [] }); }, first ? 5 : 40);
      },
    };
    const keep = global.self;
    // the module binds its root (self) when it loads: a fresh copy over a phone with a service worker
    // a channel whose two ends just call each other (Node's real ports would keep the test process alive)
    function Channel() {
      const a = {}, b = {};
      a.postMessage = (data) => b.onmessage && b.onmessage({ data });
      b.postMessage = (data) => a.onmessage && a.onmessage({ data });
      this.port1 = a; this.port2 = b;
    }
    global.self = { navigator: { serviceWorker: { register: async () => ({}), ready: Promise.resolve({ active: sw }) } }, MessageChannel: Channel };
    let fresh;
    jest.isolateModules(() => { fresh = require('../sa/sa-offline'); });
    try {
      const battery = { battery_id: 'b', lines: { welcome: { en: 'Hi', audio: 'sa/v2/en/lines-clip.mp3' } }, tasks: [{ id: 't', mode: 'tap', instruction: { text: 'x', audio: 'sa/v2/en/task-clip.mp3' }, items: [] }] };
      await fresh.prepare({ battery_url: '/sa/batteries/x.json', battery, lang: 'en', base: '/', onLines: () => order.push('onLines') });
      expect(order).toContain('done:lines');
      expect(order.indexOf('onLines')).toBeGreaterThan(order.indexOf('done:lines'));
      expect(order.indexOf('onLines')).toBeLessThan(order.lastIndexOf('done:other'));
      expect(order.filter((x) => x === 'onLines')).toHaveLength(1);
    } finally {
      global.self = keep;
    }
  });
});

maybe('sa-ui: the opening words wait for their prefetch', () => {
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

  function mount(uiOpts) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks: [task], lines };
    const said = [];
    const runner = core.createRunner({ battery, now: () => 0, mic: () => 'ok', audio_check: true, warmup: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak: (x) => { said.push(words(x)); return Promise.resolve(); } }, uiOpts));
    views.push(view);
    return { runner, el, view, said };
  }
  const start = (el) => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Start').click();
  const held = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

  test('the welcome is not spoken until the prefetch is done, then once', async () => {
    const g = held();
    const { said, el, view } = mount({ opening: g.p });
    view.render(); start(el); await flush(50);
    expect(said).toEqual([]);
    g.open(); await flush();
    expect(said).toEqual([lines.welcome.en]);
  });

  test('a prefetch that never ends: the welcome is spoken at the 3 s cap, once', async () => {
    const { said, el, view } = mount({ opening: new Promise(() => {}) });
    view.render(); start(el); await flush(2600);
    expect(said).toEqual([]);
    await flush(700);
    expect(said).toEqual([lines.welcome.en]);
  }, 10000);

  test('the sound-check prompt waits too; a screen left while waiting says nothing', async () => {
    const g = held();
    const { said, el, view, runner } = mount({ opening: g.p });
    view.render(); start(el); await flush();
    el.querySelector('.sae-intro .sae-primary').click(); await flush();
    expect(runner.view().phase).toBe('audio_check');
    expect(said).toEqual([]);
    g.open(); await flush(50);
    expect(said[0]).toBe(lines.audio_check.en);
    expect(said).not.toContain(lines.welcome.en);
  });

  // qa-w3's live oracle: the welcome clip is requested (by the worker's prefetch) before Jugnu's first word, even when
  // the worker takes a moment to start. The real prepare() and the real screen, joined the way sa-page joins them.
  test('order: the welcome clip is requested before the first utterance (worker ready after 300 ms)', async () => {
    const log = [];
    const sw = {
      postMessage(msg, [port]) {
        msg.urls.forEach((u) => log.push(`request:${u}`));
        setTimeout(() => port.postMessage({ ok: true, missing: [] }), 30);
      },
    };
    function Channel() {
      const a = {}, b = {};
      a.postMessage = (data) => b.onmessage && b.onmessage({ data });
      b.postMessage = (data) => a.onmessage && a.onmessage({ data });
      this.port1 = a; this.port2 = b;
    }
    const keepSelf = global.self;
    global.self = { navigator: { serviceWorker: { register: () => new Promise((r) => setTimeout(() => r({}), 300)), ready: new Promise((r) => setTimeout(() => r({ active: sw }), 300)) } }, MessageChannel: Channel };
    let offline;
    jest.isolateModules(() => { offline = require('../sa/sa-offline'); });
    global.self = keepSelf;
    const WELCOME = 'sa/v2/en/welcome-clip.mp3';
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks: [task], lines: { ...lines, welcome: { en: lines.welcome.en, audio: WELCOME } }, ui: { voice_gate_v2: true } };
    let linesDone;
    const opening = new Promise((r) => { linesDone = r; });
    const prep = offline.prepare({ battery_url: '/sa/batteries/x.json', battery, lang: 'en', base: '/', onLines: linesDone });
    const runner = core.createRunner({ battery, now: () => 0, mic: () => 'ok', audio_check: true, warmup: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'en', mode: 'proctored', opening: Promise.race([opening, prep]),
      speak: (x) => { log.push(`utter:${words(x)}`); return Promise.resolve(); } });
    views.push(view);
    view.render(); start(el); await flush(600);
    const req = log.indexOf(`request:/${WELCOME}`);
    const utter = log.indexOf(`utter:${lines.welcome.en}`);
    expect(req).toBeGreaterThanOrEqual(0);
    expect(utter).toBeGreaterThan(req);
  });

  test('control, switch OFF (no opening): the welcome is spoken at once', async () => {
    const { said, el, view } = mount({});
    view.render(); start(el); await flush();
    expect(said).toEqual([lines.welcome.en]);
  });
});

maybe('sa-page: the engine gets the opening gate only with sa_voice_gate_v2', () => {
  let dom;
  const keep = {};
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; if (dom) dom.window.close(); });

  async function boot(ui) {
    dom = new JSDOM('<!doctype html><div id="sae-root"></div>', { url: 'https://portal.test/sa/play.html?s=sess-123456&form=sa.coach.G3.A.en&mode=proctored&lang=en&embed=1', pretendToBeVisual: true });
    keep.self = global.self;
    global.self = dom.window;
    jest.resetModules();
    const w = dom.window;
    let startOpts = null;
    let lines = null;
    let finish = null;
    w.fetch = async () => ({ ok: true, json: async () => ({ battery_id: 'b', tasks: [task], lines, ...(ui ? { ui } : {}) }) });
    w.SAE = {
      prepare: (b, o) => { lines = o.onLines; return new Promise((r) => { finish = r; }); },
      start: async (opts) => { startOpts = opts; return { runner: { log() {} }, on() {}, view: {}, store: null, session_id: 'sess-123456' }; },
    };
    require('../sa/sa-page').boot();
    await flush(50);
    return { startOpts, lines: () => lines, finish: () => finish };
  }

  test('ON: opening is passed, resolves when the lines are prefetched (not before)', async () => {
    const b = await boot({ voice_gate_v2: true });
    expect(b.startOpts).not.toBeNull();
    expect(b.startOpts.opening && typeof b.startOpts.opening.then).toBe('function');
    let open = false;
    b.startOpts.opening.then(() => { open = true; });
    await flush();
    expect(open).toBe(false);
    expect(typeof b.lines()).toBe('function');
    b.lines()(); await flush();
    expect(open).toBe(true);
  });

  test('ON: the whole preparation ending also opens it (no worker, no lines step)', async () => {
    const b = await boot({ voice_gate_v2: true });
    let open = false;
    b.startOpts.opening.then(() => { open = true; });
    b.finish()({ ready: false, voice: 'tts' }); await flush();
    expect(open).toBe(true);
  });

  test('OFF: no opening gate, as before', async () => {
    const b = await boot(null);
    expect(b.startOpts).not.toBeNull();
    expect(b.startOpts.opening == null).toBe(true);
  });
});
