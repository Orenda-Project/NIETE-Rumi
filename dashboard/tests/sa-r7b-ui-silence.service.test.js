'use strict';
/**
 * Round 7b (sa_silence_repeat, RDF auto): the silence reminder screen (dashboard/sa/sa-ui.js). Jugnu says the battery's
 * lines.silence_repeat (else the page's copy), the screen shows it with Try again; Try again runs the part again.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui silence reminder on a DOM', () => {
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
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function reminder(lang, lines) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const battery = { battery_id: 'b', lines: lines || {}, tasks: [{ id: 'ur.w', mode: 'record', present: 'one_at_a_time', advance_after_s: 0, time_limit_s: 60,
      items: [{ id: 'c1', target: 'x', show: 'x' }] }] };
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok', silence_repeat: true });
    runner.start(); runner.instructionDone(); runner.begin();
    runner.log('record_start', { task_id: 'ur.w' });
    runner.nextCell('tap');
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang, mode: 'game', speak: (t) => { said.push(t); return Promise.resolve(); } });
    views.push(view);
    view.render();
    return { el, said, runner };
  }

  test('EN: the reminder is shown and said; Try again runs the part again', async () => {
    const line = { text: 'Jugnu could not hear you.', audio: 'sa/v1/en/abc.mp3' };
    const { el, said, runner } = reminder('en', { silence_repeat: line });
    expect(el.getAttribute('data-phase')).toBe('silence_reminder');
    expect(el.textContent).toContain('Jugnu could not hear you.');
    // the long line is a paragraph under a short title (sa_ur_fit: never cut by the foot at 360x740)
    expect(el.querySelector('.sae-silence h1').textContent).toBe('Say it out loud');
    expect(el.querySelector('.sae-silence p.sae-p').textContent).toBe('Jugnu could not hear you.');
    await new Promise((r) => setTimeout(r, 0));
    expect(said).toContainEqual(line);
    const again = [...el.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent));
    again.click();
    expect(runner.view().phase).toBe('instruction');
  });
  test('UR, no battery line: the page\'s own Urdu copy', () => {
    const { el } = reminder('ur');
    expect(el.textContent).toContain('اونچی آواز');
    expect(el.querySelector('.sae-silence h1').textContent).toBe('اونچی آواز میں بولیں');
    // a small Jugnu, so the whole Urdu line stays above Try again at 360x740
    expect(el.querySelector('.sae-silence .sae-jugnu-s')).not.toBeNull();
    expect(el.querySelector('.sae-silence p.sae-p').textContent).toContain('جگنو آپ کی آواز نہیں سن سکا۔');
    expect([...el.querySelectorAll('button')].some((b) => /دوبارہ/.test(b.textContent))).toBe(true);
  });
});
