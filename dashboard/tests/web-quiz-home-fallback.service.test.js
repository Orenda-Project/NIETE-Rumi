/**
 * The v3 child home when its script does not arrive (web_quiz_home_fallback_v3, the bot's `home_fb` on the hub JSON):
 * hub.js asks for wq-home.js again ONCE, at the same address, 1.5 s later; if that fails too it draws a plain home from
 * the boot it already holds — the greeting as the v3 home says it, the three doors as plain links (Stories, Games,
 * Videos, the bar's words and order) and one line that reloads the page — and never today's hub or any of its words.
 * Golden: without `home_fb` a failed load draws today's hub, string-equal to the base (fixture recorded from the base
 * hub.js); without `home_v3` nothing changes. The shipped hub.js run in a vm. Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const KID = '0123456789abcdef';
const HUB = {
  lang: 'en', kids: [{ chip: KID, first: 'Zara', animal: 'owl', grade: '3' }], kid: KID,
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: { href: `/lib/${TOKEN}?kid=${KID}` }, rt: false, brand: null, token: TOKEN,
};
const DOORS = {
  stories: [{ kind: 'passage', id: 'en.read.1.k07', fresh: true, title: 'The red kite' }, { kind: 'shelf' }],
  games: [{ kind: 'quiz', code: 'MATH01', k: 'kk', topic: 'Fractions', subject: 'Maths', done: false, from: 'teacher' }, { kind: 'numbers' }],
  videos: { href: `/lib/${TOKEN}?kid=${KID}&l=en` },
};
const HOME = { ...HUB, home_v3: 1, doors: DOORS, head: { dots: 2, today: false, jar: null } };
const FB = { ...HOME, home_fb: 1 };
const HUB_SRC = path.join(__dirname, '..', 'public', 'wq', 'hub.js');
const GOLDEN = path.join(__dirname, 'fixtures', 'home-fallback-off-golden.json');

// Today's hub words and tiles, in both languages: none of them on the plain home.
const OLD_HUB = /trail|challenge|today|keep (my|your) place|what shall we do|راستہ|راستے|چیلنج|آج کیا کریں|wq-htile|wq-hcard|wq-bind-slot/i;
const BANNED = /\b(test|tests|exam|assess\w*|wrong|practice|counted|story time)\b|امتحان|ٹیسٹ|غلط/i;
const visible = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function runHub(boot, { home = null, hash = '' } = {}) {
  const clicks = {};
  const root = {
    _h: '', _m: null, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; },
    setAttribute(k, v) { if (k === 'data-m') this._m = v; }, getAttribute(k) { return k === 'data-m' ? this._m : null; },
    querySelector: (sel) => ({ addEventListener(n, fn) { clicks[sel] = fn; }, getAttribute: () => null }),
    querySelectorAll: () => [], appendChild() {},
  };
  const win = { scrollTo() {}, addEventListener() {} };
  if (home) win.WQHOME = home;
  const head = [];
  const timers = [];
  const beacons = [];
  const loc = { search: '', protocol: 'https:', hash, reloads: 0, reload() { this.reloads += 1; } };
  const document = {
    documentElement: { setAttribute() {}, classList: { toggle() {} } }, cookie: '',
    getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null),
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => ({ tag, l: {}, addEventListener(n, fn) { this.l[n] = fn; } }),
    head: { appendChild: (el) => { head.push(el); } },
  };
  function Blob(parts) { this.parts = parts; }
  vm.runInNewContext(fs.readFileSync(HUB_SRC, 'utf8'), {
    window: win, document, history: { replaceState() {} }, location: loc, Blob,
    navigator: { sendBeacon: (u, b) => { JSON.parse(b.parts[0]).events.forEach((e) => beacons.push(e)); return true; } },
    localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  });
  const scripts = () => head.filter((e) => e.tag === 'script' && /wq-home\.js/.test(e.src || ''));
  return { root, head, win, timers, beacons, loc, clicks, scripts };
}
// wq-home.js fails, and fails again: both of hub.js's asks error.
function failTwice(r) {
  r.scripts()[0].l.error();
  r.timers.filter((t) => t.ms === 1500).forEach((t) => t.fn());
  const s = r.scripts();
  if (s.length > 1) s[1].l.error();
}

describe('on (home_v3 + home_fb): wq-home.js fails', () => {
  test('one retry of the same address after 1.5 s, never a second css, never today\'s hub meanwhile', () => {
    const r = runHub(FB);
    expect(r.scripts().map((e) => e.src)).toEqual(['/wq/wq-home.js?v=abc123']);
    r.scripts()[0].l.error();
    expect(r.root.innerHTML).toBe('');
    expect(r.timers.filter((t) => t.ms === 1500)).toHaveLength(1);
    r.timers.filter((t) => t.ms === 1500)[0].fn();
    expect(r.scripts().map((e) => e.src)).toEqual(['/wq/wq-home.js?v=abc123', '/wq/wq-home.js?v=abc123']);
    expect(r.head.filter((e) => /wq-home\.css/.test(e.href || ''))).toHaveLength(1);
  });
  test('the retry arrives: the v3 home is mounted as normal', () => {
    const seen = [];
    const r = runHub(FB);
    r.scripts()[0].l.error();
    r.timers.filter((t) => t.ms === 1500)[0].fn();
    r.win.WQHOME = { mount: (root, B, ctx) => seen.push([B.kid, ctx.token, ctx.lang]) };
    r.scripts()[1].l.load();
    expect(seen).toEqual([[KID, TOKEN, 'en']]);
    expect(r.root.innerHTML).toBe('');
  });
  test.each([
    ['en', 'Hi Zara!', ['Stories', 'Games', 'Videos'], 'The page is still opening… tap here to try again.'],
    ['ur', 'السلام علیکم', ['کہانیاں', 'کھیل', 'ویڈیوز'], 'دوبارہ کوشش'],
  ])('%s: the second failure draws the plain home: greeting, three door links in bar order, the retry line', (lang, hi, doors, retry) => {
    const r = runHub({ ...FB, lang });
    failTwice(r);
    const html = r.root.innerHTML;
    expect(r.scripts()).toHaveLength(2);
    expect(r.timers.filter((t) => t.ms === 1500)).toHaveLength(1);
    expect(html).toContain('data-m="H3-fb"');
    expect(html).toContain(hi);
    const links = html.match(/<a class="[^"]*wq-fbdoor[^"]*"[^>]*>[\s\S]*?<\/a>/g) || [];
    expect(links.map((a) => visible(a).trim())).toEqual(doors);
    expect(html).toContain(retry);
    expect((html.match(/data-primary/g) || []).length).toBe(1);
  });
  test.each(['en', 'ur'])('%s: 0 words or tiles of today\'s hub, 0 banned words', (lang) => {
    const r = runHub({ ...FB, lang, bind: { offer: true }, play: { on: true }, teacher: { code: 'MATH01', topic: 'Fractions', k: 'kk' } });
    failTwice(r);
    expect(visible(r.root.innerHTML)).not.toMatch(OLD_HUB);
    expect(r.root.innerHTML).not.toMatch(OLD_HUB);
    expect(visible(r.root.innerHTML)).not.toMatch(BANNED);
    // and today's hub's scripts are never asked for
    expect(r.head.filter((e) => /hub-play|wq-bind|wq-book/.test(e.src || e.href || ''))).toHaveLength(0);
  });
  test('the doors open from the payload: Games -> its first row, Videos -> the library, Stories -> this home at #stories', () => {
    const r = runHub(FB);
    failTwice(r);
    const href = (d) => (new RegExp('data-door="' + d + '"[^>]*href="([^"]*)"').exec(r.root.innerHTML) || new RegExp('href="([^"]*)"[^>]*data-door="' + d + '"').exec(r.root.innerHTML) || [])[1];
    expect(href('games')).toBe('/q/MATH01?k=kk');
    expect(href('videos')).toBe(`/lib/${TOKEN}?kid=${KID}&amp;l=en`);
    expect(href('stories')).toBe('#stories');
  });
  test('a tap on the retry line (or a hash door) reloads the page; the failures are counted once each', () => {
    const r = runHub(FB);
    failTwice(r);
    const ev = { preventDefault() {} };
    r.clicks['#wq-fb-retry'](ev);
    expect(r.loc.reloads).toBe(1);
    expect(r.beacons.filter((e) => e.n === 'home_load_failed').map((e) => [e.file, e.i])).toEqual([['wq-home.js', 1], ['wq-home.js', 2]]);
  });
  test('a stalled ask (no load, no error) counts as a failure after 5 s; the retry stalls too -> the plain home', () => {
    const r = runHub(FB);
    const fire = (ms) => { const t = r.timers.filter((x) => x.ms === ms && !x.done); t.forEach((x) => { x.done = true; x.fn(); }); return t.length; };
    expect(fire(5000)).toBe(1);
    expect(r.root.innerHTML).toBe('');
    expect(fire(1500)).toBe(1);
    expect(r.scripts()).toHaveLength(2);
    expect(fire(5000)).toBe(1);
    expect(r.root.innerHTML).toContain('data-m="H3-fb"');
    // a late error from the first ask is not a third failure
    r.scripts()[0].l.error();
    expect(r.beacons.filter((e) => e.n === 'home_load_failed')).toHaveLength(2);
    expect(r.scripts()).toHaveLength(2);
  });
  test('the script arrives late, after the plain home: the v3 home replaces it', () => {
    const seen = [];
    const r = runHub(FB);
    failTwice(r);
    expect(r.root.innerHTML).toContain('H3-fb');
    r.win.WQHOME = { mount: (root, B) => { seen.push(B.kid); root.innerHTML = 'V3'; } };
    r.scripts()[1].l.load();
    expect(seen).toEqual([KID]);
    expect(r.root.innerHTML).toBe('V3');
  });
  // A slow line: the home is mounted at most once per page, whichever ask arrives (and however many do). Each arrival is a
  // fresh run of wq-home.js (its own module, its own hashchange wiring); its mount sends home_view.
  function slow() {
    const r = runHub(FB);
    let mounts = 0;
    const fire = (ms) => { const t = r.timers.filter((x) => x.ms === ms && !x.done); t.forEach((x) => { x.done = true; x.fn(); }); return t.length; };
    const arrive = (i) => { r.win.WQHOME = { mount: (root, B, ctx) => { mounts += 1; ctx.ev('home_view', { src: 'link' }); } }; r.scripts()[i].l.load(); };
    const seen = () => ({ tags: r.scripts().length, mounts, home_view: r.beacons.filter((e) => e.n === 'home_view').length });
    return { r, fire, arrive, seen };
  }
  test('a stalled ask whose script then arrives late: no second ask, one home, one home_view', () => {
    const { r, fire, arrive, seen } = slow();
    expect(fire(5000)).toBe(1);
    arrive(0);
    fire(1500);
    r.scripts().slice(1).forEach((s) => s.l.load());
    expect(seen()).toEqual({ tags: 1, mounts: 1, home_view: 1 });
    expect(r.root.innerHTML).not.toContain('H3-fb');
  });
  test('the retry already sent, then both scripts arrive: one home, one home_view', () => {
    const { r, fire, arrive, seen } = slow();
    expect(fire(5000)).toBe(1);
    expect(fire(1500)).toBe(1);
    expect(r.scripts()).toHaveLength(2);
    arrive(0);
    arrive(1);
    fire(5000);
    expect(seen()).toEqual({ tags: 2, mounts: 1, home_view: 1 });
    expect(r.root.innerHTML).not.toContain('H3-fb');
  });
  test('an empty boot (no doors at all): three links still, each back to this home at its door', () => {
    const r = runHub({ ...FB, doors: { stories: [], games: [], videos: null } });
    failTwice(r);
    ['stories', 'games', 'videos'].forEach((d) => expect(r.root.innerHTML).toContain('href="#' + d + '"'));
  });
});

describe('GOLDEN: off', () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  test.each(['en', 'ur'])('%s: home_v3 without home_fb -> a failed load draws today\'s hub at once, string-equal to the base', (lang) => {
    const r = runHub({ ...HOME, lang });
    expect(r.scripts()).toHaveLength(1);
    r.scripts()[0].l.error();
    expect(r.timers.filter((t) => t.ms === 1500 || t.ms === 5000)).toHaveLength(0);
    expect(r.root.innerHTML).toBe(golden[lang]);
    expect(r.beacons.filter((e) => e.n === 'home_load_failed')).toHaveLength(0);
  });
  test('home_fb without home_v3 -> today\'s hub, nothing loaded, never the plain home', () => {
    const r = runHub({ ...HUB, home_fb: 1 });
    expect(r.scripts()).toHaveLength(0);
    expect(r.root.innerHTML).toBe(golden.nohome);
    expect(r.root.innerHTML).not.toContain('H3-fb');
  });
});
