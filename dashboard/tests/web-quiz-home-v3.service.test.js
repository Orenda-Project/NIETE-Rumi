/**
 * The v3 child home (web_quiz_home_v3): the edge's tags (byte-identical with the key absent), hub.js's one mount line
 * (the home only when the bot sent `home_v3`; today's hub otherwise), and the shipped wq-home.js run in a vm: exactly
 * one Next CTA, three doors (an empty door says "coming soon", never vanishes), no banned word on any screen in
 * either language, Urdu digits and no U+00B7 in Urdu, and the fallback to today's lantern when `next` is absent.
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { renderHubPage } = require('../routes/web-quiz.routes');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HUB = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
};
const DOORS_FULL = {
  stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }, { kind: 'listen', id: 'en.listen.1.k02', fresh: false }],
  games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, { kind: 'numbers' }, { kind: 'quiz', code: 'SCI001', k: 'k2', topic: 'Plants', subject: 'Science', done: true }],
  videos: { href: `/lib/${TOKEN}?kid=${KID}&l=en` },
};
const DOORS_EMPTY = { stories: [], games: [], videos: null };
const HOME = { ...HUB, home_v3: 1, doors: DOORS_FULL, head: { dots: 2, today: false, jar: { fresh: true } } };
const GOLDEN = path.join(__dirname, 'web-quiz-book-hub-golden.html');
const HOME_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.js');
const CSS_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-home.css');
const HUB_SRC = path.join(__dirname, '..', 'public', 'wq', 'hub.js');

// The words a child's screen never shows: the copy ban list, the old activity names and the test words.
const BANNED = /\b(test|tests|exam|assess\w*|wrong|wcpm|rank|percentile|position|prize|reward|unlock|level|clever|perfect|genius|incredible|egma|comparable|tested|testwala|challenge|trail|today|practice|counted|story time)\b|امتحان|ٹیسٹ|غلط|نتائج|نتیجہ|انعام|ذہین|کامل|پڑاؤ|چیلنج/i;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function loadHome() {
  const win = {};
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, localStorage: { getItem: () => null, setItem() {} }, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQHOME;
}
const ctxOf = (lang) => ({ token: TOKEN, lang });
const count = (html, rx) => (html.match(rx) || []).length;

describe('the edge: tags only when the bot sent home_v3', () => {
  test('golden: no home_v3 -> string-equal to the base hub page', () => {
    const html = renderHubPage({ payload: HUB, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(html).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    expect(html).not.toContain('wq-home');
  });
  test('home_v3: the home\'s stylesheet and script at the page\'s ?v=, before hub.js; never wq.js', () => {
    const html = renderHubPage({ payload: HOME, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(html).toContain('<link rel="stylesheet" href="/wq/wq-home.css?v=abcdef0123">');
    expect(html.indexOf('/wq/wq-home.js?v=abcdef0123')).toBeGreaterThan(0);
    expect(html.indexOf('/wq/wq-home.js')).toBeLessThan(html.indexOf('/wq/hub.js'));
    expect(html).not.toMatch(/\/wq\/wq\.js/);
  });
  test('Urdu: the page is lang=ur dir=rtl', () => {
    const html = renderHubPage({ payload: { ...HOME, lang: 'ur' }, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(html).toMatch(/<html lang="ur" dir="rtl"/);
  });
});

describe('wq-home.js: the home', () => {
  const H = loadHome();
  test.each(['en', 'ur'])('%s: exactly one Next CTA (data-primary), three doors, the jar and the dots', (lang) => {
    const html = H.html(HOME, ctxOf(lang));
    expect(count(html, /class="wq-next[ "]/g)).toBe(1);
    expect(count(html, /data-primary/g)).toBe(1);
    expect(count(html, /class="wq-door[ "]/g)).toBe(3);
    expect(html).toContain('data-screen="home"');
    expect(html).toContain('class="wq-jar"');
    expect(count(html, /class="wq-dot on/g)).toBe(2);
    expect(count(html, /class="wq-dot ring/g)).toBe(1);
    // No count about the child: the jar has no number, the dots have no digits (the tile's minutes are a duration).
    expect(visible(html).replace(/\d+ min|[۰-۹]+ منٹ/g, '')).not.toMatch(/[0-9۰-۹]/);
  });
  test('the Next CTA is at least 56 px tall (wq-home.css)', () => {
    const css = fs.readFileSync(CSS_SRC, 'utf8');
    const rule = /\.wq-next\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(Number((/min-height:(\d+)px/.exec(rule[1]) || [])[1])).toBeGreaterThanOrEqual(56);
    expect(css).toMatch(/html\[dir=rtl\]/);
  });
  test.each(['en', 'ur'])('%s: no banned word on the home or any door, full or empty', (lang) => {
    [HOME, { ...HOME, doors: DOORS_EMPTY, head: { dots: 0, today: false, jar: null } }].forEach((B) => {
      [H.html(B, ctxOf(lang)), ...H.DOORS.map((d) => H.door(B, ctxOf(lang), d))].forEach((html) => {
        expect(visible(html)).not.toMatch(BANNED);
      });
    });
  });
  test('every copy string, both languages: no banned word; Urdu has no Western digit and no U+00B7', () => {
    ['en', 'ur'].forEach((l) => Object.values(H.COPY[l]).forEach((v) => {
      const s = typeof v === 'function' ? v(v === H.COPY[l].hi ? 'Zara' : 3) : String(v);
      expect(s).not.toMatch(BANNED);
      if (l === 'ur') { expect(s).not.toMatch(/[0-9]/); expect(s).not.toContain('·'); }
    }));
    expect(H.COPY.ur.mins(2)).toBe('۲ منٹ');
  });
  test('Urdu next tile with minutes: Urdu digits, «،» and never «·»', () => {
    const html = H.html({ ...HOME, next: { kind: 'story', href: '/c/x', title: 'Read', title_ur: 'جگنو کے ساتھ کہانی پڑھیں', sub_ur: 'لال پتنگ', minutes: 2 } }, ctxOf('ur'));
    expect(html).toContain('لال پتنگ</bdi>، <span class="wq-nmin">۲ منٹ</span>'); // the minutes never wrap apart
    expect(html).not.toContain('·');
  });
});

describe('wq-home.js: the doors', () => {
  const H = loadHome();
  test.each(H ? H.DOORS : [])('%s: an empty door is still there and says coming soon; a full one lists rows', (d) => {
    const empty = H.door({ ...HOME, doors: DOORS_EMPTY }, ctxOf('en'), d);
    expect(empty).toContain(`data-screen="${d}"`);
    expect(empty).toContain(`data-soon="${d}"`);
    expect(visible(empty)).toContain('Coming soon');
    expect(count(empty, /class="wq-door[ "]/g)).toBe(3);
    expect(count(empty, /data-primary/g)).toBe(1);
    expect(empty).toContain('data-home');
    // the Stories door's content is the storybook shelf (the reader fills the slot and draws its primary)
    const full = H.door(d === 'stories' ? { ...HOME, doors: { ...DOORS_FULL, stories: [...DOORS_FULL.stories, { kind: 'shelf' }] } } : HOME, ctxOf('en'), d);
    expect(full).not.toContain('data-soon');
    expect(count(full, /data-primary/g)).toBe(d === 'stories' ? 0 : 1);
  });
  test('Games: the teacher quiz opens the quiz; a done quiz opens Play again; no score shown', () => {
    const html = H.door(HOME, ctxOf('en'), 'games');
    expect(html).toContain('href="/q/MATH01?k=kk"');
    expect(html).toContain('href="/q/SCI001?again=1&amp;k=k2"');
    expect(visible(html)).not.toMatch(/\d+\s*\/\s*\d+/);
  });
  test('Stories: the shelf stub is a slot for the stories reader; a passage is not a row here (it opens from the Next tile)', () => {
    const html = H.door({ ...HOME, doors: { ...DOORS_FULL, stories: [...DOORS_FULL.stories, { kind: 'shelf' }] } }, ctxOf('en'), 'stories');
    expect(html).not.toContain('room=story');
    expect(html).toContain('data-stories-shelf="1"');
  });
  test('the Next tile: a listening story asks the story room for a listen (&ex=listen)', () => {
    const nx = H.nextOf({ ...HOME, doors: { ...DOORS_FULL, stories: [{ kind: 'listen', id: 'en.listen.1.k02', fresh: true }] } }, ctxOf('en'));
    expect(nx.href).toMatch(/&ex=listen$/);
  });
});

describe('wq-home.js: the Next tile', () => {
  const H = loadHome();
  test('the server\'s next wins', () => {
    const nx = H.nextOf({ ...HOME, teacher: { code: 'T1', k: 'a', topic: 'X' }, next: { kind: 'video', href: '/lib/x', title: 'Watch: Water', minutes: 3 } }, ctxOf('en'));
    expect(nx).toMatchObject({ kind: 'video', title: 'Watch: Water', href: '/lib/x', src: 'next' });
  });
  test('next absent: the teacher\'s quiz first, as today\'s hub card', () => {
    const nx = H.nextOf({ ...HOME, teacher: { code: 'T1', k: 'a', topic: 'Plants' } }, ctxOf('en'));
    expect(nx).toMatchObject({ kind: 'quiz', sub: 'Plants', href: '/q/T1?k=a', src: 'teacher' });
  });
  test('next absent, the lantern is "the games list": the tile names its first open step when the server names it, else neutral words, never "a game"', () => {
    const B = { ...HOME, play: { lantern: { kind: 'trail', stops: 2 } } };
    const en = H.nextOf(B, ctxOf('en'));
    expect(en.title).toBe('Come along with Jugnu');
    expect(en.href).toMatch(/#next$/);
    expect(H.nextOf(B, ctxOf('ur')).title).toBe('جگنو کے ساتھ چلیں');
    expect(visible(H.html(B, ctxOf('en')))).not.toMatch(/a game|Play with Jugnu/i);
    const named = { ...HOME, play: { lantern: { kind: 'trail', stops: 2, first: { id: 'read', label: 'Read aloud', lang: 'en' } } } };
    expect(H.nextOf(named, ctxOf('en'))).toMatchObject({ title: 'Read aloud', href: expect.stringMatching(/#next$/) });
    // a label in another language than the page's: the neutral words, never a mixed screen
    expect(H.nextOf(named, ctxOf('ur')).title).toBe('جگنو کے ساتھ چلیں');
  });
  test('next absent: today\'s lantern decides — the same story and the same destination as the lantern line', () => {
    const B = { ...HOME, play: { lantern: { kind: 'story', title: 'The red kite', pid: 'en.read.1.k07' } } };
    const nx = H.nextOf(B, ctxOf('en'));
    expect(nx).toMatchObject({ kind: 'story', title: 'Read a story with Jugnu', sub: 'The red kite', src: 'lantern' });
    expect(nx.href).toBe(`/c/${encodeURIComponent(TOKEN)}?kid=${KID}&room=story&pid=en.read.1.k07`);
    const trail = H.nextOf({ ...HOME, play: { lantern: { kind: 'trail', stops: 2 } } }, ctxOf('en'));
    expect(trail).toMatchObject({ kind: 'game', href: `/c/${encodeURIComponent(TOKEN)}?kid=${KID}#next`, src: 'lantern' });
    // the tile opens the one game it names (wq-trail.js starts it): the first not done, or the number warm-up
    expect(H.nextOf({ ...HOME, play: { lantern: { kind: 'numbers' } } }, ctxOf('en')).href).toBe(`/c/${encodeURIComponent(TOKEN)}?kid=${KID}#numbers`);
    expect(H.nextOf({ ...HOME, doors: { stories: [], games: [{ kind: 'numbers' }], videos: null } }, ctxOf('en')).href).toBe(`/c/${encodeURIComponent(TOKEN)}?kid=${KID}#numbers`);
    expect(trail.title).not.toMatch(BANNED);
  });
  test('nothing at all: one Next element still, and it opens the Stories door', () => {
    const html = H.html({ ...HUB, challenge: null, home_v3: 1, doors: DOORS_EMPTY, head: { dots: 0, today: false, jar: null } }, ctxOf('en'));
    expect(count(html, /class="wq-next[ "]/g)).toBe(1);
    expect(html).toContain('data-kind="door"');
    expect(html).toContain('href="#stories"');
  });
});

describe('wq-home.js: mount loads the stories reader only when the server says stories are on', () => {
  function mountWith(B, hash) {
    const head = [];
    const root = { innerHTML: '', setAttribute() {}, querySelector: (sel) => (sel === '[data-stories-shelf]' && /data-stories-shelf/.test(root.innerHTML) ? {} : null), querySelectorAll: () => [], appendChild() {} };
    const win = { addEventListener() {}, scrollTo() {} };
    const document = {
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, addEventListener() {} }), head: { appendChild: (el) => head.push(el) },
    };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, location: { hash }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent });
    win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev() {} });
    // the door screens (wq-doors.js) are fetched after every paint; asserted on their own in web-quiz-doors-v3
    return head.map((e) => e.src || e.href).filter((u) => !/\/wq\/wq-doors\./.test(u));
  }
  const shelfB = { ...HOME, doors: { ...DOORS_FULL, stories: [{ kind: 'shelf' }] } };
  test('stories.on + the Stories door: wq-stories.css/.js at hub.js\'s ?v=', () => {
    expect(mountWith({ ...shelfB, stories: { on: 1 } }, '#stories')).toEqual(['/wq/wq-stories.css?v=abc123', '/wq/wq-stories.js?v=abc123']);
  });
  test('stories.on + a #story/<id> entry (a teacher link): loaded, the reader takes the hash', () => {
    expect(mountWith({ ...HOME, stories: { on: 1 } }, '#story/abc')).toEqual(['/wq/wq-stories.css?v=abc123', '/wq/wq-stories.js?v=abc123']);
    expect(mountWith({ ...HOME, stories: { on: 1 } }, '')).toEqual([]);
  });
  test('no stories.on: nothing loaded', () => {
    expect(mountWith(shelfB, '#stories')).toEqual([]);
  });
});

describe('wq-home.js: one sound switch for both keys', () => {
  function withStore(store, wqj) {
    const win = {}; if (wqj) win.WQJ = wqj;
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, localStorage: ls, JSON, Math, String, Number, Array, Object, encodeURIComponent });
    return win.WQHOME;
  }
  test('the quiz page\'s wq_sound=false mutes the home too', () => {
    const html = withStore({ wq_sound: 'false' }).html(HOME, ctxOf('en'));
    expect(html).toContain('aria-pressed="false"');
  });
  test('WQJ, when loaded, is the one source', () => {
    const html = withStore({}, { muted: () => true }).html(HOME, ctxOf('en'));
    expect(html).toContain('aria-pressed="false"');
  });
});

// ---- hub.js: the one mount line ------------------------------------------------------------------------------
function runHub(boot, home) {
  const root = { _h: '', set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute() {}, getAttribute: () => 'H2', querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const win = { scrollTo() {}, addEventListener() {} };
  if (home) win.WQHOME = home;
  const head = [];
  const document = {
    documentElement: { setAttribute() {}, classList: { toggle() {} } }, cookie: '',
    getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => ({ tag, l: {}, addEventListener(n, fn) { this.l[n] = fn; } }),
    head: { appendChild: (el) => { head.push(el); } },
  };
  vm.runInNewContext(fs.readFileSync(HUB_SRC, 'utf8'), {
    window: win, document, navigator: { sendBeacon: () => true }, history: { replaceState() {} }, location: { search: '', protocol: 'https:' }, Blob: function Blob() {},
    localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  });
  return { html: root._h, head, win, root };
}
describe('hub.js', () => {
  test('home_v3 with wq-home.js loaded: the home is mounted (root, the boot, the token and language)', () => {
    const seen = [];
    runHub({ ...HOME, brand: null, token: TOKEN }, { mount: (root, B, ctx) => seen.push([B.kid, ctx.token, ctx.lang, typeof ctx.ev, typeof ctx.go]) });
    expect(seen).toEqual([[KID, TOKEN, 'en', 'function', 'function']]);
  });
  test('home_v3 before wq-home.js arrives: loaded once at hub.js\'s ?v=; a failed load draws today\'s hub', () => {
    const r = runHub({ ...HOME, brand: null, token: TOKEN }, null);
    expect(r.head.map((e) => e.src || e.href)).toEqual(['/wq/wq-home.css?v=abc123', '/wq/wq-home.js?v=abc123']);
    expect(r.html).toBe('');
    r.head[1].l.error();
    expect(r.root.innerHTML).toContain('wq-hub');
  });
  test('a practice boot (no child, home_v3): the home is mounted, not the "no one here" screen', () => {
    const seen = [];
    runHub({ ...HUB, kids: [], kid: null, practice: 1, grade: 3, home_v3: 1, doors: DOORS_EMPTY, head: { dots: 0, today: false, jar: null }, brand: null, token: TOKEN }, { mount: (root, B) => seen.push(B.practice) });
    expect(seen).toEqual([1]);
  });
  test('kids:[] without practice: today\'s screen, never the home', () => {
    const seen = [];
    runHub({ ...HUB, kids: [], kid: null, home_v3: 1, doors: DOORS_EMPTY, brand: null, token: TOKEN }, { mount: () => seen.push(1) });
    expect(seen).toHaveLength(0);
  });
  test('off (no home_v3): today\'s hub, never mounted, nothing loaded', () => {
    const seen = [];
    const r = runHub({ ...HUB, brand: null, token: TOKEN }, { mount: () => seen.push(1) });
    expect(seen).toHaveLength(0);
    expect(r.head).toHaveLength(0);
    expect(r.html).toContain('wq-hub');
  });
});

// ---- a live-ish page for mount(): elements that keep their listeners, a head, timers from the test -------------
function page({ hash = '', conn = null, idle = true, bind = null, search = '', book = null } = {}) {
  const els = {}; const sheets = []; const head = []; const evs = []; const idleQ = [];
  const el = (name) => {
    if (els[name]) return els[name];
    const l = {};
    els[name] = {
      l, attrs: {}, classList: { add() {}, remove() {} },
      addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); },
      fire(n) { (l[n] || []).forEach((fn) => fn({ preventDefault() {} })); },
      getAttribute(a) { return this.attrs[a] == null ? null : this.attrs[a]; },
    };
    return els[name];
  };
  const root = {
    innerHTML: '', setAttribute() {},
    querySelector: (sel) => (sel === '[data-tap="grownups"]' ? el('grownups') : null),
    querySelectorAll: () => [],
    appendChild: (b) => { b.parentNode = root; sheets.push(b); },
    removeChild: (b) => { const i = sheets.indexOf(b); if (i >= 0) sheets.splice(i, 1); },
  };
  const win = { addEventListener() {}, scrollTo() {} };
  if (idle) win.requestIdleCallback = (fn) => idleQ.push(fn);
  if (bind) win.WQBIND = bind;
  if (book) win.WQBOOK = book;
  const document = {
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => ({ tag, className: '', attrs: {}, kids: [], setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, querySelector(sel) { if (sel !== '[data-tap="close"]') return null; const f = this.closeFns = this.closeFns || []; return { addEventListener(n, fn) { f.push(fn); } }; }, appendChild(c) { this.kids.push(c); }, innerHTML: '' }),
    head: { appendChild: (x) => head.push(x) },
  };
  const navigator = conn ? { connection: conn } : {};
  vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, navigator, location: { hash, pathname: '/h/x', search }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp });
  return { H: win.WQHOME, root, sheets, head, evs, el, idleQ, mount(B, ctx) { win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]), ...ctx }); } };
}

describe('the grown-ups corner: one timer at a time (a tap never opens it)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('pointerdown + touchstart, released after 80 ms, then 2.1 s: no sheet', () => {
    const p = page(); p.mount(HOME);
    const g = p.el('grownups');
    g.fire('pointerdown'); g.fire('touchstart');
    jest.advanceTimersByTime(80);
    g.fire('pointerup'); g.fire('touchend');
    jest.advanceTimersByTime(2100);
    expect(p.sheets.filter((b) => b.className === 'wq-gsheet')).toHaveLength(0);
  });
  test('held 2.2 s (both events fire for one finger): exactly one sheet', () => {
    const p = page(); p.mount(HOME);
    const g = p.el('grownups');
    g.fire('pointerdown'); g.fire('touchstart');
    jest.advanceTimersByTime(2200);
    expect(p.sheets.filter((b) => b.className === 'wq-gsheet')).toHaveLength(1);
  });
});

describe('the empty home: the primary is a door that has things, the sentence is the sub-line', () => {
  const H = loadHome();
  const EMPTY = { ...HUB, challenge: null, home_v3: 1, doors: DOORS_EMPTY, head: { dots: 0, today: false, jar: null } };
  test.each(['en', 'ur'])('%s: one tappable primary to the Stories door', (lang) => {
    const html = H.html(EMPTY, ctxOf(lang));
    expect(count(html, /data-primary/g)).toBe(1);
    const prim = /<a class="wq-next[^"]*" data-primary[^>]*href="([^"]*)"/.exec(html);
    expect(prim && prim[1]).toBe('#stories');
    expect(visible(html)).toContain(H.COPY[lang].nextNone);
    expect(visible(html)).not.toMatch(BANNED);
  });
});

describe('events: home_view on every home render; the Next tile carries the ranking fields', () => {
  test('a Next tile from the server: home_view{src} AND next_shown with arm/score_v/offer/rank_src', () => {
    const p = page();
    p.mount({ ...HOME, src: 'quiz', next: { kind: 'story', href: '/c/x?kid=k', title: 'Read', arm: 'rank', score_v: 3, offer: 'o-1', rank_src: 'prior' } });
    const names = p.evs.map((e) => e[0]);
    expect(names).toEqual(expect.arrayContaining(['home_view', 'next_shown']));
    expect(p.evs.find((e) => e[0] === 'home_view')[1]).toEqual({ src: 'quiz' });
    expect(p.evs.find((e) => e[0] === 'next_shown')[1]).toMatchObject({ pos: 0, arm: 'rank', score_v: 3, offer: 'o-1', rank_src: 'prior' });
  });
  test('the fallback tile: home_view too, and no ranking fields invented', () => {
    const p = page(); p.mount(HOME);
    expect(p.evs.map((e) => e[0])).toEqual(expect.arrayContaining(['home_view', 'next_shown']));
    expect(p.evs.find((e) => e[0] === 'home_view')[1]).toEqual({ src: 'home' });
    expect(p.evs.find((e) => e[0] === 'next_shown')[1]).not.toHaveProperty('arm');
  });
  test('the control arm\'s tile (server source fallback) logs source fallback on next_shown, never ranked; no source = ranked as before', () => {
    const p = page();
    p.mount({ ...HOME, next: { kind: 'story', href: '/c/x?kid=k', title: 'Read', arm: 'ctrl', offer: 'o-1', rank_src: 'ctrl', source: 'fallback' } });
    expect(p.evs.find((e) => e[0] === 'next_shown')[1]).toMatchObject({ ctx: 'home', pos: 0, source: 'fallback', arm: 'ctrl', rank_src: 'ctrl' });
    const q = page();
    q.mount({ ...HOME, next: { kind: 'story', href: '/c/x?kid=k', title: 'Read', source: 'pinned' } });
    expect(q.evs.find((e) => e[0] === 'next_shown')[1].source).toBe('pinned');
    const r = page();
    r.mount({ ...HOME, next: { kind: 'story', href: '/c/x?kid=k', title: 'Read', source: '<x>' } });
    expect(r.evs.find((e) => e[0] === 'next_shown')[1].source).toBe('ranked');
  });
  test('a door screen is not a home render', () => {
    const p = page({ hash: '#games' }); p.mount(HOME);
    expect(p.evs.map((e) => e[0])).not.toContain('home_view');
  });
});

describe('one word for the teacher on a child screen, and the pending teacher quiz tile', () => {
  const H = loadHome();
  test('no «استاد» anywhere in the Urdu copy; «ٹیچر» in the four teacher lines', () => {
    Object.values(H.COPY.ur).forEach((v) => expect(typeof v === 'function' ? v(3) : String(v)).not.toContain('استاد'));
    ['videosSay', 'nextQuiz', 'nextNone', 'fromTeacher'].forEach((k) => expect(H.COPY.ur[k]).toContain('ٹیچر'));
  });
  test.each(['en', 'ur'])('%s: the teacher\'s pending quiz is the Next tile "From your teacher" with the New tag, the topic as the sub', (lang) => {
    const B = { ...HOME, teacher: { code: 'T1', k: 'a', topic: 'Plants' } };
    expect(H.nextOf(B, ctxOf(lang))).toMatchObject({ title: H.COPY[lang].fromTeacher, sub: 'Plants', src: 'teacher', tag: H.COPY[lang].newQuiz });
    const html = H.html(B, ctxOf(lang));
    expect(html).toContain('<i class="wq-new">' + H.COPY[lang].newQuiz + '</i>');
    // «کوئز» is masculine: «نیا» on a quiz (a story keeps «نئی»), per the native read.
    if (lang === 'ur') { expect(H.COPY.ur.newQuiz).toBe('نیا'); expect(H.COPY.ur.newTag).toBe('نئی'); }
  });
  test('controls are SVG, never emoji: the sound toggle and the go arrow', () => {
    ['en', 'ur'].forEach((lang) => {
      const html = H.html({ ...HOME, teacher: { code: 'T1', k: 'a', topic: 'Plants' } }, ctxOf(lang));
      expect(html).not.toMatch(/[\u{1F507}\u{1F50A}▶◀]/u);
      expect(/<button class="wq-snd"[^>]*>(.*?)<\/button>/.exec(html)[1]).toMatch(/^<svg/);
    });
  });
  test('Jugnu\'s giggle is declared for the audit: data-sound + data-trigger on the header image', () => {
    expect(H.html(HOME, ctxOf('en'))).toMatch(/<img class="wq-hjug" data-tap="jugnu" data-sound="giggle" data-trigger="tap"/);
  });
});

describe('the home\'s next_tap says where it was tapped (ctx home) and how long after the tile showed (ms_to_tap)', () => {
  function tapNext(B) {
    const evs = []; const l = {};
    const tile = { attrs: { 'data-tap': 'next', 'data-kind': 'story', href: '#stories' }, getAttribute(a) { return this.attrs[a] == null ? null : this.attrs[a]; }, addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); }, classList: { add() {}, remove() {} } };
    const root = { innerHTML: '', setAttribute() {}, querySelector: () => null, querySelectorAll: (sel) => (sel === '[data-tap]' ? [tile] : []), appendChild() {} };
    const win = { addEventListener() {}, scrollTo() {} };
    const document = { querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null), createElement: (tag) => ({ tag, addEventListener() {} }), head: { appendChild() {} } };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, location: { hash: '', pathname: '/h/x', search: '' }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp, Date });
    win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev: (n, p) => evs.push([n, p]) });
    (l.click || []).forEach((fn) => fn({ preventDefault() {} }));
    return evs.find(([n]) => n === 'next_tap')[1];
  }
  test('the fallback tile (no offer): ctx home + a whole ms_to_tap >= 0', () => {
    const e = tapNext(HOME);
    expect(e).toMatchObject({ ctx: 'home', pos: 0, kind: 'story' });
    expect(Number.isInteger(e.ms_to_tap) && e.ms_to_tap >= 0).toBe(true);
  });
  test('a ranked tile: the same, beside its offer words', () => {
    const e = tapNext({ ...HOME, next: { kind: 'story', href: '#stories', title: 'Read', arm: 'rank', offer: 'o-1', rank_src: 'prior' } });
    expect(e).toMatchObject({ ctx: 'home', pos: 0, offer: 'o-1', arm: 'rank', rank_src: 'prior' });
    expect(Number.isInteger(e.ms_to_tap) && e.ms_to_tap >= 0).toBe(true);
  });
});

describe('a #story/<id> hash set in the page after the home is drawn (the Next tile, a resume tile) opens the book', () => {
  function live2(B, { stories = null } = {}) {
    const head = []; const l = {};
    const loc = { hash: '', pathname: '/h/x', search: '' };
    const root = { innerHTML: '', setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
    const win = { addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); }, scrollTo() {} };
    if (stories) win.WQSTORIES = stories;
    const document = {
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, addEventListener() {} }), head: { appendChild: (x) => head.push(x) },
    };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, location: loc, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp });
    win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev() {} });
    const html0 = root.innerHTML;
    const go = (h) => { loc.hash = h; (l.hashchange || []).forEach((fn) => fn({})); };
    const storyFiles = () => head.map((e) => e.src || e.href).filter((u) => /\/wq\/wq-stories\./.test(u));
    return { root, html0, go, storyFiles };
  }
  test('stories on, the reader not yet fetched: the hash fetches wq-stories once (it routes the hash on load); the home is not redrawn', () => {
    const p = live2({ ...HOME, stories: { on: 1 } });
    expect(p.storyFiles()).toEqual([]);
    p.go('#story/abc');
    expect(p.storyFiles()).toEqual(['/wq/wq-stories.css?v=abc123', '/wq/wq-stories.js?v=abc123']);
    expect(p.root.innerHTML).toBe(p.html0);
    p.go('#story/abc/p2');
    expect(p.storyFiles()).toHaveLength(2);
  });
  test('the reader already here: it owns the hash (its own listener), the home fetches nothing and draws nothing', () => {
    const p = live2({ ...HOME, stories: { on: 1 } }, { stories: { route: jest.fn() } });
    p.go('#story/abc');
    expect(p.storyFiles()).toEqual([]);
    expect(p.root.innerHTML).toBe(p.html0);
  });
  test('stories off: the hash does nothing (today)', () => {
    const p = live2(HOME);
    p.go('#story/abc');
    expect(p.storyFiles()).toEqual([]);
    expect(p.root.innerHTML).toBe(p.html0);
  });
});

describe('hash routes: an empty hash is home again, #book opens the Book on load', () => {
  test('the Book opens on mount when the page lands on #book', () => {
    const p = page({ hash: '#book' }); p.mount({ ...HOME, book_on: true });
    // (the door screens' own two files follow every paint; they are asserted in web-quiz-doors-v3)
    expect(p.head.map((e) => e.src || e.href).filter((u) => !/\/wq\/wq-doors\./.test(u))).toEqual(['/wq/wq-book.css?v=abc123', '/wq/wq-book.js?v=abc123']);
  });
});

describe('the Book from the v3 home says so (ctx.v3): its sticker head is the games\' word, never "Trail"', () => {
  test('WQBOOK.open gets v3: true from the home', () => {
    const opened = [];
    const p = page({ hash: '#book', book: { open: (c) => opened.push(c) } }); p.mount({ ...HOME, book_on: true });
    expect(opened).toHaveLength(1);
    expect(opened[0]).toEqual(expect.objectContaining({ v3: true, kid: KID, lang: 'en' }));
  });
});

describe('the Next tile\'s first JSON, prefetched when the phone is idle (pos 0 only)', () => {
  const NX = { ...HOME, next: { kind: 'story', href: `/c/${TOKEN}?kid=${KID}&lang=en&room=story&pid=p1`, title: 'Read' } };
  const prefetches = (p) => p.head.filter((x) => x.rel === 'prefetch').map((x) => x.href);
  test('a same-origin challenge link: one <link rel=prefetch> to its menu JSON, only after idle', () => {
    const p = page(); p.mount(NX);
    expect(prefetches(p)).toEqual([]);
    p.idleQ.forEach((fn) => fn());
    expect(prefetches(p)).toEqual([`/api/wq/ch/${TOKEN}?lang=en&kid=${KID}`]);
  });
  test('Save-Data or a 2g link: nothing prefetched', () => {
    [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }].forEach((conn) => {
      const p = page({ conn }); p.mount(NX); p.idleQ.forEach((fn) => fn());
      expect(prefetches(p)).toEqual([]);
    });
  });
  test('another origin, or a quiz page (its quiz rides in the page): nothing', () => {
    ['https://elsewhere.example/c/x?kid=1', '/q/MATH01?k=a'].forEach((href) => {
      const p = page(); p.mount({ ...HOME, next: { kind: 'quiz', href, title: 'Q' } }); p.idleQ.forEach((fn) => fn());
      expect(prefetches(p)).toEqual([]);
    });
  });
});

describe('the practice home (a coach previewing the class view): by grade, nothing about a child', () => {
  const H = loadHome();
  const PR = {
    lang: 'en', practice: 1, th: { practice: true }, grade: 3, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null, brand: 'niete',
    home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: false, title: 'The red kite' }], games: [{ kind: 'numbers' }], videos: { watch: true, practice: true } },
    head: { dots: 0, today: false, jar: null }, grownups: { teacher_href: '/quiz/teacher/abc', teacher_label: 'Back to my teacher home' }, practice_back: '/quiz/teacher/abc',
  };
  test.each(['en', 'ur'])('%s: the class strip with Back, the class in the header, one primary, no banned word', (lang) => {
    const html = H.html({ ...PR, lang }, ctxOf(lang));
    expect(html).toContain('data-practice-strip');
    expect(visible(html)).toContain(H.COPY[lang].prSees);
    expect(visible(html)).toContain(H.COPY[lang].cls(3));
    expect(html).toContain('href="/quiz/teacher/abc"');
    expect(count(html, /data-primary/g)).toBe(1);
    expect(visible(html)).not.toMatch(BANNED);
    expect(visible(html)).not.toContain('Zara');
  });
  test('empty dots: none on, no today-ring; no jar', () => {
    const html = H.html(PR, ctxOf('en'));
    expect(count(html, /class="wq-dot"/g)).toBe(7);
    expect(html).not.toContain('wq-jar');
  });
  test('Urdu header: «کلاس ۳» (Urdu digit)', () => {
    expect(H.COPY.ur.cls(3)).toBe('کلاس ۳');
  });
  test('events carry kid:null and practice:1', () => {
    const p = page(); p.mount(PR);
    expect(p.evs.length).toBeGreaterThan(0);
    p.evs.forEach((e) => expect(e[1]).toMatchObject({ kid: null, practice: 1 }));
  });
});

describe('the fallback tile carries minutes and the thing\'s own art when the server has it', () => {
  const H = loadHome();
  test('the teacher\'s quiz: the subject art from its Games row, 3 minutes', () => {
    const B = { ...HOME, teacher: { code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths' }, doors: { ...DOORS_FULL, games: [{ ...DOORS_FULL.games[0], art: '/wq/art/maths.webp' }] } };
    expect(H.nextOf(B, ctxOf('en'))).toMatchObject({ art: '/wq/art/maths.webp', minutes: 3 });
    expect(H.html(B, ctxOf('en'))).toContain('src="/wq/art/maths.webp"');
  });
  test('a story from the door: 2 minutes; the numbers game: 1; Urdu minutes in Urdu digits', () => {
    const story = H.nextOf({ ...HOME, doors: { ...DOORS_FULL, games: [] } }, ctxOf('en'));
    expect(story).toMatchObject({ kind: 'story', minutes: 2 });
    const lantern = H.nextOf({ ...HOME, play: { lantern: { kind: 'numbers' } } }, ctxOf('en'));
    expect(lantern).toMatchObject({ kind: 'game', minutes: 1 });
    expect(H.html({ ...HOME, doors: { ...DOORS_FULL, games: [] } }, ctxOf('ur'))).toContain('۲ منٹ');
  });
});

describe('the grown-ups sheet: keep my place (and its Undo) live there; a bound phone is told about STOP', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const holdOpen = (p) => { const g = p.el('grownups'); g.fire('pointerdown'); jest.advanceTimersByTime(2100); return p.sheets.filter((b) => /wq-gsheet/.test(b.className))[0]; };
  test('an offer: the keep-my-place card is drawn inside the sheet, for this child', () => {
    const calls = [];
    const bind = { card: (mountEl, c) => { calls.push([mountEl, c]); return true; }, t: () => ({ noticeStopPhoneOnly: 'STOP line' }) };
    const p = page({ bind }); p.mount({ ...HOME, bind: { offer: true, hub: 'HUBTOK' } });
    const sheet = holdOpen(p);
    expect(calls).toHaveLength(1);
    expect(sheet.kids).toContain(calls[0][0]);
    expect(calls[0][1]).toMatchObject({ hub: 'HUBTOK', kid: KID, first: 'Zara', lang: 'en' });
  });
  test('already bound: the STOP line (the card\'s own words), no card', () => {
    const calls = [];
    const bind = { card: () => calls.push(1), t: () => ({ noticeStopPhoneOnly: 'A grown-up can remove this phone number any time by sending STOP on WhatsApp.' }) };
    const p = page({ bind }); p.mount({ ...HOME, bind: { offer: false, state: 'bound' } });
    const sheet = holdOpen(p);
    expect(calls).toHaveLength(0);
    expect(sheet.innerHTML).toContain('sending STOP on WhatsApp');
  });
  test('no bind on the boot: the sheet is as before', () => {
    const p = page(); p.mount(HOME);
    const sheet = holdOpen(p);
    expect(sheet.kids).toHaveLength(0);
  });
});

describe('a shared phone: the name opens "Who is playing?", with "Someone new?" when the join link came', () => {
  const H = loadHome();
  const TWO = { ...HOME, kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }, { chip: 'fedcba9876543210', first: 'Ali', animal: 'cat', grade: '2' }] };
  test('one child and no join link: the name is plain text', () => {
    expect(H.html(HOME, ctxOf('en'))).not.toContain('data-tap="who"');
  });
  test.each(['en', 'ur'])('%s: two children: the name is a button; the sheet lists both, each opening their own home', (lang) => {
    expect(H.html(TWO, ctxOf(lang))).toContain('data-tap="who"');
    const sh = H.who(TWO, ctxOf(lang));
    expect(sh).toContain(H.COPY[lang].who);
    expect(sh).toContain(`?kid=${KID}`);
    expect(sh).toContain('?kid=fedcba9876543210');
    expect(sh).not.toContain('/quiz/join/');
    expect(count(sh, /data-primary/g)).toBe(0);
    expect(visible(sh)).not.toMatch(BANNED);
  });
  test('a join token in the URL is never read (the server mints it in the boot)', () => {
    const p = page({ search: '?from=quiz&jn=eyJrIjoiaiJ9.AbC-d_e' });
    expect(p.H.html(HOME, ctxOf('en'))).not.toContain('data-tap="who"');
    expect(p.H.who(HOME, ctxOf('en'))).not.toContain('/quiz/join/');
  });
  test('the boot\'s jn: the last row "Someone new?" opens the join', () => {
    const sh = H.who({ ...HOME, jn: 'eyJrIjoiaiJ9.AbC-d_e' }, ctxOf('ur'));
    expect(sh).toContain('href="/quiz/join/eyJrIjoiaiJ9.AbC-d_e"');
    expect(visible(sh)).toContain('کوئی اور؟');
    expect(H.html({ ...HOME, jn: 'eyJrIjoiaiJ9.AbC-d_e' }, ctxOf('en'))).toContain('data-tap="who"');
    expect(H.who({ ...HOME, jn: 'bad"><script>' }, ctxOf('en'))).not.toContain('/quiz/join/');
  });
  test('the coach\'s preview never shows it', () => {
    expect(H.html({ ...TWO, practice: 1, grade: 3, kids: [], kid: null, jn: 'eyJrIjoiaiJ9.AbC' }, ctxOf('en'))).not.toContain('data-tap="who"');
  });
});

describe('the home\'s smaller fixes: the server tile\'s New tag, no prefetch in a preview, row pictures, the sheet\'s primary, tap sizes, a quiz that may not be the teacher\'s', () => {
  const H = loadHome();
  test('the server\'s `next` keeps its New tag in the page\'s language (a storybook says «نئی», a quiz «نیا»)', () => {
    const next = { kind: 'storybook', href: '/h/x#story/b1', title: 'From your teacher', title_ur: 'ٹیچر کی طرف سے', tag: 'New', tag_ur: 'نئی', sub: 'The red kite' };
    expect(H.nextOf({ ...HOME, next }, ctxOf('ur'))).toMatchObject({ tag: 'نئی' });
    expect(H.nextOf({ ...HOME, next }, ctxOf('en'))).toMatchObject({ tag: 'New' });
    expect(H.html({ ...HOME, lang: 'ur', next }, ctxOf('ur'))).toMatch(/<i class="wq-new">نئی<\/i>/);
    expect(H.nextOf({ ...HOME, next: { kind: 'video', href: '/lib/x', title: 'Watch' } }, ctxOf('en')).tag).toBeNull();
  });
  test('a teacher\'s class preview never prefetches (no child to fetch for)', () => {
    const p = page();
    p.mount({ ...HOME, practice: 1, grade: 3, kids: [], kid: null, next: { kind: 'story', href: `/c/${TOKEN}?kid=&lang=en&room=story&pid=p1`, title: 'Read' } });
    p.idleQ.forEach((fn) => fn());
    expect(p.head.filter((x) => x.rel === 'prefetch')).toEqual([]);
  });
  test('Games rows wear the picture the server sent (the quiz\'s subject), lazily', () => {
    const art = '/wq/art/maths.webp';
    const h = H.door({ ...HOME, doors: { ...DOORS_FULL, games: [{ ...DOORS_FULL.games[0], art }] } }, ctxOf('en'), 'games');
    expect(h).toMatch(/<a class="wq-row wq-rowart" data-primary data-tap="row" data-kind="quiz" href="\/q\/MATH01\?k=kk"><img class="wq-rart" src="\/wq\/art\/maths\.webp" alt="" width="48" height="48" loading="lazy"/);
  });
  test('a finished quiz with no topic says "Play a quiz" (it may not be the teacher\'s), on the tile and on its row', () => {
    const games = [{ kind: 'quiz', code: 'OPEN01', k: 'k9', topic: '', subject: '', done: false }];
    expect(H.nextOf({ ...HOME, teacher: null, doors: { ...DOORS_EMPTY, games } }, ctxOf('en'))).toMatchObject({ title: 'Play a quiz' });
    expect(H.nextOf({ ...HOME, teacher: null, doors: { ...DOORS_EMPTY, games } }, ctxOf('ur'))).toMatchObject({ title: 'کوئز کھیلیں' });
    const again = H.door({ ...HOME, doors: { ...DOORS_EMPTY, games: [{ ...games[0], done: true }] } }, ctxOf('en'), 'games');
    expect(visible(again)).toContain('Play a quiz');
    expect(visible(again)).not.toContain("Your teacher's quiz");
  });
  test('tap targets are at least 48 px: Jugnu, the name button, the grown-ups pill', () => {
    const css = fs.readFileSync(CSS_SRC, 'utf8');
    expect(css).toMatch(/\.wq-hjug\{[^}]*width:48px;height:48px/);
    expect(css).toMatch(/\.wq-hname\{[^}]*min-height:48px/);
    expect(css).toMatch(/\.wq-gbtn\{[^}]*min-height:48px/);
    expect(H.html(HOME, ctxOf('en'))).toMatch(/class="wq-hjug"[^>]*width="48" height="48"/);
  });
});

describe('the grown-ups sheet\'s language button is its primary and looks like one', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('class wq-btn wq-go (a filled button, not a bare link)', () => {
    const p = page(); p.mount(HOME);
    const g = p.el('grownups'); g.fire('pointerdown'); jest.advanceTimersByTime(2100);
    const sheet = p.sheets.filter((b) => /wq-gsheet/.test(b.className))[0];
    expect(sheet.innerHTML).toMatch(/<a class="wq-btn wq-go" data-primary data-tap="lang"/);
  });
  test('its link asks the server to keep the language for this child (keep=1; the server ignores it while that is off)', () => {
    const p = page(); p.mount(HOME);
    const g = p.el('grownups'); g.fire('pointerdown'); jest.advanceTimersByTime(2100);
    const sheet = p.sheets.filter((b) => /wq-gsheet/.test(b.className))[0];
    const href = /data-tap="lang" href="([^"]*)"/.exec(sheet.innerHTML)[1].replace(/&amp;/g, '&');
    expect(href).toMatch(/^\/h\/[^?]*\?kid=[^&]*(&lang=(en|ur))?&keep=1$/);
  });
});

describe('keep my place by the server\'s bind.state (none|pending|bound|refused; ABSENT = today\'s card, never "bound")', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const open = (bindPayload) => {
    const calls = [];
    const bind = { card: () => { calls.push(1); return true; }, t: () => ({ noticeStopPhoneOnly: 'STOP line' }) };
    const p = page({ bind }); p.mount({ ...HOME, bind: bindPayload });
    p.el('grownups').fire('pointerdown'); jest.advanceTimersByTime(2100);
    const sheet = p.sheets.filter((b) => /wq-gsheet/.test(b.className))[0];
    return { card: calls.length, stop: /STOP line/.test(sheet.innerHTML) };
  };
  test.each([
    ['no state (no device ref, or a failed read): the card', { offer: true, hub: 'H' }, { card: 1, stop: false }],
    ['none: the card', { offer: true, hub: 'H', state: 'none' }, { card: 1, stop: false }],
    ['pending: the card (it shows its own waiting line)', { offer: true, hub: 'H', state: 'pending' }, { card: 1, stop: false }],
    ['bound: no card, the STOP line', { offer: false, state: 'bound' }, { card: 0, stop: true }],
    ['refused: no card, no STOP line', { offer: false, state: 'refused' }, { card: 0, stop: false }],
  ])('%s', (_, b, want) => { expect(open(b)).toEqual(want); });
});

// ---- the screenshot pass ----------------------------------------------------------------------------
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const homeRules = (selRx) => [...fs.readFileSync(CSS_SRC, 'utf8').matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => selRx.test(m[1])).map((m) => m[2]).join(';');

describe('the grown-ups sheet: contrast, Nastaliq links, and nothing else reachable behind it', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('the language button: label/fill contrast is at least 4.5:1, both colours set on the sheet rule', () => {
    const d = homeRules(/\.wq-gsheet \.wq-go\s*$/);
    const bg = /background:\s*(#[0-9a-fA-F]{6})/.exec(d); const fg = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})/.exec(d);
    expect(bg && fg).toBeTruthy();
    expect(ratio(bg[1], fg[1])).toBeGreaterThanOrEqual(4.5);
  });
  test('Urdu sheet links: no underline through the Nastaliq; a border-bottom and a 48 px tap instead', () => {
    const d = homeRules(/html\[lang=ur\] \.wq-gsheet \.wq-ghost\s*$/);
    expect(d).toMatch(/text-decoration:\s*none/);
    expect(d).toMatch(/border-bottom:\s*2px solid/);
    expect(d).toMatch(/min-height:\s*(4[89]|[5-9]\d)px/);
  });
  test('open sheet: the home behind it is inert + aria-hidden (so one primary is reachable); closing restores it', () => {
    const p = page(); p.mount(HOME);
    const mk = (cls) => { const a = {}; return { className: cls, attrs: a, setAttribute(k, v) { a[k] = v; }, removeAttribute(k) { delete a[k]; }, hasAttribute: (k) => k in a }; };
    const home = mk('wq-home'); const bar = mk('wq-doors');
    p.root.children = [home, bar];
    const g = p.el('grownups'); g.fire('pointerdown'); jest.advanceTimersByTime(2100);
    const sheet = p.sheets.filter((b) => /wq-gsheet/.test(b.className))[0];
    for (const n of [home, bar]) { expect(n.attrs.inert).toBeDefined(); expect(n.attrs['aria-hidden']).toBe('true'); }
    expect(sheet.attrs.inert).toBeUndefined();
    expect(sheet.innerHTML.match(/data-primary/g)).toHaveLength(1);
    sheet.closeFns.forEach((fn) => fn({ preventDefault() {} }));
    expect(p.sheets).toHaveLength(0);
    for (const n of [home, bar]) { expect(n.attrs.inert).toBeUndefined(); expect(n.attrs['aria-hidden']).toBeUndefined(); }
  });
});

describe('the preview that PLAYS (the boot\'s practice_play): the Next tile and a home row open, the class strip stays', () => {
  const PR = {
    lang: 'en', practice: 1, th: { practice: true }, grade: 3, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: { on: true }, lib: null, brand: 'niete',
    home_v3: 1, doors: { stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: false, title: 'The red kite' }, { kind: 'shelf' }], games: [{ kind: 'numbers' }], videos: { watch: true, practice: true } },
    head: { dots: 0, today: false, jar: null }, practice_back: '/quiz/teacher/abc',
  };
  // a home whose root hands out the one tile to tap (the vm has no DOM)
  function tapHome(B) {
    const l = {};
    const tile = {
      attrs: { 'data-tap': 'next', href: `/c/${TOKEN}?kid=&lang=en&room=story&pid=en.read.1.k07`, 'data-kind': 'story' },
      getAttribute(a) { return this.attrs[a] == null ? null : this.attrs[a]; },
      addEventListener(n, fn) { (l[n] = l[n] || []).push(fn); },
    };
    const sheets = [];
    const root = { innerHTML: '', setAttribute() {}, querySelector: () => null, querySelectorAll: (sel) => (sel === '[data-tap]' ? [tile] : []), appendChild: (b) => sheets.push(b), removeChild() {} };
    const win = { addEventListener() {}, scrollTo() {} };
    const document = { querySelector: () => null, createElement: () => ({ className: '', attrs: {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, appendChild() {}, innerHTML: '' }), head: { appendChild() {} } };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, navigator: {}, location: { hash: '', pathname: '/h/x', search: '' }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent, RegExp });
    const go = jest.fn();
    win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev() {}, go });
    let prevented = false;
    (l.click || []).forEach((fn) => fn({ preventDefault() { prevented = true; } }));
    return { go, sheets, prevented, html: root.innerHTML };
  }
  test('practice_play: the Next tile (Jugnu\'s read-along) opens the story room; no "children open it" sheet', () => {
    const r = tapHome({ ...PR, practice_play: 1 });
    expect(r.go).toHaveBeenCalledWith(`/c/${TOKEN}?kid=&lang=en&room=story&pid=en.read.1.k07`, 'next');
    expect(r.sheets.filter((b) => /wq-prnote/.test(b.className))).toEqual([]);
    expect(r.html).toContain('data-practice-strip');
  });
  test('GOLDEN: a look-only preview (no practice_play) still says where the class opens it, and goes nowhere', () => {
    const r = tapHome(PR);
    expect(r.go).not.toHaveBeenCalled();
    expect(r.prevented).toBe(true);
    expect(r.sheets.filter((b) => /wq-prnote/.test(b.className))).toHaveLength(1);
  });
});
