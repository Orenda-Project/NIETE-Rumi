'use strict';
/**
 * Round 7 (the pilot's tester: "have Jugnu say the student's name more often, especially during instructions"): the
 * child's name (the one the coach's page hands over) starts each task's instruction and the "Ready?" screen, on the
 * screen. Jugnu's voice is unchanged (his clips are recorded; a typed name has no clip in his voice). No name, no change;
 * RDF manual's coach screen is unchanged.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('the child\'s name at each task\'s start (sa-ui)', () => {
  let dom; let views = []; const keep = {};
  beforeEach(() => {
    views = [];
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const BATTERY = { battery_id: 'b', tasks: [{ id: 'ma.discrimination2', response: 'tap', lang: null, title: { en: 'Which is bigger', ur: 'کون سا بڑا ہے' },
    script: { intro_tap: { en: 'Look at these two numbers. Tap the bigger one.', ur: 'ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔' } },
    items: [{ id: 'ma.discrimination2.01', target: 24, options: [11, 24] }], practice: [] }] };
  function mount(extra) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery: BATTERY, now: () => 0, mic: () => 'ok', onEvent: () => {}, manual: !!(extra && extra.manual) });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery: BATTERY, lang: 'ur', mode: 'proctored', speak: () => Promise.resolve() }, extra));
    views.push(view);
    runner.start();
    return { runner, el, view };
  }
  test('the instruction starts with the name: «Rabia، ان دو نمبروں کو دیکھیں…»', async () => {
    const { el, view } = mount({ child: { first_name: 'Rabia' } });
    view.render(); await flush();
    const say = el.querySelector('.sae-instr .sae-say');
    expect(say.textContent).toBe('Rabia، ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔');
    expect(say.querySelector('bdi.sae-name').textContent).toBe('Rabia');
  });
  test('English page: "Rabia, Look at these two numbers…"', async () => {
    const { el, view } = mount({ child: { first_name: 'Rabia' }, lang: 'en' });
    view.render(); await flush();
    expect(el.querySelector('.sae-instr .sae-say').textContent).toBe('Rabia, Look at these two numbers. Tap the bigger one.');
  });
  test('the Ready screen: «Rabia، تیار ہیں؟»', async () => {
    const { runner, el, view } = mount({ child: { first_name: 'Rabia' } });
    runner.instructionDone(); view.render(); await flush();
    expect(runner.view().phase).toBe('ready');
    expect(el.querySelector('.sae-ready .sae-h1').textContent).toBe('Rabia، تیار ہیں؟');
  });
  test('no name: as before', async () => {
    const { runner, el, view } = mount({});
    view.render(); await flush();
    expect(el.querySelector('.sae-instr .sae-say').textContent).toBe('ان دو نمبروں کو دیکھیں۔ جو نمبر بڑا ہے، اسے دبائیں۔');
    runner.instructionDone(); view.render(); await flush();
    expect(el.querySelector('.sae-ready .sae-h1').textContent).toBe('تیار ہیں؟');
  });
});
