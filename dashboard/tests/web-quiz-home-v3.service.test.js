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

// jugnu-org COPY.md §D + the v3 words (IA.md §0) + the test words: never on a child's screen.
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
    // No count about the child: the jar has no number, the dots have no digits.
    expect(visible(html)).not.toMatch(/[0-9۰-۹]/);
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
    expect(html).toContain('لال پتنگ</bdi>، ۲ منٹ');
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
    const full = H.door(HOME, ctxOf('en'), d);
    expect(full).not.toContain('data-soon');
    expect(count(full, /data-primary/g)).toBe(1);
  });
  test('Games: the teacher quiz opens the quiz; a done quiz opens Play again; no score shown', () => {
    const html = H.door(HOME, ctxOf('en'), 'games');
    expect(html).toContain('href="/q/MATH01?k=kk"');
    expect(html).toContain('href="/q/SCI001?again=1&amp;k=k2"');
    expect(visible(html)).not.toMatch(/\d+\s*\/\s*\d+/);
  });
  test('Stories: a passage opens the story room; the shelf stub is a slot for the stories reader', () => {
    const html = H.door({ ...HOME, doors: { ...DOORS_FULL, stories: [...DOORS_FULL.stories, { kind: 'shelf' }] } }, ctxOf('en'), 'stories');
    expect(html).toContain('&amp;room=story&amp;pid=en.read.1.k07');
    expect(html).toContain('data-shelf="1"');
  });
  test('Stories: a listening story asks the story room for a listen (&ex=listen), a read story does not', () => {
    const html = H.door(HOME, ctxOf('en'), 'stories');
    expect(html).toContain('pid=en.listen.1.k02&amp;ex=listen');
    expect(html).not.toContain('pid=en.read.1.k07&amp;ex=listen');
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
  test('next absent: today\'s lantern decides — the same story and the same destination as the lantern line', () => {
    const B = { ...HOME, play: { lantern: { kind: 'story', title: 'The red kite', pid: 'en.read.1.k07' } } };
    const nx = H.nextOf(B, ctxOf('en'));
    expect(nx).toMatchObject({ kind: 'story', title: 'Read a story with Jugnu', sub: 'The red kite', src: 'lantern' });
    expect(nx.href).toBe(`/c/${encodeURIComponent(TOKEN)}?kid=${KID}&room=story&pid=en.read.1.k07`);
    const trail = H.nextOf({ ...HOME, play: { lantern: { kind: 'trail', stops: 2 } } }, ctxOf('en'));
    expect(trail).toMatchObject({ kind: 'game', href: `/c/${encodeURIComponent(TOKEN)}?kid=${KID}`, src: 'lantern' });
    expect(trail.title).not.toMatch(BANNED);
  });
  test('nothing at all: one Next element still, with no link', () => {
    const html = H.html({ ...HUB, home_v3: 1, doors: DOORS_EMPTY, head: { dots: 0, today: false, jar: null } }, ctxOf('en'));
    expect(count(html, /class="wq-next[ "]/g)).toBe(1);
    expect(html).toContain('data-kind="none"');
  });
});

describe('wq-home.js: mount loads the stories reader only when the server says stories are on', () => {
  function mountWith(B, hash) {
    const head = [];
    const root = { innerHTML: '', setAttribute() {}, querySelector: (sel) => (sel === '[data-shelf]' && /data-shelf/.test(root.innerHTML) ? {} : null), querySelectorAll: () => [], appendChild() {} };
    const win = { addEventListener() {}, scrollTo() {} };
    const document = {
      querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
      createElement: (tag) => ({ tag, addEventListener() {} }), head: { appendChild: (el) => head.push(el) },
    };
    vm.runInNewContext(fs.readFileSync(HOME_SRC, 'utf8'), { window: win, document, location: { hash }, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, JSON, Math, String, Number, Array, Object, encodeURIComponent });
    win.WQHOME.mount(root, B, { token: TOKEN, lang: 'en', ev() {} });
    return head.map((e) => e.src || e.href);
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
  test('off (no home_v3): today\'s hub, never mounted, nothing loaded', () => {
    const seen = [];
    const r = runHub({ ...HUB, brand: null, token: TOKEN }, { mount: () => seen.push(1) });
    expect(seen).toHaveLength(0);
    expect(r.head).toHaveLength(0);
    expect(r.html).toContain('wq-hub');
  });
});
