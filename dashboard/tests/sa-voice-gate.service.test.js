'use strict';
/**
 * The voice gate on real phones (3G, the temporary host's 429s): one refused child must not be lost.
 *   (a) the service worker fetches a session's files six at a time and tries a failed one once more after a pause;
 *       its version moves on, so phones take the new worker
 *   (b) the page counts and keeps only the clips of the part the child takes (the chosen block, its passage variant,
 *       the engine's lines), so an English clip that failed cannot refuse an Urdu child in a maths part
 *   (c) sa_voice_gate_v2 (battery.ui.voice_gate_v2, OFF by default): the refusal screen offers "Try again", which runs
 *       the preparation again in place; a voice found → the test starts
 *   (d) the page tells the coach page: {type:'sa:refused', s, reason:'voice'}, then {type:'sa:unrefused', s}
 */
const sw = require('../sa/sw');
const page = require('../sa/sa-page');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');

describe('(a) the service worker\'s fetches', () => {
  test('six at a time, never more', async () => {
    let inFlight = 0;
    let most = 0;
    const urls = Array.from({ length: 20 }, (_, i) => `https://p.test/sa/v2/ur/${i}.mp3`);
    const fetchFn = () => { inFlight++; most = Math.max(most, inFlight); return new Promise((r) => setTimeout(() => { inFlight--; r({ ok: true }); }, 5)); };
    const put = [];
    const missing = await sw.prefetch(urls, { fetch: fetchFn, put: (u) => { put.push(u); }, match: async () => null, ok: () => true, retryMs: 1 });
    expect(missing).toEqual([]);
    expect(put).toHaveLength(20);
    expect(most).toBeLessThanOrEqual(6);
    expect(most).toBeGreaterThan(1);
  });

  test('a clip refused once (429) is tried again after a pause and kept; refused twice it is missing', async () => {
    const tries = {};
    const fetchFn = (u) => { tries[u] = (tries[u] || 0) + 1; const bad = u.endsWith('a.mp3') ? tries[u] === 1 : u.endsWith('b.mp3'); return Promise.resolve({ ok: !bad, status: bad ? 429 : 200 }); };
    const missing = await sw.prefetch(['/sa/v2/en/a.mp3', '/sa/v2/en/b.mp3', '/sa/v2/en/c.mp3'], { fetch: fetchFn, put: () => {}, match: async () => null, ok: (u, r) => r.ok, retryMs: 1 });
    expect(missing).toEqual(['/sa/v2/en/b.mp3']);
    expect(tries['/sa/v2/en/a.mp3']).toBe(2);
    expect(tries['/sa/v2/en/b.mp3']).toBe(2);
    expect(tries['/sa/v2/en/c.mp3']).toBe(1);
  });

  test('a clip already kept is not fetched', async () => {
    const fetched = [];
    const missing = await sw.prefetch(['/x.mp3'], { fetch: (u) => { fetched.push(u); return Promise.resolve({ ok: true }); }, put: () => {}, match: async () => ({}), ok: () => true, retryMs: 1 });
    expect(missing).toEqual([]);
    expect(fetched).toEqual([]);
  });

  test('the worker\'s version moved on (sa-4)', () => {
    expect(sw.CORE).toBe('sa-core-sa-19'); // sa-19: round 8 close, sa-offline.js (nothing to a worker while an update is unanswered or a newer one exists)
  });
});

describe('(b) the part the child takes', () => {
  const full = {
    battery_id: 'f',
    lines: { welcome: { text: 'hi', audio: 'sa/v2/ur/welcome.mp3' } },
    blocks: { B2: ['en.words'], B4: ['ma.num'] },
    tasks: [
      { id: 'en.words', mode: 'tap', instruction: { text: 'x', audio: 'sa/v2/en/words.mp3' }, items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] },
      { id: 'ma.num', mode: 'tap', instruction: { text: 'y', audio: 'sa/v2/ur/num.mp3' }, items: [{ id: 'i', target: '1', options: ['1', '2'] }] },
    ],
  };

  test('prepareOf asks for the chosen block\'s battery: its clips and the engine\'s lines, nothing of the other parts', () => {
    const seen = [];
    const SAE = { prepare: (b, o) => { seen.push([b, o]); return Promise.resolve({ voice: 'clips' }); } };
    const battery = page.pick(full, 'B4');
    page.prepareOf(SAE, battery, 'ur', '/sa/batteries/sa.coach.G3.A.ur.json');
    expect(seen[0][0]).toBe(battery);
    expect(seen[0][1]).toEqual({ lang: 'ur', battery_url: '/sa/batteries/sa.coach.G3.A.ur.json', base: '/' });
    const { urls } = require('../sa/sa-offline');
    expect(urls(seen[0][0], 'ur', '/')).toEqual(['/sa/v2/ur/num.mp3', '/sa/v2/ur/welcome.mp3']);
  });
});

describe('(c)+(d) the refusal, told and tried again', () => {
  function fakeEngine() {
    const calls = { refuse: [], unrefuse: 0, logs: [] };
    return {
      calls,
      session_id: 'sess-1',
      runner: { log: (type, x) => calls.logs.push([type, x && x.value]) },
      view: { refuse: (kind, o) => calls.refuse.push([kind, o]), unrefuse: () => { calls.unrefuse++; } },
    };
  }
  function fakeWin() {
    const posts = [];
    const win = { location: { origin: 'https://p.test' }, posts };
    win.parent = { postMessage: (m, o) => posts.push([m, o]) };
    return win;
  }
  const flush = () => new Promise((r) => setTimeout(r, 5));

  test('no voice: the page refuses and tells the coach page sa:refused; OFF there is no Try again', async () => {
    const e = fakeEngine(); const win = fakeWin();
    page.voiceGate(e, Promise.resolve({ voice: 'none', ready: true, clips_total: 10, clips_cached: 7 }), { win, embed: true, battery: { tasks: [] } });
    await flush();
    expect(e.calls.refuse).toHaveLength(1);
    expect(e.calls.refuse[0][0]).toBe('voice');
    expect(e.calls.refuse[0][1]).toBeUndefined();
    expect(win.posts).toEqual([[{ type: 'sa:refused', s: 'sess-1', reason: 'voice' }, 'https://p.test']]);
    expect(e.calls.logs.map((l) => l[0])).toEqual(['device_ready', 'voice_not_ready']);
  });

  test('a voice: no refusal, nothing told', async () => {
    const e = fakeEngine(); const win = fakeWin();
    page.voiceGate(e, Promise.resolve({ voice: 'clips', ready: true }), { win, embed: true, battery: { tasks: [], ui: { voice_gate_v2: true } } });
    await flush();
    expect(e.calls.refuse).toHaveLength(0);
    expect(win.posts).toEqual([]);
  });

  test('sa_voice_gate_v2 ON: Try again runs the preparation again; a voice → unrefused, sa:unrefused; none → stays', async () => {
    const e = fakeEngine(); const win = fakeWin();
    const answers = [{ voice: 'none', clips_cached: 8 }, { voice: 'clips', clips_cached: 10 }];
    const again = jest.fn(() => Promise.resolve(answers.shift()));
    page.voiceGate(e, Promise.resolve({ voice: 'none', clips_total: 10, clips_cached: 7 }), { win, embed: true, battery: { tasks: [], ui: { voice_gate_v2: true } }, again });
    await flush();
    const retry = e.calls.refuse[0][1].retry;
    expect(typeof retry).toBe('function');
    expect(await retry()).toBe(false);
    expect(e.calls.unrefuse).toBe(0);
    expect(await retry()).toBe(true);
    expect(again).toHaveBeenCalledTimes(2);
    expect(e.calls.unrefuse).toBe(1);
    expect(win.posts.map((p) => p[0].type)).toEqual(['sa:refused', 'sa:unrefused']);
    expect(e.calls.logs.filter((l) => l[0] === 'voice_retry').map((l) => l[1])).toEqual([{ voice: 'none', clips_cached: 8 }, { voice: 'clips', clips_cached: 10 }]);
  });

  test('not embedded (a linked phone): refused, nothing posted', async () => {
    const e = fakeEngine(); const win = fakeWin();
    page.voiceGate(e, Promise.resolve({ voice: 'none' }), { win, embed: false, battery: { tasks: [] } });
    await flush();
    expect(e.calls.refuse).toHaveLength(1);
    expect(win.posts).toEqual([]);
  });

  test('the switch is served as battery.ui.voice_gate_v2', () => {
    expect(SWITCHES.voiceGateV2).toBe('sa_voice_gate_v2');
    expect(applySwitches({ tasks: [] }, { voiceGateV2: true }).ui).toEqual({ voice_gate_v2: true });
    expect(applySwitches({ tasks: [] }, {}).ui).toBeUndefined();
  });
});

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
(JSDOM ? describe : describe.skip)('(c) the refusal screen', () => {
  let dom;
  const keep = {};
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) { keep[k] = global[k]; global[k] = k === 'window' ? dom.window : dom.window[k]; }
    jest.resetModules();
  });
  afterEach(() => { for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = () => new Promise((r) => setTimeout(r, 20));
  function mount() {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery: { battery_id: 'b', tasks: [{ id: 't', mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] }] }, mic: () => 'ok' });
    const el = document.getElementById('m');
    const said = [];
    const view = ui.mount(el, { runner, lang: 'en', mode: 'proctored', speak: (x) => { said.push(x); return Promise.resolve(); } });
    return { el, view, said };
  }

  test('OFF (no retry): the refusal has no button, as before', async () => {
    const { el, view } = mount();
    view.refuse('voice'); await flush();
    expect(el.getAttribute('data-phase')).toBe('refused');
    expect(el.querySelector('button')).toBeNull();
    view.destroy();
  });

  test('Try again: no voice yet → stays refused and says so again; a voice → the handover screen', async () => {
    const { el, view, said } = mount();
    const answers = [false, true];
    view.refuse('voice', { retry: () => Promise.resolve(answers.shift()) }); await flush();
    const b = () => [...el.querySelectorAll('button')].find((x) => x.textContent === 'Try again');
    expect(b()).toBeTruthy();
    said.length = 0;
    b().click(); await flush();
    expect(el.getAttribute('data-phase')).toBe('refused');
    expect(said.map((x) => x && (x.en || x.text))).toEqual(['The voice is not ready yet']);
    b().click(); await flush();
    view.unrefuse(); await flush();
    expect(el.getAttribute('data-phase')).toBe('handover');
    view.destroy();
  });
});
