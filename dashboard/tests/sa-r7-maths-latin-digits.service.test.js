'use strict';
/**
 * Round 7 (the pilot's tester): maths numbers on the screen are English digits (0-9) on the Urdu page too, "that's how
 * kids know them". Only what is SHOWN changes, and only for maths (ids "ma.…"): the practice feedback line under the
 * options, and the coach's lines in RDF manual (an item Jugnu says, the list of what Jugnu will say). Jugnu's Urdu
 * clips are unchanged (he still says the number in Urdu); a reading task keeps its own digits.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('maths numbers are shown in English digits on the Urdu page (sa-ui)', () => {
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
  function mount(battery, spoken, extra = {}) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery, onEvent: () => {}, manual: !!extra.manual });
    const el = document.getElementById('m');
    const view = ui.mount(el, Object.assign({ runner, battery, lang: 'ur', mode: extra.manual ? 'proctored' : 'game',
      speak: (t) => { spoken.push(t && (t.text || t.ur)); return Promise.resolve(); } }, extra));
    views.push(view);
    return { runner, el };
  }
  const toPractice = async (el, runner) => {
    runner.start();
    for (let i = 0; i < 6 && runner.view().phase !== 'practice'; i += 1) {
      const b = el.querySelector('.sae-primary') || el.querySelector('button');
      if (b) b.click();
      await flush();
    }
    expect(runner.view().phase).toBe('practice');
  };
  const tapTask = (id, lang) => ({
    battery_id: 'b', tasks: [{
      id, mode: 'tap', lang, script: {}, items: [{ id: `${id}.01`, target: 24, options: [11, 24] }],
      practice: [{ id: `${id}.p1`, target: 8, options: [8, 4],
        feedback: { correct: { text: 'بالکل ٹھیک، ۸ بڑا ہے۔', audio: 'sa/v1/ur/aaaaaaaaaaaa.mp3' }, wrong: { text: 'بڑا نمبر ۸ ہے۔', audio: 'sa/v1/ur/bbbbbbbbbbbb.mp3' } } }],
    }],
  });

  test('maths practice: the feedback line shows 8, not ۸; Jugnu still says the Urdu line', async () => {
    const spoken = [];
    const { runner, el } = mount(tapTask('ma.discrimination2', null), spoken);
    await toPractice(el, runner);
    spoken.length = 0;
    el.querySelector('[data-value="8"]').click();
    await flush(50);
    expect(el.querySelector('.sae-fb').textContent).toBe('بالکل ٹھیک، 8 بڑا ہے۔');
    expect(spoken[0]).toBe('بالکل ٹھیک، ۸ بڑا ہے۔');
  });

  test('a wrong maths practice answer: the line that shows the answer is in English digits too', async () => {
    const spoken = [];
    const { runner, el } = mount(tapTask('ma.discrimination2', null), spoken);
    await toPractice(el, runner);
    el.querySelector('[data-value="4"]').click();
    await flush(50);
    expect(el.querySelector('.sae-fb').textContent).not.toMatch(/[۰-۹]/);
  });

  test('a reading task keeps its own digits (only maths changes)', async () => {
    const spoken = [];
    const { runner, el } = mount(tapTask('ur.vocabulary', 'ur'), spoken);
    await toPractice(el, runner);
    el.querySelector('[data-value="8"]').click();
    await flush(50);
    expect(el.querySelector('.sae-fb').textContent).toBe('بالکل ٹھیک، ۸ بڑا ہے۔');
  });

  test('RDF manual: the coach\'s list of a maths task\'s items shows English digits', async () => {
    const spoken = [];
    const battery = { battery_id: 'b', ui: { rdf_manual: true }, tasks: [{
      id: 'ma.add2i', mode: 'oral', lang: null, script: { intro: { text: 'یہ جمع کے کچھ سوال ہیں۔' } },
      items: [{ id: 'ma.add2i.01', show: '13 + 6', target: 19, say: '۱۳ جمع ۶' }], practice: [],
    }] };
    const { runner, el } = mount(battery, spoken, { manual: true });
    runner.start();
    for (let i = 0; i < 4 && !el.querySelector('.sae-coach-brief'); i += 1) { const b = el.querySelector('.sae-primary'); if (b) b.click(); await flush(); }
    const said = [...el.querySelectorAll('.sae-coach-items li, .sae-coach-line')].map((x) => x.textContent);
    expect(said.length).toBeGreaterThan(0);
    expect(said.join(' | ')).toContain('13 جمع 6');
    expect(said.join(' | ')).not.toMatch(/[۰-۹]/);
  });
});
