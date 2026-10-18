/**
 * A tap while offline stays on the page (app_settings web_quiz_offline_guard, carried as the answers' `offline_guard:
 * true`). The shipped wq-home.js and wq-finish-card.js run in a vm with a small page: the home's Next tile and door
 * rows (and every other navigation the home and its doors start through ctx.go, a lesson's link included), and the
 * finish card's Next / Home with the fold's links beside it, on the Jugnu page and the quiz page.
 *
 * On: offline, the tap stays — the offline line and Try again drawn (EN + UR), 0 navigations; the `online` event or
 * Try again opens it exactly once (never twice); a slow line asks the page first (HEAD, 2 s) and a failed HEAD stays; a
 * fast line opens at once, no HEAD. Off (every value but the boolean true, and the field absent): no `online` listener,
 * no HEAD, the plain navigation — asserted with the phone offline on a slow line, where on would have held the tap.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const CARD_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js');
const WQ_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq.js');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const TILE = `/c/${TOKEN}?kid=${KID}&home=1`;
const HOME = {
  lang: 'en', kids: [{ chip: KID, first: 'Sam Testwala', animal: 'owl', grade: '3' }], kid: KID, teacher: null, again: [], recs: [],
  challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false, home_v3: 1,
  doors: { stories: [], games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }], videos: null },
  head: { dots: 1, today: false, jar: null },
  next: { kind: 'story', href: TILE, title: 'Read a story with Jugnu' },
};
// The line check's target: the page's own stylesheet link (static, versioned), never a page address.
const PROBE = '/wq/wq.css?v=abc123';
const HEAD_OPTS = { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' };
const LINE = { en: 'No internet. Try again when you are online.', ur: 'انٹرنیٹ نہیں ہے۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔' };
const AGAIN = { en: 'Try again', ur: 'دوبارہ کوشش کریں' };
// The words a child's screen never shows (the home test's list).
const BANNED = /\b(test|tests|exam|assess\w*|wrong|wcpm|rank|percentile|position|prize|reward|unlock|level|clever|perfect|genius|incredible|egma|comparable|tested|testwala|challenge|trail|today|practice|counted|story time)\b|امتحان|ٹیسٹ|غلط|نتائج|نتیجہ|انعام|ذہین|کامل|پڑاؤ|چیلنج/i;
// Every value the switch can hold but the boolean true, and the field absent (no row, a failed read: the bot sends none).
const OFF_VALUES = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['the number 1', 1], ['an object', { enabled: true }],
  ['absent (no row)', undefined], ['absent (a failed read)', undefined]];

const flush = () => new Promise((r) => setImmediate(r));

// ---- the page: elements that keep their listeners, window listeners counted, fetch and navigation recorded ----
function world({ onLine = true, conn = null, head = 'ok' } = {}) {
  const w = { winL: {}, fetches: [], navs: [], body: [], nav: navigatorOf(onLine, conn) };
  w.win = {
    addEventListener(n, fn) { (w.winL[n] = w.winL[n] || []).push(fn); },
    removeEventListener(n, fn) { w.winL[n] = (w.winL[n] || []).filter((f) => f !== fn); },
    scrollTo() {},
  };
  w.fire = (n) => (w.winL[n] || []).slice().forEach((fn) => fn({}));
  w.online = () => { w.nav.onLine = true; w.fire('online'); };
  w.fetch = (url, opts) => {
    w.fetches.push([url, opts]);
    if (head === 'ok') return Promise.resolve({ ok: true, status: 200 });
    if (head === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise(() => {});
  };
  const mk = (tag) => {
    const l = {};
    const el = {
      tag, l, attrs: {}, className: '', kids: [], innerHTML: '', parentNode: null,
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); },
      appendChild(c) { this.kids.push(c); c.parentNode = this; },
      removeChild(c) { this.kids = this.kids.filter((k) => k !== c); c.parentNode = null; },
    };
    el.querySelector = (sel) => {
      if (sel !== 'button') return null;
      if (!el.btn) { el.btn = mk('button'); }
      return el.btn;
    };
    return el;
  };
  w.mk = mk;
  w.bodyEl = mk('body');
  w.document = {
    docL: [],
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' }
      : /wq\.css/.test(sel) && !w.noCss ? { getAttribute: () => PROBE } : null),
    getElementById: () => null,
    createElement: mk,
    head: { appendChild() {} },
    body: w.bodyEl,
    contains: (a) => !a.gone,
    addEventListener(n, fn, capture) { this.docL.push([n, fn, capture]); },
  };
  w.location = { hash: '', pathname: '/h/x', search: '', assign: (h) => w.navs.push(['assign', h]) };
  w.boxes = () => w.bodyEl.kids;
  w.onlineListeners = () => (w.winL.online || []).length;
  return w;
}
function navigatorOf(onLine, conn) { const n = { onLine }; if (conn) n.connection = conn; return n; }
const SLOW = { effectiveType: '2g' };
const FAST = { effectiveType: '4g' };
const sandbox = (w) => ({ window: w.win, document: w.document, navigator: w.nav, location: w.location, fetch: w.fetch, localStorage: { getItem: () => null, setItem() {} },
  setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, RegExp, Date, encodeURIComponent, Promise, TypeError });

// The home: the markup's [data-tap] elements become live elements (attributes from the markup), so a click runs the
// home's own listener; ctx.go records what the hub's go() would open.
function home(w, B, lang = 'en') {
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), sandbox(w));
  let taps = [];
  const root = {
    _h: '', setAttribute() {},
    get innerHTML() { return this._h; },
    set innerHTML(h) {
      this._h = h;
      taps = [];
      const rx = /<(a|button)\b([^>]*\bdata-tap="[^"]*"[^>]*)>/g;
      let m;
      while ((m = rx.exec(h))) {
        const el = w.mk(m[1]);
        const at = /([a-z-]+)="([^"]*)"/g;
        let a;
        while ((a = at.exec(m[2]))) el.attrs[a[1]] = a[2].replace(/&amp;/g, '&');
        taps.push(el);
      }
    },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-tap]' ? taps : []),
    appendChild(c) { (w.sheets = w.sheets || []).push(c); }, removeChild() {},
  };
  const gos = [];
  const ctx = { token: TOKEN, lang, ev() {}, go: (h, what) => gos.push([h, what]) };
  w.win.WQHOME.mount(root, B, ctx);
  const tap = (name, i = 0) => {
    const el = taps.filter((t) => t.attrs['data-tap'] === name)[i];
    if (!el) throw new Error(`no ${name}`);
    let prevented = false;
    (el.l.click || []).forEach((fn) => fn({ preventDefault() { prevented = true; }, stopPropagation() {} }));
    return { el, prevented };
  };
  return { ctx, gos, tap, taps: () => taps };
}

// The card: its document listener (capture) sees the click first; an anchor's own listeners and its native opening
// follow unless the click was stopped. a.click() runs the same path again (the guard's own re-tap).
function card(w) {
  vm.runInNewContext(fs.readFileSync(CARD_SRC, 'utf8'), sandbox(w));
  const anchor = (id, href) => {
    const a = { id, href, own: 0, gone: false, getAttribute: (k) => (k === 'href' ? href : null) };
    a.closest = (sel) => (sel === 'a[href]' ? a : null);
    a.click = () => {
      let prevented = false; let stopped = false;
      const e = { target: a, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
      w.document.docL.filter((x) => x[0] === 'click').forEach((x) => x[1](e));
      if (stopped) return { prevented };
      a.own += 1; // the page's own listener (next_tap, the fold's pick)
      if (!prevented) w.navs.push(['open', href]);
      return { prevented };
    };
    return a;
  };
  return { WQFC: w.win.WQFC, anchor };
}

const visibleBox = (w) => w.boxes().map((b) => b.innerHTML.replace(/<[^>]*>/g, ' ')).join(' ');

describe('the line check never asks a page', () => {
  test('home, slow line, no stylesheet link on the page: the static manifest, still not the page', async () => {
    const w = world({ onLine: true, conn: SLOW });
    w.noCss = true;
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    expect(w.fetches.map(([u]) => u)).toEqual(['/wq/manifest.webmanifest']);
    await flush();
    expect(h.gos).toEqual([[TILE, 'next']]);
  });
  test('card, slow line, no stylesheet link: the static manifest', () => {
    const w = world({ onLine: true, conn: SLOW });
    w.noCss = true;
    const c = card(w);
    c.WQFC.og('en');
    c.anchor('wqfc-next', TILE).click();
    expect(w.fetches.map(([u]) => u)).toEqual(['/wq/manifest.webmanifest']);
  });
  test('the static files it asks exist under dashboard/public/wq', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'public', 'wq', 'wq.css'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'public', 'wq', 'manifest.webmanifest'))).toBe(true);
  });
  test('home: every request on a slow line is a HEAD of a /wq/ file (the page address is only navigated to)', async () => {
    const w = world({ onLine: true, conn: SLOW });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    await flush();
    expect(w.fetches.length).toBeGreaterThan(0);
    expect(w.fetches.every(([u, o]) => /^\/wq\//.test(u) && o.method === 'HEAD')).toBe(true);
  });
  test('the offline box carries no data-primary (the screen keeps its one)', () => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    expect(w.boxes()).toHaveLength(1);
    expect(w.boxes()[0].innerHTML).not.toMatch(/data-primary/);
  });
  test('the guard module exports no unregistered seam row', () => {
    jest.isolateModules(() => {
      jest.doMock('../../bot/shared/config/supabase', () => ({}));
      jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
      const m = require('../../bot/shared/services/quiz/web-quiz-offline-guard');
      expect(m.hubSwitches).toBeUndefined();
    });
  });
});

describe('the home: ON, offline', () => {
  test.each(['en', 'ur'])('%s: a tile tap stays on the home (0 navigations), the offline line and Try again drawn', (lang) => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, lang, offline_guard: true }, lang);
    const t = h.tap('next');
    expect(t.prevented).toBe(true);
    expect(h.gos).toHaveLength(0);
    expect(w.navs).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
    expect(w.boxes()[0].innerHTML).toContain(LINE[lang]);
    expect(w.boxes()[0].btn).toBeTruthy();
    expect(w.boxes()[0].innerHTML).toContain(AGAIN[lang]);
    expect(w.boxes()[0].attrs.role).toBe('status');
    expect(visibleBox(w)).not.toMatch(BANNED);
    expect(w.fetches).toHaveLength(0);
  });
  test('`online` opens the tile exactly once; a second `online` and a Try again after it open nothing more', () => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    const btn = w.boxes()[0].btn;
    w.online();
    expect(h.gos).toEqual([[TILE, 'next']]);
    w.fire('online');
    (btn.l.click || []).forEach((fn) => fn({}));
    expect(h.gos).toHaveLength(1);
    expect(w.boxes()).toHaveLength(0);
    expect(w.onlineListeners()).toBe(0);
  });
  test('Try again (back online) opens it once; still offline, Try again stays', () => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    const btn = w.boxes()[0].btn;
    btn.l.click.forEach((fn) => fn({}));
    expect(h.gos).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
    w.nav.onLine = true;
    btn.l.click.forEach((fn) => fn({}));
    btn.l.click.forEach((fn) => fn({}));
    w.fire('online');
    expect(h.gos).toEqual([[TILE, 'next']]);
  });
  test('two taps while offline: one line, and the connection back opens one page (the last tapped)', () => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    h.ctx.go('/q/MATH01?k=kk&via=videos', 'door_video');
    expect(w.boxes()).toHaveLength(1);
    w.online();
    expect(h.gos).toEqual([['/q/MATH01?k=kk&via=videos', 'door_video']]);
  });
  test('a door row (Games) and a lesson\'s link (the doors\' go through the same ctx.go) stay too', () => {
    const w = world({ onLine: false });
    w.location.hash = '#games';
    const h = home(w, { ...HOME, offline_guard: true });
    const t = h.tap('row');
    expect(t.prevented).toBe(true);
    expect(h.gos).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
    w.online();
    expect(h.gos).toHaveLength(1);
    expect(h.gos[0][0]).toMatch(/^\/q\/MATH01\?/);
    // the Videos door's lesson page (wq-doors.js start(): go(ctx, '/q/<code>?k=…&via=videos')) is the same call
    w.nav.onLine = false;
    h.ctx.go('/q/VID001?k=k1&via=videos', 'door_video');
    expect(h.gos).toHaveLength(1);
    w.online();
    expect(h.gos[1]).toEqual(['/q/VID001?k=k1&via=videos', 'door_video']);
  });
  test('a mount again (a door, back home) wraps the navigation once, never twice', () => {
    const w = world({ onLine: false });
    const h = home(w, { ...HOME, offline_guard: true });
    w.win.WQHOME.mount({ setAttribute() {}, set innerHTML(x) {}, querySelector: () => null, querySelectorAll: () => [] }, { ...HOME, offline_guard: true }, h.ctx);
    h.ctx.go(TILE, 'next');
    expect(w.boxes()).toHaveLength(1);
    expect(w.onlineListeners()).toBe(1);
    w.online();
    expect(h.gos).toHaveLength(1);
  });
});

describe('the home: ON, online', () => {
  test('a fast line opens at once: no HEAD, no wait, no listener', () => {
    const w = world({ onLine: true, conn: FAST });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    expect(h.gos).toEqual([[TILE, 'next']]);
    expect(w.fetches).toHaveLength(0);
    expect(w.onlineListeners()).toBe(0);
  });
  test('no connection info (most phones): opens at once, no HEAD', () => {
    const w = world({ onLine: true });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    expect(h.gos).toHaveLength(1);
    expect(w.fetches).toHaveLength(0);
  });
  test('a slow line: one HEAD of the tile\'s page (no-store), then it opens once', async () => {
    const w = world({ onLine: true, conn: SLOW });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    expect(h.gos).toHaveLength(0);
    expect(w.fetches).toEqual([[PROBE, HEAD_OPTS]]);
    expect(w.fetches.filter(([u]) => u === TILE)).toHaveLength(0);
    await flush();
    expect(h.gos).toEqual([[TILE, 'next']]);
  });
  test('a slow line whose HEAD fails: stays, the line drawn; `online` opens it once', async () => {
    const w = world({ onLine: true, conn: SLOW, head: 'fail' });
    const h = home(w, { ...HOME, offline_guard: true });
    h.tap('next');
    await flush();
    expect(h.gos).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
    w.online();
    w.online();
    expect(h.gos).toHaveLength(1);
  });
  test('a slow line whose HEAD never answers: opens after 2 s (a slow line is never a trap)', () => {
    jest.useFakeTimers();
    try {
      const w = world({ onLine: true, conn: SLOW, head: 'hang' });
      const h = home(w, { ...HOME, offline_guard: true });
      h.tap('next');
      jest.advanceTimersByTime(1999);
      expect(h.gos).toHaveLength(0);
      jest.advanceTimersByTime(2);
      expect(h.gos).toHaveLength(1);
      expect(w.boxes()).toHaveLength(0);
    } finally { jest.useRealTimers(); }
  });
});

describe('the home: OFF rows (offline, on a slow line — where on would hold the tap)', () => {
  test.each(OFF_VALUES)('%s: no online listener, no HEAD, the plain navigation at once', async (_n, value) => {
    const w = world({ onLine: false, conn: SLOW });
    const B = { ...HOME };
    if (value !== undefined) B.offline_guard = value;
    const h = home(w, B);
    const go0 = h.ctx.go;
    h.tap('next');
    await flush();
    expect(h.gos).toEqual([[TILE, 'next']]);
    expect(w.onlineListeners()).toBe(0);
    expect(w.fetches).toHaveLength(0);
    expect(w.boxes()).toHaveLength(0);
    expect(h.ctx.go).toBe(go0);
    expect(h.ctx.og).toBeUndefined();
  });
});

describe('the finish card (and the fold\'s links beside it): ON', () => {
  test.each(['en', 'ur'])('%s, the Jugnu page (the menu says offline_guard): the card\'s Next offline stays; `online` opens it once, with its own listener', (lang) => {
    const w = world({ onLine: false });
    const c = card(w);
    expect(c.WQFC.trailEnd({ md: () => ({ offline_guard: true }), L: lang, S: { data: {} } }, {})).toBe(false);
    const a = c.anchor('wqfc-next', TILE);
    const r = a.click();
    expect(r.prevented).toBe(true);
    expect(a.own).toBe(0);
    expect(w.navs).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
    expect(w.boxes()[0].innerHTML).toContain(LINE[lang]);
    expect(w.boxes()[0].innerHTML).toContain(AGAIN[lang]);
    expect(visibleBox(w)).not.toMatch(BANNED);
    w.online();
    w.online();
    expect(w.navs).toEqual([['open', TILE]]);
    expect(a.own).toBe(1);
    expect(w.onlineListeners()).toBe(0);
  });
  test.each([['the card\'s Home', 'wqfc-home'], ['the fold\'s Next', 'wqc-fnext'], ['the fold\'s Home', 'wqc-fhome'], ['the quiz fold\'s own Next', 'wq-fnext']])('%s offline stays; Try again opens it once', (_n, id) => {
    const w = world({ onLine: false });
    const c = card(w);
    c.WQFC.og('en');
    const a = c.anchor(id, `/h/${TOKEN}?kid=${KID}&from=home`);
    a.click();
    expect(w.navs).toHaveLength(0);
    const btn = w.boxes()[0].btn;
    w.nav.onLine = true;
    btn.l.click.forEach((fn) => fn({}));
    btn.l.click.forEach((fn) => fn({}));
    expect(w.navs).toHaveLength(1);
  });
  test('an in-page link (#…) and any other link (the share) are never touched', () => {
    const w = world({ onLine: false });
    const c = card(w);
    c.WQFC.og('en');
    c.anchor('wqfc-next', '#stories').click();
    c.anchor('wqfc-share', 'https://wa.me/?text=x').click();
    expect(w.navs).toEqual([['open', '#stories'], ['open', 'https://wa.me/?text=x']]);
    expect(w.boxes()).toHaveLength(0);
  });
  test('a link gone from the page by the time the connection is back: the page opens its address once', () => {
    const w = world({ onLine: false });
    const c = card(w);
    c.WQFC.og('en');
    const a = c.anchor('wqfc-next', TILE);
    a.click();
    a.gone = true;
    w.online();
    expect(w.navs).toEqual([['assign', TILE]]);
  });
  test('a fast line opens at once (its own listener runs, no HEAD); a slow line asks first, then opens once', async () => {
    const w = world({ onLine: true, conn: FAST });
    const c = card(w);
    c.WQFC.og('en');
    const a = c.anchor('wqfc-next', TILE);
    a.click();
    expect(w.navs).toEqual([['open', TILE]]);
    expect(w.fetches).toHaveLength(0);
    w.nav.connection = SLOW;
    const b = c.anchor('wqfc-next', '/c/other');
    b.click();
    expect(w.navs).toHaveLength(1);
    expect(w.fetches).toEqual([[PROBE, HEAD_OPTS]]);
    expect(w.fetches.filter(([u]) => u === '/c/other')).toHaveLength(0);
    await flush();
    expect(w.navs).toEqual([['open', TILE], ['open', '/c/other']]);
    expect(b.own).toBe(1);
  });
  test('a slow line whose HEAD fails stays with the line', async () => {
    const w = world({ onLine: true, conn: SLOW, head: 'fail' });
    const c = card(w);
    c.WQFC.og('en');
    c.anchor('wqfc-next', TILE).click();
    await flush();
    expect(w.navs).toHaveLength(0);
    expect(w.boxes()).toHaveLength(1);
  });
  test('armed twice (every end card): one document listener', () => {
    const w = world({ onLine: false });
    const c = card(w);
    c.WQFC.og('en');
    c.WQFC.trailEnd({ md: () => ({ offline_guard: true }), L: 'en', S: { data: {} } }, {});
    expect(w.document.docL.filter((x) => x[0] === 'click')).toHaveLength(1);
  });
});

describe('the finish card: OFF rows (offline, on a slow line)', () => {
  test.each(OFF_VALUES)('%s: no document listener, no online listener, no HEAD, the plain navigation', (_n, value) => {
    const w = world({ onLine: false, conn: SLOW });
    const c = card(w);
    const md = { card_fold: true };
    if (value !== undefined) md.offline_guard = value;
    c.WQFC.trailEnd({ md: () => md, L: 'en', S: { data: {} } }, {});
    expect(w.document.docL).toHaveLength(0);
    const a = c.anchor('wqfc-next', TILE);
    a.click();
    expect(w.navs).toEqual([['open', TILE]]);
    expect(a.own).toBe(1);
    expect(w.onlineListeners()).toBe(0);
    expect(w.fetches).toHaveLength(0);
    expect(w.boxes()).toHaveLength(0);
  });
});

describe('the quiz page RUNS the arming line (wq.js, the fold card)', () => {
  const { page } = require('./wq-page-harness');
  const RESULT = { card: { first: 'Zara Testwala', animal: 'owl', correct: 3, total: 5, stars: 3, nth: 6 }, challenge_code: 'CHAL12', score: { correct: 3, total: 5, pct: 60 },
    art: { card: 'c.DwjiGhssTV6PkKGyw9Tl9g.abcdefghijkl' }, hub_door: true, jugnu_card: true, card_v3: true, card_fold: true };
  const CHILD = { first: 'Zara Testwala', chip: 'c1', animal: 'owl' };
  const FC_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-finish-card.js'), 'utf8');
  function run(og) {
    const bootExtra = og === undefined ? {} : { offline_guard: og };
    const p = page({ lang: 'en', store: { wq_s_TEST: { st: 's1', child: CHILD, answers: {}, queue: [], result: RESULT, vdone: true } }, bootExtra });
    vm.runInContext(FC_SRC, p.ctx);
    const spy = jest.fn();
    p.ctx.WQFC.og = spy;
    p.wq.card();
    expect(p.html()).toContain('wq-scorecard');
    return spy;
  }
  test.each([['true', true, 1], ['absent', undefined, 0], ['the string true', 'true', 0], ['false', false, 0], ['1', 1, 0]])('offline_guard %s: fc.og called the expected number of times', (_n, v, times) => {
    const spy = run(v);
    expect(spy).toHaveBeenCalledTimes(times);
    if (times) expect(spy).toHaveBeenCalledWith('en');
  });
});

describe('the quiz page arms the card only with the quiz answer\'s offline_guard true', () => {
  test('wq.js: one guarded line in the fold card, the boolean true only', () => {
    const src = fs.readFileSync(WQ_SRC, 'utf8');
    const lines = src.split('\n').filter((l) => /\.og\(/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].trim()).toBe('if (B.offline_guard === true && fc && fc.og) fc.og(LANG);');
    const fold = src.slice(src.indexOf('function foldCard('), src.indexOf('function foldCard(') + 4000);
    expect(fold).toContain('fc.og(LANG)');
  });
});

describe('route level: the line check\'s HEAD makes 0 bot calls (the real router over HTTP, the bot faked)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter, assetVersion } = require('../routes/web-quiz.routes');
  const HUB_TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));
  async function head(p) {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ lang: 'en', kids: [], v: 1 }) };
    };
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent: () => {} }));
    srv = await new Promise((r) => { const sv = app.listen(0, () => r(sv)); });
    const status = await new Promise((resolve, reject) => {
      http.request({ host: '127.0.0.1', port: srv.address().port, method: 'HEAD', path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject).end();
    });
    return { status, calls };
  }
  test('HEAD of the static stylesheet the page links: 200, 0 bot calls', async () => {
    const r = await head(`/wq/wq.css?v=${assetVersion()}`);
    expect(r.status).toBe(200);
    expect(r.calls).toHaveLength(0);
  });
  test('HEAD of the static manifest (the fallback): 200, 0 bot calls', async () => {
    const r = await head('/wq/manifest.webmanifest');
    expect(r.status).toBe(200);
    expect(r.calls).toHaveLength(0);
  });
  test('why not the page: a HEAD of the hub page calls the bot (Express runs the GET handler)', async () => {
    const r = await head(`/h/${HUB_TOKEN}`);
    expect(r.calls.length).toBeGreaterThan(0);
  });
});

// ---- the "Who is playing?" sheet and the jar book: plain links drawn after the home's wiring (their real markup) ----
const BOOK_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-book.js');
const JN = 'JoinCode_0123456789';
function linksOf(html, within) {
  const out = [];
  const rx = /<a\b([^>]*)>/g;
  let m;
  while ((m = rx.exec(html))) {
    const attrs = {};
    const at = /([a-z-]+)="([^"]*)"/g;
    let x;
    while ((x = at.exec(m[1]))) attrs[x[1]] = x[2].replace(/&amp;/g, '&');
    out.push(docLink(attrs, within));
  }
  return out;
}
function docLink(attrs, within) {
  const a = { id: attrs.id || '', className: attrs.class || '', attrs, getAttribute: (k) => (attrs[k] == null ? null : attrs[k]) };
  a.closest = (sel) => (sel === 'a[href]' ? a : (within && sel === `.${within}` ? { className: within } : null));
  return a;
}
// A tap: the page's capture listeners first; not prevented, the browser opens the link itself.
function docClick(w, a) {
  let prevented = false;
  const e = { target: a, preventDefault() { prevented = true; }, stopPropagation() {} };
  w.document.docL.filter((x) => x[0] === 'click').forEach((x) => x[1](e));
  if (!prevented) w.navs.push(['open', a.getAttribute('href')]);
  return prevented;
}
const WHO_HOME = { ...HOME, kids: [HOME.kids[0], { chip: 'fedcba9876543210', first: 'Ali Testwala', animal: 'cat', grade: '3' }], jn: JN };
function whoLinks(w, B, lang = 'en') {
  const h = home(w, B, lang);
  h.tap('who');
  const sheet = (w.sheets || []).find((c) => /wq-who/.test(c.className));
  if (!sheet) throw new Error('no who sheet');
  const links = linksOf(sheet.innerHTML, 'wq-who');
  return { h, pick: links.find((a) => a.attrs['data-tap'] === 'pick'), join: links.find((a) => a.attrs['data-tap'] === 'join') };
}
function bookLinks(w, lang = 'en') {
  vm.runInNewContext(fs.readFileSync(BOOK_SRC, 'utf8'), sandbox(w));
  const d = { name: 'Sam Testwala', lamps: { reading: 3 }, levelup: { ladder: 'reading', rung: 3, opens: 'longer' }, story_stickers: [{ passage_id: 'p1', title: 'The kite' }] };
  const html = w.win.WQBOOK._bookHtml(d, { token: TOKEN, kid: KID, lang, v3: true }, true);
  const links = linksOf(html, null);
  return { go: links.find((a) => a.id === 'wq-bk-go'), star: links.find((a) => /wq-bk-st/.test(a.className)) };
}
// My class / My school (the sandbox's class doors): real markup from the home, drawn with the home
function socialOf(w, B, lang, which) {
  const h = home(w, { ...B, class_doors: { class: '/q/ABCD1234/class', schools: '/q/ABCD1234/schools' } }, lang);
  const el = h.taps().find((t) => t.attrs['data-social'] === which);
  if (!el) throw new Error(`no ${which}`);
  return { h, a: docLink(el.attrs, 'wq-social') };
}
// Each surface: the home mounted with B, then its link from the real markup.
const SURFACES = [
  ['the who-sheet\'s other child', (w, B, lang) => { const r = whoLinks(w, B, lang); return { h: r.h, a: r.pick }; }],
  ['the who-sheet\'s Someone new?', (w, B, lang) => { const r = whoLinks(w, B, lang); return { h: r.h, a: r.join }; }],
  ['the jar book\'s Let\'s go', (w, B, lang) => { const h = home(w, B, lang); return { h, a: bookLinks(w, lang).go }; }],
  ['the jar book\'s story sticker', (w, B, lang) => { const h = home(w, B, lang); return { h, a: bookLinks(w, lang).star }; }],
  ['the home\'s My class', (w, B, lang) => socialOf(w, B, lang, 'myClass')],
  ['the home\'s My school', (w, B, lang) => socialOf(w, B, lang, 'mySchool')],
];

describe('the who-sheet and the jar book (links drawn after the home\'s wiring): ON, offline', () => {
  test.each(SURFACES)('%s: stays with the line and Try again; `online` opens it once; no hub_pick', (_n, mk) => {
    const w = world({ onLine: false });
    const { h, a } = mk(w, { ...WHO_HOME, offline_guard: true }, 'en');
    const href = a.getAttribute('href');
    expect(href).toMatch(/^\/(h|quiz\/join|c|q)\//);
    expect(docClick(w, a)).toBe(true);
    expect(w.navs).toEqual([]);
    expect(w.boxes()).toHaveLength(1);
    expect(visibleBox(w)).toContain(LINE.en);
    expect(visibleBox(w)).toContain(AGAIN.en);
    w.online();
    w.online();
    expect(w.navs).toEqual([['assign', href]]);
    expect(w.boxes()).toHaveLength(0);
    expect(h.gos).toEqual([]);
  });
  test('Urdu: the who-sheet row stays with the Urdu line', () => {
    const w = world({ onLine: false });
    const { pick } = whoLinks(w, { ...WHO_HOME, lang: 'ur', offline_guard: true }, 'ur');
    expect(docClick(w, pick)).toBe(true);
    expect(visibleBox(w)).toContain(LINE.ur);
    expect(visibleBox(w)).toContain(AGAIN.ur);
    expect(w.navs).toEqual([]);
  });
});

describe('the who-sheet and the jar book: ON, online', () => {
  test.each(SURFACES)('%s: a fast line opens at once, no HEAD, no box', (_n, mk) => {
    const w = world({ onLine: true, conn: FAST });
    const { a } = mk(w, { ...WHO_HOME, offline_guard: true }, 'en');
    expect(docClick(w, a)).toBe(true);
    expect(w.navs).toEqual([['assign', a.getAttribute('href')]]);
    expect(w.fetches).toHaveLength(0);
    expect(w.boxes()).toHaveLength(0);
  });
  test('a slow line: one HEAD of the static stylesheet (never the page), then it opens once', async () => {
    const w = world({ onLine: true, conn: SLOW });
    const { join } = whoLinks(w, { ...WHO_HOME, offline_guard: true });
    docClick(w, join);
    expect(w.fetches).toEqual([[PROBE, HEAD_OPTS]]);
    await flush();
    expect(w.navs).toEqual([['assign', join.getAttribute('href')]]);
  });
  test('any other link (a grown-up\'s teacher link, a pick-like link outside the sheet, an in-page #) is never touched', () => {
    const w = world({ onLine: false });
    home(w, { ...WHO_HOME, offline_guard: true });
    const others = [docLink({ 'data-tap': 'teacher', href: '/t/x' }), docLink({ 'data-tap': 'pick', href: '/h/y' }), docLink({ id: 'wq-bk-go', href: '#book' })];
    others.forEach((a) => expect(docClick(w, a)).toBe(false));
    expect(w.navs).toEqual([['open', '/t/x'], ['open', '/h/y'], ['open', '#book']]);
    expect(w.boxes()).toHaveLength(0);
  });
  test('the home mounted again (back from the book): one capture listener', () => {
    const w = world({ onLine: true });
    const h = home(w, { ...WHO_HOME, offline_guard: true });
    w.win.WQHOME.mount({ innerHTML: '', setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {}, removeChild() {} }, { ...WHO_HOME, offline_guard: true }, h.ctx);
    expect(w.document.docL.filter((x) => x[0] === 'click')).toHaveLength(1);
  });
});

describe('the who-sheet and the jar book: OFF rows (offline, on a slow line)', () => {
  test.each(OFF_VALUES)('%s: no capture listener, the plain link opens at once', (_n, value) => {
    SURFACES.forEach(([, mk]) => {
      const w = world({ onLine: false, conn: SLOW });
      const B = { ...WHO_HOME };
      if (value !== undefined) B.offline_guard = value;
      const { a } = mk(w, B, 'en');
      expect(w.document.docL).toHaveLength(0);
      expect(docClick(w, a)).toBe(false);
      expect(w.navs).toEqual([['open', a.getAttribute('href')]]);
      expect(w.onlineListeners()).toBe(0);
      expect(w.fetches).toHaveLength(0);
      expect(w.boxes()).toHaveLength(0);
    });
  });
});
