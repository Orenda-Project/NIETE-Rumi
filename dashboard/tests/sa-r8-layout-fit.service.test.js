'use strict';
/**
 * Round 8, on a real 360x640 phone (sandbox E2E): the story box and the letter card must fit the screen.
 *   r8_story_snap (item 15): a part is never taller than the story box: whole rows that fit, at least one; when one row
 *     and the part's ink room above it are taller than the box, the room above gives way so the part fits.
 *   r8_layout (items 6/21): a one-at-a-time card (a letter, a number) is a screen that fits the phone: the screen is
 *     the phone's height and the card takes what is left above the foot (sa.css), never running under Next.
 *   Both: the chrome around them is smaller on a phone (a compact chip; the arrow beside the star; the QA jump row
 *     under the coach's corner, not below it).
 * OFF: as before.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const STORY = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'ur.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'ur', time_limit_s: 60,
  passage: { text: 'ا ب ج د' }, items: ['ا', 'ب', 'ج', 'د'].map((w, i) => ({ id: 'w' + (i + 1), target: w, line: i + 1 })) }] });
const CARDS = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'ur.letter_names5', subtask: 'letter_name_identification', response: 'record', lang: 'ur', present: 'one_at_a_time', time_limit_s: 60,
  items: ['د', 'ج'].map((x, i) => ({ id: 'L' + (i + 1), target: x, show: x })) }] });
const ROW = 69; // one Urdu row at 28 px, line pitch 2.45
const PAD_TOP = 45; // the part's ink room above its first row (Urdu)
const PAD_BOTTOM = 14;

maybe('r8 fit on a DOM (sa-ui.js)', () => {
  let dom;
  const keep = {};
  const views = [];
  let boxH = 102;
  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><style>.sae-part{padding:${PAD_TOP}px 0 ${PAD_BOTTOM}px}</style><main id="m"></main>`, { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const P = dom.window.HTMLElement.prototype;
    Object.defineProperty(P, 'offsetHeight', { configurable: true, get() { return this.classList.contains('sae-pline') ? ROW : 0; } });
    Object.defineProperty(P, 'clientHeight', { configurable: true, get() { return this.classList.contains('is-snap') ? boxH : 640; } });
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function mount(battery) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const runner = core.createRunner({ battery, now: () => 0, mic: () => 'ok', one_at_a_time: true });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'ur', mode: 'game', speak: () => Promise.resolve() });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    return { el, runner, view };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const partH = (p) => {
    const cs = getComputedStyle(p);
    const top = parseFloat(p.style.paddingTop || cs.paddingTop) || 0;
    const bottom = parseFloat(p.style.paddingBottom || cs.paddingBottom) || 0;
    return top + p.querySelectorAll('.sae-pline').length * ROW + bottom;
  };

  test('story, a 102 px box (the sandbox phone): every part fits the box, one row each, nothing lost', async () => {
    boxH = 102;
    const x = mount(STORY({ r8_story_snap: true }));
    await flush();
    const parts = [...x.el.querySelectorAll('.sae-passage.is-snap > .sae-part')];
    expect(parts).toHaveLength(4);
    parts.forEach((p) => expect(partH(p)).toBeLessThanOrEqual(boxH));
    expect([...x.el.querySelectorAll('.sae-word')].map((w) => w.textContent)).toEqual(['ا', 'ب', 'ج', 'د']);
  });

  test('story, a 200 px box: two whole rows a part, the ink room kept', async () => {
    boxH = 200;
    const x = mount(STORY({ r8_story_snap: true }));
    await flush();
    const parts = [...x.el.querySelectorAll('.sae-passage.is-snap > .sae-part')];
    expect(parts.map((p) => p.querySelectorAll('.sae-pline').length)).toEqual([2, 2]);
    parts.forEach((p) => { expect(p.style.paddingTop).toBe(''); expect(partH(p)).toBeLessThanOrEqual(boxH); });
  });

  test('card, ON: the card screen is marked to fit the phone (sae-fit); OFF it is not', () => {
    const on = mount(CARDS({ r8_layout: true }));
    expect(on.el.querySelector('.sae-screen').classList.contains('sae-fit')).toBe(true);
    views.splice(0).forEach((v) => v.destroy());
    document.getElementById('m').replaceWith(Object.assign(document.createElement('main'), { id: 'm' }));
    const off = mount(CARDS(undefined));
    expect(off.el.querySelector('.sae-screen').classList.contains('sae-fit')).toBe(false);
    expect(off.el.querySelector('.sae-fit')).toBeNull();
  });

  test('story, ON: the arrow and the star share one row (sae-snapfoot); OFF the foot is as before', async () => {
    const on = mount(STORY({ r8_story_snap: true }));
    expect(on.el.querySelector('.sae-foot .sae-snapfoot .sae-more')).not.toBeNull();
    expect(on.el.querySelector('.sae-foot .sae-snapfoot .sae-star')).not.toBeNull();
    views.splice(0).forEach((v) => v.destroy());
    document.getElementById('m').replaceWith(Object.assign(document.createElement('main'), { id: 'm' }));
    const off = mount(STORY({ story_scroll: true }));
    expect(off.el.querySelector('.sae-snapfoot')).toBeNull();
    expect(off.el.querySelector('.sae-foot > .sae-more')).not.toBeNull();
  });
});

describe('r8 fit in sa.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const at = css.indexOf('/* Round 8 fit (');
  const block = at < 0 ? '' : css.slice(at, css.indexOf('/* end round 8 fit */', at));
  test('the card screen is the phone\'s height and the card fills what is left; the snap foot is one row; the QA row sits under the corner', () => {
    expect(block).toMatch(/\.sae-fit[^{]*\{[^}]*height:\s*100dvh/);
    expect(block).toMatch(/\.sae-fit[^{]*\.sae-onecell[^{]*\{[^}]*flex:\s*1 1 0/);
    expect(block).toMatch(/\.sae-snapfoot[^{]*\{[^}]*flex-direction:\s*row/);
    expect(block).toMatch(/\.sae-devjump-row[^{]*\{[^}]*margin-top:\s*0/);
  });
  test('every rule is under .is-r8-layout or .is-r8-snap', () => {
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    const sel = [];
    for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => sel.push(s));
    expect(sel.length).toBeGreaterThan(4);
    sel.forEach((s) => expect(s).toMatch(/\.is-r8-(layout|snap)/));
  });
});
