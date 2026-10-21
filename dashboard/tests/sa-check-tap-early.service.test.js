'use strict';
/**
 * The sound check (dashboard/sa/sa-ui.js): Jugnu asks "Can you hear Jugnu?", then says the picture's word. A child
 * who taps a picture before the question has finished has answered the check: the word is not said after it (over
 * the next screen, or over the "no sound" screen), and nothing throws (the page logged
 * "Cannot read properties of null (reading 'target')" when the right picture was tapped early).
 * DOM tests: NODE_PATH=../portal/node_modules (jsdom).
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui: a picture tapped while the sound-check question is still playing', () => {
  let dom;
  const keep = {};
  const views = [];
  const rejections = [];
  const onRejection = (e) => { rejections.push(e); };
  let random;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
    rejections.length = 0;
    process.on('unhandledRejection', onRejection);
    // newCheck() with Math.random() = 0: the first picture is the one Jugnu names.
    random = jest.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    random.mockRestore();
    process.removeListener('unhandledRejection', onRejection);
    views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } });
    for (const k of Object.keys(keep)) global[k] = keep[k];
    dom.window.close();
  });

  const flush = (ms) => new Promise((r) => setTimeout(r, ms || 20));
  const words = (x) => (x == null ? '' : typeof x === 'string' ? x : x.text || x.en || x.ur || '');
  const task = { id: 'en.letters', response: 'record', lang: 'en', time_limit_s: 60, grid: ['m'], items: [], instruction: { text: 'Tell me the names of these letters.' } };
  const lines = { audio_check: { en: 'Can you hear Jugnu?', ur: 'کیا آپ کو جگنو کی آواز آ رہی ہے؟' } };

  // The question's clip is held until release(); every other line ends at once.
  function mount(uiOpts) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const battery = { battery_id: 'b', tasks: [task], lines };
    const said = [];
    let release = null;
    const runner = core.createRunner({ battery, now: () => 0, mic: () => 'ok', audio_check: true, warmup: true });
    const el = document.getElementById('m');
    const speak = (x) => {
      said.push(words(x));
      if (words(x) === lines.audio_check.en) return new Promise((r) => { release = r; });
      return Promise.resolve();
    };
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'en', mode: 'proctored', speak }, uiOpts));
    views.push(view);
    runner.start(); view.render();
    return { runner, el, said, release: () => release && release() };
  }
  const pics = (el) => [...el.querySelectorAll('.sae-check .sae-pic')];

  test('the right picture: the check passes, the word is not said afterwards, nothing throws', async () => {
    const { runner, el, said, release } = mount({});
    await flush();
    expect(runner.view().phase).toBe('audio_check');
    expect(said).toEqual([lines.audio_check.en]);
    const word = pics(el)[0].getAttribute('aria-label');
    pics(el)[0].click(); await flush();
    expect(runner.view().phase).toBe('warmup');
    said.length = 0;
    release(); await flush(50);
    expect(said).not.toContain(word);
    expect(rejections.map(String)).toEqual([]);
  });

  test('the wrong picture: the "no sound" screen shows, the word is not said over it, nothing throws', async () => {
    const { el, said, release } = mount({});
    await flush();
    const word = pics(el)[0].getAttribute('aria-label');
    pics(el)[1].click(); await flush();
    expect(el.querySelector('.sae-check.is-bad')).not.toBeNull();
    said.length = 0;
    release(); await flush(50);
    expect(said).not.toContain(word);
    expect(rejections.map(String)).toEqual([]);
  });

  test('control: no tap, the word follows the question', async () => {
    const { el, said, release } = mount({});
    await flush();
    const word = pics(el)[0].getAttribute('aria-label');
    release(); await flush(50);
    expect(said).toEqual([lines.audio_check.en, word]);
    expect(rejections.map(String)).toEqual([]);
  });
});
