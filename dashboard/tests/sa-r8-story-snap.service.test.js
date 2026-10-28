'use strict';
/**
 * Round 8, item 15 (battery.ui.r8_story_snap; app_settings sa_r8_story_snap): the story scrolls one part at a time.
 * ON: the story is its own scroll box (.is-snap, CSS scroll-snap-type y mandatory) made of parts (.sae-part, one
 * screenful of the passage's lines each, snap-stop always so a fling cannot skip one); the down arrow moves exactly one
 * part on (scrollTo the next part's top) and goes at the last part. The recording and the clock are untouched.
 * OFF: no parts, no snap box, the arrow (sa_story_scroll) slides the page as before.
 */
const fs = require('fs');
const path = require('path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

// Seven lines of one word each (line 1..7)
const STORY = (ui) => ({ battery_id: 'b', ui, tasks: [{ id: 'en.story_w3', subtask: 'oral_reading_fluency', response: 'record', lang: 'en', time_limit_s: 60,
  passage: { text: 'a b c d e f g' }, items: 'abcdefg'.split('').map((w, i) => ({ id: 'w' + (i + 1), target: w, line: i + 1 })) }] });
const LINE_H = 100;
const BOX_H = 250; // two lines a part: 7 lines → 4 parts

maybe('r8_story_snap on a DOM (sa-ui.js)', () => {
  let dom;
  const keep = {};
  const views = [];
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const P = dom.window.HTMLElement.prototype;
    // Layout stand-ins: a line is 100 px; the story box shows 250 px; a part's top is its place among the parts.
    Object.defineProperty(P, 'offsetHeight', { configurable: true, get() { return this.classList.contains('sae-pline') ? LINE_H : 0; } });
    Object.defineProperty(P, 'clientHeight', { configurable: true, get() { return this.classList.contains('is-snap') ? BOX_H : 640; } });
    Object.defineProperty(P, 'scrollHeight', { configurable: true, get() {
      if (this.classList.contains('is-snap')) return this.querySelectorAll('.sae-part').length * BOX_H;
      return 2000;
    } });
    Object.defineProperty(P, 'offsetTop', { configurable: true, get() {
      if (!this.classList.contains('sae-part')) return 0;
      return [...this.parentNode.children].indexOf(this) * BOX_H;
    } });
    jest.resetModules();
  });
  afterEach(() => { views.splice(0).forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  function mount(battery) {
    const core = require('../sa/sa-core');
    const ui = require('../sa/sa-ui');
    const events = [];
    const rec = [];
    let t = 0;
    const runner = core.createRunner({ battery, now: () => t, mic: () => 'ok', onEvent: (e) => events.push(e) });
    const el = document.getElementById('m');
    const view = ui.mount(el, { runner, battery, lang: 'en', mode: 'game', speak: () => Promise.resolve(),
      onRecordStart: (task) => rec.push(['start', task.id]), onRecordStop: (task) => rec.push(['stop', task.id]) });
    views.push(view);
    runner.start(); runner.instructionDone(); runner.begin();
    view.render();
    return { el, runner, view, events, rec, tick: (ms) => { t += ms; runner.tick(); } };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('OFF (story_scroll on): no parts, no snap box; the arrow slides the page by 70 % as before', async () => {
    const x = mount(STORY({ story_scroll: true }));
    await flush();
    expect(x.el.classList.contains('is-r8-snap')).toBe(false);
    expect(x.el.querySelector('.is-snap, .sae-part, .sae-snap')).toBeNull();
    const se = document.scrollingElement || document.documentElement;
    const calls = [];
    se.scrollBy = (o) => calls.push(o);
    const arrow = x.el.querySelector('.sae-more');
    arrow.hidden = false;
    arrow.click();
    expect(calls).toEqual([{ top: Math.round(640 * 0.7), behavior: 'smooth' }]);
  });

  test('ON: the story is a snap box of parts, one screenful each (7 lines → 4 parts, every line kept in order)', async () => {
    const x = mount(STORY({ r8_story_snap: true }));
    await flush();
    expect(x.el.classList.contains('is-r8-snap')).toBe(true);
    expect(x.el.querySelector('.sae-screen').classList.contains('sae-snap')).toBe(true);
    const box = x.el.querySelector('.sae-passage.is-snap');
    expect(box).not.toBeNull();
    const parts = [...box.querySelectorAll(':scope > .sae-part')];
    expect(parts.map((p) => p.querySelectorAll('.sae-pline').length)).toEqual([2, 2, 2, 1]);
    expect([...box.querySelectorAll('.sae-word')].map((w) => w.textContent)).toEqual('abcdefg'.split(''));
    parts.forEach((p) => expect(p.style.minHeight).toBe(BOX_H + 'px'));
  });

  test('ON: the arrow moves exactly one part each tap (scrollTo the next part\'s top) and goes at the last part', async () => {
    const x = mount(STORY({ r8_story_snap: true }));
    await flush();
    const box = x.el.querySelector('.sae-passage.is-snap');
    const tops = [];
    box.scrollTo = (o) => { tops.push(o.top); box.scrollTop = o.top; box.dispatchEvent(new window.Event('scroll')); };
    const arrow = () => x.el.querySelector('.sae-more');
    await flush();
    expect(arrow()).not.toBeNull(); // the arrow comes with the snap, story_scroll or not
    expect(arrow().hidden).toBe(false);
    arrow().click(); await flush();
    arrow().click(); await flush();
    arrow().click(); await flush();
    expect(tops).toEqual([250, 500, 750]);
    expect(arrow().hidden).toBe(true);
    // a part already half passed (a fling the snap has not settled yet): the arrow goes to the next part, never past it
    box.scrollTop = 260; box.dispatchEvent(new window.Event('scroll')); await flush();
    tops.length = 0;
    arrow().click();
    expect(tops).toEqual([500]);
  });

  test('ON: recording and clock as OFF (the same hooks, the same events), and the star still ends the reading', async () => {
    const run = async (ui) => {
      const x = mount(STORY(ui));
      await flush();
      x.tick(5000); x.view.render(); await flush();
      x.el.querySelector('.sae-star').click();
      await flush();
      return { rec: x.rec, types: x.events.map((e) => e.type), phase: x.runner.view().phase };
    };
    const off = await run({ story_scroll: true });
    views.splice(0).forEach((v) => v.destroy());
    document.getElementById('m').replaceWith(Object.assign(document.createElement('main'), { id: 'm' }));
    const on = await run({ story_scroll: true, r8_story_snap: true });
    expect(on.rec).toEqual(off.rec);
    expect(on.types).toEqual(off.types);
    expect(on.phase).toBe(off.phase);
  });
});

describe('r8_story_snap in sa.css', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const at = css.indexOf('/* Round 8 (sa_r8_story_snap');
  const block = at < 0 ? '' : css.slice(at, css.indexOf('/* end round 8 story snap */', at));
  test('mandatory snap on the story box, snap-stop always on each part, all under .is-r8-snap', () => {
    expect(block).toMatch(/\.is-snap[^{]*\{[^}]*scroll-snap-type:\s*y mandatory/);
    expect(block).toMatch(/\.sae-part[^{]*\{[^}]*scroll-snap-stop:\s*always/);
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const m of flat.matchAll(/([^{}]+)\{[^{}]*\}/g)) m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => expect(s).toMatch(/\.is-r8-snap/));
  });
});
