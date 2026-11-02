'use strict';
/**
 * Round 9 item 7 (battery.ui.r9_scroll_cue; app_settings sa_r9_scroll_cue): "Always put instructions for scroll when it
 * doesn't fit on one page." ON: a screen whose content runs past the bottom of what scrolls (its body, else the page)
 * shows a scroll cue (an arrow and "Scroll down") at the top of its foot, above Next, while more is below; it goes once
 * the bottom is in view, and is checked again on every draw, scroll, resize, late image and size change. A screen that
 * fits never shows it; the story keeps its own arrow (.sae-more) and gets no second one. When the battery has
 * lines.r9_scroll_cue, Jugnu says it once per screen type, after the screen's own words, never in a coach-led run and
 * never while a recording can be open.
 * OFF: the page as before (no cue, no class, no listener at work).
 */
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* not installed here */ }
const maybe = JSDOM ? describe : describe.skip;

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const SAY_WAIT = 700; // longer than the cue line's wait after the screen's own words

const LINE = { en: 'If you cannot see it all, slide the screen up.', ur: 'اگر سب نظر نہ آئے تو اسکرین کو اوپر سرکائیں۔' };
const TAP = (id) => ({ id, mode: 'tap', lang: 'en', title: 'Letters', instruction: { text: 'Tap the letter you hear.' }, script: {},
  items: [{ id: id + '.01', target: 'b', options: ['b', 'p'] }, { id: id + '.02', target: 'p', options: ['b', 'p'] }] });
const ORAL = { id: 'en.c', mode: 'oral', lang: 'en', title: 'Questions', instruction: { text: 'Answer out loud.' }, script: {},
  items: [{ id: 'q1', say: 'Who?' }, { id: 'q2', say: 'Where?' }] };
const STORY = { id: 'en.story', subtask: 'oral_reading_fluency', mode: 'record', lang: 'en', time_limit_s: 60, title: 'Story',
  instruction: { text: 'Read the story.' }, passage: { text: 'a b c' }, items: 'abc'.split('').map((w, i) => ({ id: 'w' + i, target: w, line: 1 })) };

maybe('round 9 item 7: the scroll cue (r9_scroll_cue)', () => {
  let dom; let views = []; const keep = {};
  // Layout stand-ins: jsdom lays nothing out. L.page is the document's scroller; L.body each screen's body.
  let L;
  const tops = new WeakMap();
  beforeEach(() => {
    views = [];
    L = { page: { sh: 640, ch: 640 }, body: { sh: 0, ch: 0 } };
    dom = new JSDOM('<!doctype html><main id="m"></main>', { url: 'https://portal.test/sa/play.html', pretendToBeVisual: true });
    for (const k of ['window', 'document', 'location', 'navigator', 'HTMLElement', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      keep[k] = global[k];
      global[k] = k === 'window' ? dom.window : dom.window[k];
    }
    const P = dom.window.HTMLElement.prototype;
    const box = (n) => (n === dom.window.document.documentElement ? L.page : n.classList && n.classList.contains('sae-body') ? L.body : null);
    Object.defineProperty(P, 'scrollHeight', { configurable: true, get() { const b = box(this); return b ? b.sh : 0; } });
    Object.defineProperty(P, 'clientHeight', { configurable: true, get() { const b = box(this); return b ? b.ch : 0; } });
    Object.defineProperty(P, 'scrollTop', { configurable: true, get() { return tops.get(this) || 0; }, set(v) { tops.set(this, v); } });
    jest.resetModules();
  });
  afterEach(() => { views.forEach((v) => v.destroy()); for (const k of Object.keys(keep)) global[k] = keep[k]; dom.window.close(); });

  /** Mount the page on `tasks`; `on` puts the switch on; `line` gives the battery the spoken line. */
  function mount(tasks, { on = true, line = false, lang = 'en', speak, extra = {}, ui = {} } = {}) {
    const core = require('../sa/sa-core');
    const sa = require('../sa/sa-ui');
    const battery = { battery_id: 'b', lines: line ? { r9_scroll_cue: LINE } : {}, tasks };
    battery.ui = Object.assign(on ? { r9_scroll_cue: true } : {}, ui);
    if (!Object.keys(battery.ui).length) delete battery.ui;
    const runner = core.createRunner({ battery, onEvent: () => {}, mic: () => 'ok' });
    const said = [];
    const sp = speak || ((t) => { said.push(t); return Promise.resolve(); });
    runner.start();
    const el = document.getElementById('m');
    const view = sa.mount(el, Object.assign({ runner, battery, lang, mode: 'game', speak: (t, a) => { said.push(t); return sp(t, a); } }, extra));
    views.push(view);
    return { el, runner, view, said, cue: () => el.querySelector('.sae-r9-scroll') };
  }
  const scrollPage = (top) => { document.documentElement.scrollTop = top; window.dispatchEvent(new window.Event('scroll')); };
  const shown = (c) => !!c && !c.hidden;
  const cueSaid = (said) => said.filter((t) => t === LINE).length;

  test('OFF: an overflowing screen as today: no cue, no class; scroll and resize change nothing', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')], { on: false, line: true });
    await flush();
    expect(x.cue()).toBeNull();
    expect(x.el.classList.contains('is-r9-scroll')).toBe(false);
    scrollPage(10); window.dispatchEvent(new window.Event('resize')); await flush(SAY_WAIT);
    expect(x.cue()).toBeNull();
    expect(cueSaid(x.said)).toBe(0);
  });

  test('OFF: the DOM is the same as with the switch absent from ui', async () => {
    L.page = { sh: 1400, ch: 640 };
    const a = mount([TAP('en.a')], { on: false, ui: { r9_scroll_cue: false } });
    await flush();
    const html = a.el.innerHTML;
    const cls = a.el.className;
    views.splice(0).forEach((v) => v.destroy());
    const b = mount([TAP('en.a')], { on: false });
    await flush();
    expect(b.el.innerHTML).toBe(html);
    expect(b.el.className).toBe(cls);
  });

  test('ON, overflowing page: a visible cue (arrow + "Scroll down") at the top of the foot, above Next', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush();
    expect(x.el.classList.contains('is-r9-scroll')).toBe(true);
    const c = x.cue();
    expect(shown(c)).toBe(true);
    expect(c.textContent).toContain('↓');
    expect(c.textContent).toContain('Scroll down');
    const foot = x.el.querySelector('.sae-foot');
    expect(c.parentNode).toBe(foot);
    expect(foot.firstChild).toBe(c);
    expect(foot.querySelector('.sae-primary')).not.toBeNull(); // Next still there, below it
  });

  test('ON, a screen that fits: no cue', async () => {
    L.page = { sh: 640, ch: 640 };
    const x = mount([TAP('en.a')], { line: true });
    await flush(SAY_WAIT);
    expect(shown(x.cue())).toBe(false);
    expect(cueSaid(x.said)).toBe(0);
  });

  test('ON: scrolled to the bottom the cue goes; scrolled back up it returns', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush();
    expect(shown(x.cue())).toBe(true);
    scrollPage(760); await flush();
    expect(shown(x.cue())).toBe(false);
    scrollPage(100); await flush();
    expect(shown(x.cue())).toBe(true);
  });

  test('ON: a screen that grows after it is drawn (a late picture, a resize) gets the cue then', async () => {
    L.page = { sh: 640, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush();
    expect(shown(x.cue())).toBe(false);
    L.page = { sh: 1200, ch: 640 };
    const img = document.createElement('img');
    x.el.querySelector('.sae-body').appendChild(img);
    img.dispatchEvent(new window.Event('load')); await flush(150);
    expect(shown(x.cue())).toBe(true);
    L.page = { sh: 640, ch: 640 };
    window.dispatchEvent(new window.Event('resize')); await flush(150);
    expect(shown(x.cue())).toBe(false);
  });

  test('ON: a ResizeObserver, where there is one, re-checks the screen when its size changes', async () => {
    const seen = [];
    window.ResizeObserver = class { constructor(cb) { this.cb = cb; seen.push(this); } observe() {} disconnect() { this.off = true; } };
    L.page = { sh: 640, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush();
    expect(seen.length).toBeGreaterThan(0);
    L.page = { sh: 1200, ch: 640 };
    seen.filter((o) => !o.off).forEach((o) => o.cb([]));
    await flush(150);
    expect(shown(x.cue())).toBe(true);
  });

  test('ON: a body that scrolls itself (its overflow) is the one measured, not the page', async () => {
    const st = document.createElement('style');
    st.textContent = '.sae-body{overflow-y:auto}';
    document.head.appendChild(st);
    L.page = { sh: 640, ch: 640 };
    L.body = { sh: 900, ch: 400 };
    const x = mount([TAP('en.a')]);
    await flush();
    expect(shown(x.cue())).toBe(true);
    const body = x.el.querySelector('.sae-body');
    body.scrollTop = 500; body.dispatchEvent(new window.Event('scroll')); await flush();
    expect(shown(x.cue())).toBe(false);
  });

  test('ON, Urdu: the words in Urdu (no Latin letters)', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')], { lang: 'ur' });
    await flush();
    const w = x.cue().querySelector('.sae-r9-scroll-w').textContent;
    expect(w.length).toBeGreaterThan(3);
    expect(w).not.toMatch(/[A-Za-z]/);
  });

  test('ON, the story with its own arrow: no second cue', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([STORY], { ui: { story_scroll: true }, line: true });
    x.runner.instructionDone(); x.runner.begin(); x.view.render();
    await flush(SAY_WAIT);
    expect(x.el.querySelector('.sae-more')).not.toBeNull();
    expect(shown(x.cue())).toBe(false);
    expect(cueSaid(x.said)).toBe(0);
  });

  test('ON + line: said once after the screen\'s own words, never over them; once per screen type', async () => {
    L.page = { sh: 1400, ch: 640 };
    let release = null;
    const speak = (t) => (t === LINE ? Promise.resolve() : new Promise((r) => { release = r; }));
    const x = mount([TAP('en.a'), TAP('en.b')], { line: true, speak });
    await flush(SAY_WAIT);
    expect(shown(x.cue())).toBe(true);
    expect(x.said.length).toBeGreaterThan(0);
    expect(cueSaid(x.said)).toBe(0); // the instruction is still being said
    release(); await flush(SAY_WAIT);
    expect(cueSaid(x.said)).toBe(1);
    expect(x.said[x.said.length - 1]).toBe(LINE);
    // the next task's instruction screen: the same type, not said again
    x.runner.instructionDone(); if (x.runner.view().phase !== 'running') x.runner.begin();
    for (let i = 0; i < 5 && x.runner.view().phase === 'running'; i++) x.runner.skip();
    x.runner.next();
    expect(x.runner.view().phase).toBe('instruction');
    expect(x.runner.view().task_index).toBe(1);
    x.view.render(); await flush(SAY_WAIT);
    release(); await flush(SAY_WAIT);
    expect(shown(x.cue())).toBe(true);
    expect(cueSaid(x.said)).toBe(1);
  });

  test('ON + line, a screen that fits: nothing said', async () => {
    L.page = { sh: 640, ch: 640 };
    const x = mount([TAP('en.a')], { line: true });
    await flush(SAY_WAIT);
    expect(cueSaid(x.said)).toBe(0);
  });

  test('ON, no line in the battery: the cue is shown, nothing said', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush(SAY_WAIT);
    expect(shown(x.cue())).toBe(true);
    expect(x.said.some((t) => t && (t.en === LINE.en || t === LINE))).toBe(false);
    expect(x.said.some((t) => t && /scroll/i.test(JSON.stringify(t)))).toBe(false);
  });

  test('ON + line, a spoken question being answered (a recording can be open): the cue shows, never said', async () => {
    L.page = { sh: 1400, ch: 640 };
    const rec = [];
    const x = mount([ORAL], { line: true, extra: { onRecordStart: (t) => rec.push('start'), onRecordStop: () => rec.push('stop') } });
    x.runner.instructionDone(); if (x.runner.view().phase !== 'running') x.runner.begin();
    x.view.render();
    await flush(SAY_WAIT);
    expect(x.runner.view().phase).toBe('running');
    expect(rec).toContain('start');
    expect(shown(x.cue())).toBe(true);
    expect(cueSaid(x.said)).toBe(0);
  });

  test('ON + line, coach-led (manual): the coach brief that runs long shows the cue; Jugnu says nothing of it', async () => {
    L.page = { sh: 2400, ch: 640 };
    const x = mount([TAP('en.a')], { line: true, extra: { manual: true }, ui: {} });
    await flush(SAY_WAIT);
    expect(x.el.querySelector('.sae-coach-brief')).not.toBeNull();
    const c = x.cue();
    expect(shown(c)).toBe(true);
    expect(c.parentNode.classList.contains('sae-foot')).toBe(true);
    expect(cueSaid(x.said)).toBe(0);
  });

  test('ON: destroy stops the checks (a later scroll touches nothing)', async () => {
    L.page = { sh: 1400, ch: 640 };
    const x = mount([TAP('en.a')]);
    await flush();
    const c = x.cue();
    x.view.destroy(); views = [];
    scrollPage(760); await flush();
    expect(c.hidden).toBe(false);
  });
});

describe('r9_scroll_cue in sa.css', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'sa', 'sa.css'), 'utf8');
  const at = css.indexOf('/* Round 9 item 7');
  const block = at < 0 ? '' : css.slice(at, css.indexOf('/* end round 9 item 7 */', at));
  test('a block of its own, every rule under .is-r9-scroll, the cue never takes a tap', () => {
    expect(block.length).toBeGreaterThan(0);
    const flat = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').replace(/@keyframes[^{]*\{[^{}]*(\{[^}]*\}[^{}]*)*\}/g, '');
    const sels = flat.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    expect(sels.length).toBeGreaterThan(0);
    sels.forEach((s) => s.split(',').forEach((one) => expect(one.trim()).toMatch(/^\.sae\.is-r9-scroll\b/)));
    expect(block).toMatch(/\.sae-r9-scroll\{[^}]*pointer-events:\s*none/);
    expect(block).toMatch(/\.sae-r9-scroll\[hidden\]\{[^}]*display:\s*none/);
  });
});
