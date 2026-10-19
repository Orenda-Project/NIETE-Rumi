/**
 * The child welcome over a Home that scrolls (design-qa WF-1, WF-2; sandbox 8205a0fea): a small layout model of the
 * real Home (the header, the Next stop card with the look's tag and its Let's go, the trail of lands, the fixed bottom
 * tab bar), where every rect follows the page's scroll and the card's pushed margin, so the welcome's own scrolling is
 * measured, not assumed.
 *   WF-2: steps 1–3 hold the Home at scroll 0 (even when the child had scrolled before it mounted), and every land step 3
 *         lights is inside the viewport, above the tab bar.
 *   WF-1: step 4 scrolls only until Let's go's bottom is ≤ the tab bar's top − 8, then the hand points inside Let's go;
 *         nothing drifts afterwards (the nudge, the late re-checks of Skip's row).
 * EN 390×844, UR 360×740 and 360×640; a quiz and a video Next stop; a busy Home (more above the card). Invented children.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-welcome.js'), 'utf8');
const KID = '0123456789abcdef';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';

// The Home as the shots measured it (CSS px, page coordinates at scroll 0): header 0–64; the card under the look's
// tag (28 px above it); Let's go 30 px above the card's bottom, 56 tall; the trail 20 px under the card, 104 tall;
// the grown-ups pill and the page's end; the tab bar fixed at the bottom, 86 tall.
function home({ vw, vh, cardTop, cardH, above = 0, scrolled = 0 }) {
  const S = { y: 0, overflow: '' };
  const els = [];
  const el = (name, pageRect, fixed) => {
    const e = {
      name, attrs: {}, cls: new Set(), style: {}, listeners: {}, children: [], _h: '', fixed,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, removeEventListener() {},
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
      querySelector: () => null, querySelectorAll: () => [],
      get innerHTML() { return this._h; }, set innerHTML(h) { this._h = h; },
      getBoundingClientRect() {
        const r = pageRect();
        const top = fixed ? r.top : r.top - S.y;
        return { top, bottom: top + r.h, left: r.left, right: r.left + r.w, width: r.w, height: r.h };
      },
    };
    e.classList = { add: (c) => e.cls.add(c), remove: (c) => e.cls.delete(c), contains: (c) => e.cls.has(c) };
    els.push(e);
    return e;
  };
  const push = () => parseFloat(next.style.marginTop || '0') || 0;
  const top0 = cardTop + above;
  const head = el('head', () => ({ top: 0, h: 64, left: 0, w: vw }));
  const next = el('next', () => ({ top: top0 + push(), h: cardH, left: 16, w: vw - 32 }));
  const tag = el('tag', () => ({ top: top0 + push() - 28, h: 28, left: vw - 180, w: 140 }));
  const ngo = el('ngo', () => ({ top: top0 + push() + cardH - 86, h: 56, left: 36, w: vw - 72 }));
  const lands = [0, 1, 2].map((i) => el('land' + i, () => ({ top: top0 + push() + cardH + 20, h: 104, left: 24 + i * ((vw - 48) / 3), w: (vw - 48) / 3 - 8 })));
  const bar = el('bar', () => ({ top: vh - 86, h: 86, left: 0, w: vw }), true);
  const docH = () => top0 + push() + cardH + 20 + 104 + 160 + 86;
  next.attrs.href = '/q/MATH01?k=kk';
  next.querySelector = (sel) => (sel === '.wqa-bub' ? tag : sel === '.wq-ngo' ? ngo : null);
  const root = el('root', () => ({ top: 0, h: 2000, left: 0, w: vw }));
  root.querySelector = (sel) => (sel === '.wq-next' ? next : sel === '.wq-hhead' ? head : sel === '.wq-doors' ? bar : null);
  root.querySelectorAll = (sel) => (/wqa-stop/.test(sel) ? lands : []);
  const body = el('body', () => ({ top: 0, h: 0, left: 0, w: vw }), true);
  const timers = [];
  let clock = 0;
  const scrollTo = (y) => { S.y = Math.max(0, Math.min(Math.round(y), Math.max(0, docH() - vh))); };
  S.y = 0;
  scrollTo(scrolled);
  const ctx = {
    document: {
      body, documentElement: { lang: 'en', style: S_style(S), classList: { contains: () => false } },
      createElement: () => el('new', () => ({ top: 0, h: 0, left: 0, w: 0 }), true),
      querySelector: () => null, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true }),
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + (ms || 0) }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    getComputedStyle: (e) => ({ marginTop: e.style.marginTop || '0px', position: e.fixed ? 'fixed' : 'static' }),
    scrollBy: (x, y) => scrollTo(S.y + (typeof x === 'object' ? x.top : y)), scrollTo: (x, y) => scrollTo(typeof x === 'object' ? x.top : y),
    get scrollY() { return S.y; }, get pageYOffset() { return S.y; },
    innerWidth: vw, innerHeight: vh,
    Date: { now: () => clock }, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, RegExp, Error,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const run = (ms) => {
    const end = clock + ms;
    for (;;) { const d = timers.filter((t) => t.fn && t.at <= end).sort((a, b) => a.at - b.at)[0]; if (!d) break; clock = Math.max(clock, d.at); const f = d.fn; d.fn = null; f(); }
    clock = end;
  };
  const overlay = () => body.children.find((c) => c.attrs.class === 'wqw') || null;
  const tap = (what) => overlay().listeners.click.forEach((fn) => fn({ target: { getAttribute: (k) => (k === 'data-ww' ? what : null) } }));
  const B = { kid: KID, welcome: { v: 1, attempt: 1 } };
  const start = (lang) => ctx.WQW.start(root, B, { token: TOKEN, lang, ev() {} }, { muted: () => true });
  const handAt = () => { const m = /class="wqw-hand[^"]*" style="top:(-?\d+)px;left:(-?\d+)px/.exec(overlay()._h); return m ? { y: +m[1], x: +m[2] } : null; };
  const litInView = () => lands.filter((l) => l.cls.has('wqw-lit')).map((l) => { const r = l.getBoundingClientRect(); return r.top >= 0 && r.bottom <= bar.getBoundingClientRect().top - 8; });
  return { S, ctx, run, start, tap, overlay, handAt, litInView, next, ngo, bar, lands, head };
}
function S_style(S) { return { get overflow() { return S.overflow; }, set overflow(v) { S.overflow = v; } }; }

// the card as the shots measured it: a quiz Next stop (taller: tag, title, topic, minutes) and a video one
const CARD = { quiz: 300, video: 260 };
const VIEWS = [
  ['en', 390, 844, 108], ['ur', 360, 740, 92], ['en', 360, 640, 108], ['ur', 360, 640, 92],
];
const cases = [];
for (const [lang, vw, vh, cardTop] of VIEWS) for (const kind of ['quiz', 'video']) for (const busy of [0, 120]) for (const scrolled of [0, 260]) cases.push([lang, vw, vh, kind, busy, scrolled, cardTop]);

describe('WF-2: the Home starts from its top (only as far down as the card needs); the lands step 3 lights are on screen', () => {
  test.each(cases)('%s %ix%i, %s Next stop, %i px more above it, scrolled %i px before', (lang, vw, vh, kind, above, scrolled, cardTop) => {
    const h = home({ vw, vh, cardTop, cardH: CARD[kind], above, scrolled });
    expect(h.start(lang)).toBe(true);
    // a child's own scroll is undone: from the top, and down only as far as the card (and the trail's start) need
    const fits = cardTop + above + CARD[kind] + 40 + 20 <= vh - 86 - 8;
    if (fits) expect(h.S.y).toBe(0);
    else expect(h.S.y).toBeLessThanOrEqual(cardTop + above + CARD[kind] + 60 - (vh - 86 - 8) + 1);
    h.tap('jugnu');
    h.run(3000);
    for (let i = 0; i < 3; i += 1) {
      h.run(i ? 1000 : 1);
      const seen = h.litInView();
      expect([i, seen]).toEqual([i, [true]]);
    }
  });
});

describe('WF-1: step 4 scrolls only until Let\'s go clears the tab bar by 8 px, and the hand points inside Let\'s go', () => {
  test.each(cases)('%s %ix%i, %s Next stop, %i px more above it, scrolled %i px before', (lang, vw, vh, kind, above, scrolled, cardTop) => {
    const h = home({ vw, vh, cardTop, cardH: CARD[kind], above, scrolled });
    h.start(lang);
    h.tap('jugnu');
    for (const wait of [7000, 8000, 3000]) { // step 4, the nudge, the late re-checks
      h.run(wait);
      const g = h.ngo.getBoundingClientRect();
      const barTop = h.bar.getBoundingClientRect().top;
      expect([wait, Math.round(g.bottom) <= barTop - 8]).toEqual([wait, true]);
      expect(g.top).toBeGreaterThanOrEqual(0);
      const p = h.handAt();
      expect([wait, p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom]).toEqual([wait, true]);
    }
  });
  test('a Home that already fits: step 4 does not scroll at all', () => {
    const h = home({ vw: 390, vh: 844, cardTop: 108, cardH: 300 });
    h.start('en');
    h.tap('jugnu');
    h.run(7000);
    expect(h.S.y).toBe(0);
  });
  test('the end gives the page back: its scrolling as it was before the welcome', () => {
    const h = home({ vw: 360, vh: 640, cardTop: 92, cardH: 300, above: 120 });
    h.start('ur');
    expect(h.S.overflow).toBe('hidden');
    h.tap('skip');
    expect(h.S.overflow).toBe('');
  });
});

describe('WF-2 remainder (the live walk, UR 360×740): steps 1–2 show the Next stop card and the start of the trail; the step-4 ring stays above the tab bar', () => {
  // a Home with a lot above the card (the first open after a join, a friend's line, the install card...): at scroll 0
  // the card starts below the fold
  const tall = [['ur', 360, 740, 92, 300], ['ur', 360, 740, 92, 380], ['en', 390, 844, 108, 420], ['ur', 360, 640, 92, 220], ['en', 360, 640, 108, 260]];
  test.each(tall)('%s %ix%i, card at %i + %i px', (lang, vw, vh, cardTop, above) => {
    for (const kind of ['quiz', 'video']) {
      const h = home({ vw, vh, cardTop, cardH: CARD[kind], above });
      h.start(lang);
      const barTop = h.bar.getBoundingClientRect().top;
      const skipBottom = h.head.getBoundingClientRect().bottom + 8 + 48;
      for (const at of ['step1', 'step2']) {
        if (at === 'step2') { h.tap('jugnu'); h.run(100); } else h.run(2600);
        const c = h.next.getBoundingClientRect();
        const t = h.lands[0].getBoundingClientRect();
        expect([kind, at, 'card on screen', Math.round(c.top) >= 0 && Math.round(c.bottom) <= barTop - 8]).toEqual([kind, at, 'card on screen', true]);
        expect([kind, at, 'trail starts on screen', t.top < barTop - 8]).toEqual([kind, at, 'trail starts on screen', true]);
        expect([kind, at, 'the card not under Skip', Math.round(c.top - 28) >= Math.round(skipBottom) + 8 - 1]).toEqual([kind, at, 'the card not under Skip', true]);
      }
      h.run(7000);
      const m = /class="wqw-dim wqw-hole" style="top:(-?\d+)px;left:\d+px;width:\d+px;height:(\d+)px"/.exec(h.overlay()._h);
      expect(m).toBeTruthy();
      expect([kind, 'ring above the bar', +m[1] + +m[2] <= barTop]).toEqual([kind, 'ring above the bar', true]);
    }
  });
});
