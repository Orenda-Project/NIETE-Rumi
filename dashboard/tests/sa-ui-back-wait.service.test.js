'use strict';
/**
 * The game's last screen while the map cannot be reached (dashboard/sa/sa-ui.js backWait): the "All done" screen stays,
 * with one line shown and spoken once: the island is saved on this phone and goes when the internet is back. On a real
 * DOM where jsdom resolves (a portal dev dependency); skipped otherwise.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('sa-ui back wait on a DOM', () => {
  let dom;
  const keep = {};
  const views = [];
  const keepView = (v) => { views.push(v); return v; };
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });
  const flush = () => new Promise((r) => setTimeout(r, 20));

  function ended(lang) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const said = [];
    const battery = { battery_id: 'b', tasks: [{ id: 't', mode: 'tap', items: [{ id: 'i', target: 'a', options: ['a', 'b'] }] }] };
    const runner = core.createRunner({ battery, onEvent: () => {} });
    const el = document.getElementById('m');
    const view = keepView(ui.mount(el, { runner, battery, lang, mode: 'game', back: '/map', speak: (t) => { said.push(t); return Promise.resolve(); } }));
    runner.start(); runner.instructionDone(); runner.begin(); runner.answer('a'); runner.next();
    return { el, view, said, runner };
  }

  test('EN: the end screen gains the line, spoken once however often it is called', async () => {
    const { el, view, said, runner } = ended('en');
    await flush();
    expect(runner.view().phase).toBe('battery_end');
    expect(el.textContent).not.toContain('saved on this phone');
    const before = said.length;
    view.backWait();
    view.backWait();
    await flush();
    expect(el.querySelector('.sae-backwait').textContent).toBe('Your island is saved on this phone. It will go when the internet is back.');
    const line = said.slice(before).filter((t) => t && t.en && /saved on this phone/.test(t.en));
    expect(line).toHaveLength(1);
    expect(line[0].ur).toBe('آپ کا جزیرہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا جائے گا۔');
  });

  test('UR: the line in Urdu', async () => {
    const { el, view } = ended('ur');
    await flush();
    view.backWait();
    await flush();
    expect(el.querySelector('.sae-backwait').textContent).toBe('آپ کا جزیرہ اس فون پر محفوظ ہے۔ انٹرنیٹ آتے ہی چلا جائے گا۔');
  });
});
