'use strict';
/**
 * Round 8 (r8_layout / r8_lang_switch): the coach-led end card on a 360x640 phone. The coach page lays its own bottom bar
 * ("Next child (coach)", ~70 px) over the frame, so the hand-back line must end above a reserved bottom band. With
 * either switch on, the card carries .is-r8-endfit (sa.css "Round 8 end card": the band, normal weight, the Urdu line
 * at a size that fits two lines, Jugnu smaller on short screens). OFF: today's card, class for class.
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

maybe('round 8: the coach-led end card keeps the hand-back above the coach bar (sa-ui)', () => {
  let dom; const keep = {}; const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/run.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => { try { v.destroy(); } catch (_) { /* gone */ } }); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  const B = (ui, l) => Object.assign({ battery_id: 'end-' + l, tasks: [{ id: 'ma.discrimination', subtask: 'quantity_discrimination', response: 'tap', lang: null,
    title: { en: 'Which is bigger', ur: 'کون سا بڑا ہے' }, script: {}, items: [{ id: 'q1', target: 2, options: [1, 2] }] }] }, ui ? { ui } : {});
  /** The end card, the form `form`, switched with the toggle to `to` on the way (when the language switch is on). */
  function endCard(ui, form, to) {
    const c = require('../sa/sa-core');
    const sui = require('../sa/sa-ui');
    const battery = B(ui, form);
    const runner = c.createRunner({ battery, now: () => 0, mic: () => 'ok' });
    const el = document.getElementById('m');
    const view = sui.mount(el, { runner, battery, lang: form, mode: 'proctored', ur_fit: true, speak: () => Promise.resolve() });
    views.push(view);
    const other = form === 'ur' ? 'en' : 'ur';
    if (view.langBattery) view.langBattery(other, c.normalize(B(ui, other)));
    runner.start();
    const hb = el.querySelector('.sae-handover .sae-btn'); if (hb) hb.click();
    view.render();
    if (to !== form) { const t = el.querySelector('.sae-r8-lang'); if (t) t.click(); }
    runner.instructionDone(); view.render(); runner.begin(); view.render();
    runner.answer(2); view.render();
    for (let i = 0; i < 4 && runner.view().phase !== 'battery_end'; i += 1) { runner.next(); view.render(); }
    expect(runner.view().phase).toBe('battery_end');
    return el;
  }

  for (const [form, to] of [['en', 'ur'], ['ur', 'en'], ['ur', 'ur']]) {
    test(`ON (layout + language switch), ${form} form -> ${to}: the end card is fitted, the line in ${to}`, () => {
      const el = endCard({ r8_layout: true, r8_lang_switch: true }, form, to);
      expect(el.getAttribute('lang')).toBe(to);
      const card = el.querySelector('.sae-screen.sae-end.is-proctored');
      expect(card.classList.contains('is-r8-endfit')).toBe(true);
      expect(card.querySelector('.sae-body > .sae-handback')).not.toBeNull();
    });
  }
  test('either switch alone fits it', () => {
    expect(endCard({ r8_layout: true }, 'ur', 'ur').querySelector('.sae-end.is-r8-endfit')).not.toBeNull();
    views.splice(0).forEach((v) => v.destroy());
    expect(endCard({ r8_lang_switch: true }, 'en', 'ur').querySelector('.sae-end.is-r8-endfit')).not.toBeNull();
  });
  test('OFF: today\'s card', () => {
    const el = endCard(null, 'ur', 'ur');
    expect(el.querySelector('.sae-screen.sae-end').className).toBe('sae-screen sae-end is-proctored');
  });
});
