/**
 * The kid hub page script (public/wq/hub.js), run whole in a vm with a small fake DOM:
 * the boot JSON and the bot API (fetch) are the faked boundaries, the script is the
 * shipped file. Covers the copy (gender-neutral Urdu), the sibling pick and its
 * failures, a page restored from the back/forward cache, and robustness to a sparse row.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

function page(boot, { api = {}, store = {}, search = '' } = {}) {
  const beacons = [];
  const els = {};
  const winL = {};
  const assigned = [];
  let reloaded = 0;
  const el = (sel) => (els[sel] = els[sel] || { sel, listeners: {}, attrs: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); }, fire(n, e) { (this.listeners[n] || []).forEach((fn) => fn(e || { preventDefault() {} })); }, getAttribute(k) { return this.attrs[k]; } });
  const root = {
    _h: '', attrs: {},
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      // Every element with an id or a data-* hook becomes a fake element the test can tap.
      for (const m of h.matchAll(/<(?:a|button)\b([^>]*)>/g)) {
        const id = /id="([^"]+)"/.exec(m[1]);
        const href = /href="([^"]+)"/.exec(m[1]);
        const data = /data-(chip|again|rec)="([^"]+)"/.exec(m[1]);
        const sel = id ? `#${id[1]}` : data ? `[data-${data[1]}="${data[2]}"]` : null;
        if (!sel) continue;
        const e = el(sel);
        if (href) e.attrs.href = href[1].replace(/&amp;/g, '&');
        if (data) e.attrs[`data-${data[1]}`] = data[2];
      }
    },
    get innerHTML() { return this._h; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(t) { toasts.push(t.textContent); },
    querySelector(sel) { return els[sel] || null; },
    querySelectorAll(sel) { const k = sel.replace(/^\[|\]$/g, ''); return Object.values(els).filter((e) => e.attrs[k] !== undefined); },
  };
  const toasts = [];
  const fetches = [];
  const cookies = [];
  const docEl = { attrs: { lang: boot && boot.lang === 'ur' ? 'ur' : 'en', dir: boot && boot.lang === 'ur' ? 'rtl' : 'ltr' }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } };
  const ctx = {
    document: { documentElement: docEl, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, textContent: '' }),
      set cookie(v) { cookies.push(v); }, get cookie() { return cookies.join('; '); } },
    window: { scrollTo() {}, addEventListener(n, fn) { (winL[n] = winL[n] || []).push(fn); } },
    navigator: { sendBeacon: (u, b) => { beacons.push(...JSON.parse(b.parts[0]).events); return true; } },
    history: { replaceState() {} },
    location: { search, assign(u) { assigned.push(u); }, reload() { reloaded += 1; } },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: (url, init) => {
      fetches.push({ url, init });
      const hit = Object.keys(api).find((k) => url.indexOf(k) >= 0);
      const r = hit ? api[hit] : {};
      const status = (r && r.__status) || 200;
      return Promise.resolve({ status, ok: status < 300, text: () => Promise.resolve(JSON.stringify(r)) });
    },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  // wqt: the page-session telemetry (wq-tel.js) as the page sees it, when a test turns it on.
  if (arguments[1] && arguments[1].wqt) ctx.window.WQT = arguments[1].wqt;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { beacons, doc: docEl.attrs, cookies, store, root, els, toasts, fetches, assigned, html: () => root._h, moment: () => root.attrs['data-m'], win: winL, reloads: () => reloaded };
}

const KIDS = [{ chip: '0000000000000001', first: 'ثنا', animal: 'owl', grade: '3' }, { chip: '0000000000000002', first: 'بلال', animal: 'lion', grade: '5' }];
const TOKEN = 'eyJrIjoiaCJ9.AbCdEfGhIjKlMnOpQrStUv';
const BR = { mascot: { en: 'Jugnu', ur: 'جگنو' }, label: { en: 'NIETE', ur: 'NIETE' }, sub: { en: 'FOR STUDENTS', ur: 'FOR STUDENTS' }, name: 'NIETE', mark: { tile: true, svg: '' } };
const boot = (extra = {}) => ({ lang: 'ur', token: TOKEN, brand: BR, kids: KIDS, kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, ...extra });

describe('page-session telemetry (wq-tel.js) on', () => {
  const tel = () => { const pushed = []; return { pushed, wqt: { on: true, push: (e) => { pushed.push(e); return true; } } }; };
  test("the hub's own events go through wq-tel's queue, not the hub's beacon", () => {
    const t = tel();
    const p = page(boot({ kid: KIDS[0].chip }), { wqt: t.wqt });
    expect(t.pushed.map((e) => e.n)).toContain('hub_view');
    expect(t.pushed.find((e) => e.n === 'hub_view')).toMatchObject({ lang: 'ur', src: 'hub' });
    expect(p.beacons.filter((e) => e.n === 'hub_view')).toEqual([]);
  });
  test('switched off (push says no): the hub sends its own beacon as before', () => {
    const p = page(boot({ kid: KIDS[0].chip }), { wqt: { on: false, push: () => false } });
    expect(p.beacons.filter((e) => e.n === 'hub_view')).toHaveLength(1);
  });
});


test('Urdu "who is playing" is gender-neutral: «کس کی باری ہے؟», never the masculine «کون کھیل رہا ہے؟»', () => {
  const p = page(boot());
  expect(p.moment()).toBe('H1');
  expect(p.html()).toContain('کس کی باری ہے؟');
  expect(p.html()).not.toContain('رہا');
});

test('a sibling pick whose hub link has expired (401) reloads, so the server shows the closed page, never "No internet"', async () => {
  const p = page(boot(), { api: { '/api/wq/hub/': { __status: 401, error: 'bad_token' } } });
  p.els['[data-chip="0000000000000001"]'].fire('click');
  await flush(); await flush();
  expect(p.reloads()).toBe(1);
  expect(p.toasts).toEqual([]);
});

test('a page restored from the back/forward cache after a recommendation tap is live again (not stuck on "Opening…")', async () => {
  const rec = { vid: 'v1', title: 'Quarters', chapter: 'Fractions', subject: 'Maths', grade: '3' };
  const p = page(boot({ kids: [KIDS[0]], kid: KIDS[0].chip, recs: [rec] }), { api: { '/videos/start': { code: 'ABC123', k: 'k1' } } });
  p.els['[data-rec="0"]'].fire('click');
  await flush(); await flush();
  expect(p.assigned).toEqual(['/q/ABC123?k=k1']);
  expect(p.moment()).toBe('H2-go');
  (p.win.pageshow || []).forEach((fn) => fn({ persisted: true }));
  expect(p.moment()).toBe('H2');
  p.els['[data-rec="0"]'].fire('click');
  await flush(); await flush();
  expect(p.assigned).toHaveLength(2);
});

test('a play-again row without a best score still renders; every quiz link is URL-encoded', () => {
  const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip,
    teacher: { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', sent_at: new Date().toISOString(), k: 'a+b/c' },
    again: [{ code: 'MATH01', topic: 'Fractions', subject: 'Maths', tries: 1, last_at: '', k: 'x y' }] }));
  expect(p.moment()).toBe('H2');
  expect(p.els['[data-again="0"]'].attrs.href).toBe('/q/MATH01?again=1&k=x%20y');
  expect(p.els['#wq-h-teacher'].attrs.href).toBe('/q/NEWQ01?k=a%2Bb%2Fc');
});

test('Urdu: the "sent N days ago" count is isolated, so the number keeps its place', () => {
  const p = page(boot({ kids: [KIDS[0]], kid: KIDS[0].chip,
    teacher: { code: 'NEWQ01', topic: 'اشکال', subject: 'maths', sent_at: new Date(Date.now() - 3 * 86400000).toISOString(), k: 'k' } }));
  expect(p.html()).toMatch(/<bdi>3<\/bdi> دن پہلے بھیجا گیا/);
});

/* ---------------- a forwarded hub link names nobody (the server binds the link to the first phone) ---------------- */
const LOCKED = (extra = {}) => ({ lang: 'en', token: TOKEN, brand: BR, locked: true, kids: [], kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, ...extra });
const DEV = 'DevRefDevRefDevRef_-01';

test('server render (no device): the page asks the bot again WITH this phone\'s device_ref (body, not URL), then shows its children', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0);
  expect(call.init.method).toBe('POST');
  expect(call.url).not.toContain(DEV);
  expect(JSON.parse(call.init.body)).toMatchObject({ device_ref: DEV });
  expect(p.moment()).toBe('H2');
  expect(p.html()).toContain('ثنا');
});

test('a phone with no device_ref yet mints one (22 url-safe chars), keeps it where the quiz page reads it, and sends it', async () => {
  const p = page(LOCKED(), { api: { '/api/wq/hub/': LOCKED() } });
  await flush(); await flush();
  const sent = JSON.parse(p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0).init.body).device_ref;
  expect(sent).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(JSON.parse(p.store.wq_d)).toBe(sent);
});

test('another phone (still locked): NO name, the neutral "ask the child" screen, and a "someone else / new player" path', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED() } });
  await flush(); await flush();
  expect(p.moment()).toBe('H-lock');
  expect(p.html()).toContain('Ask the child this link was sent to to open it');
  // the family's own other phone / browser is never stuck for 7 days: a fresh /quiz mints a fresh link
  expect(p.html()).toContain('Is this your link? Send /quiz on WhatsApp again for a new one.');
  expect(p.html()).not.toMatch(/ثنا|بلال|data-chip|\/q\//);
  p.els['#wq-h-new'].fire('click');
  expect(p.moment()).toBe('H-new');
  expect(p.html()).toContain('/quiz');
  expect(p.assigned).toEqual([]);
});

test('Urdu lock screen: gender-neutral (no «رہا/رہی», no «بیٹا/بیٹی»), the same two moments', async () => {
  const p = page(LOCKED({ lang: 'ur' }), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED({ lang: 'ur' }) } });
  await flush(); await flush();
  expect(p.moment()).toBe('H-lock');
  expect(p.html()).toContain('نیا لنک لینے کے لیے واٹس ایپ پر دوبارہ');
  expect(p.html()).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
  p.els['#wq-h-new'].fire('click');
  expect(p.html()).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
});

test('a sibling pick also carries the device_ref, in the body', async () => {
  const p = page(boot(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'ur', kids: KIDS, kid: KIDS[1].chip } } });
  p.els['[data-chip="0000000000000002"]'].fire('click');
  await flush(); await flush();
  const call = p.fetches.find((f) => f.url.indexOf('/api/wq/hub/') === 0);
  expect(call.init.method).toBe('POST');
  expect(JSON.parse(call.init.body)).toEqual({ kid: KIDS[1].chip, device_ref: DEV });
  expect(p.moment()).toBe('H2');
});

test('the phone\'s device_ref is also written to the wq_dv cookie (path /, 30 days, Lax), so the challenge and library pages carry it', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED() } });
  await flush();
  const c = p.cookies.find((x) => x.indexOf('wq_dv=') === 0);
  expect(c).toBeDefined();
  expect(c).toContain('wq_dv=' + DEV);
  expect(c).toMatch(/path=\//);
  expect(c).toMatch(/max-age=2592000/);
  expect(c).toMatch(/samesite=lax/i);
});

test('subject art: a play-again row, a recommendation without a poster and the library tile show the picture, not the emoji', () => {
  const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip,
    teacher: { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', sent_at: new Date().toISOString(), k: 'k' },
    lib: { href: '/lib/t?kid=c&l=en', art: '/wq/art/grade-3-1.webp' },
    again: [{ code: 'MATH01', topic: 'Fractions', subject: 'Maths', tries: 1, best: { c: 1, t: 2 }, k: 'k', art: '/wq/art/subject-maths-1.webp' }],
    recs: [{ vid: 'v1', title: 'Leaves', chapter: 'Plants', subject: 'Science', grade: '3', art: '/wq/art/subject-science-1.webp' }] }));
  const h = p.html();
  expect(h).toContain('<img class="wq-vtile" src="/wq/art/subject-maths-1.webp"');
  expect(h).toContain('<img class="wq-vtile" src="/wq/art/subject-science-1.webp"');
  expect(h).toContain('<img class="wq-htimg" src="/wq/art/grade-3-1.webp"');
  expect(h).not.toContain('➗');
});

/* ---------------- a sibling pick renders in THAT child's language, not the boot language ---------------- */
test('boot Urdu, pick a sibling whose hub is English: the hub, <html lang> and dir switch to English / ltr', async () => {
  const p = page(boot({ lang: 'ur' }), { store: { wq_d: JSON.stringify(DEV) },
    api: { '/api/wq/hub/': { lang: 'en', kids: KIDS, kid: KIDS[0].chip, teacher: null, again: [], recs: [], challenge: { on: true }, lib: { href: '/lib/t?kid=c&l=en' } } } });
  expect(p.html()).toContain('کس کی باری ہے؟');
  p.els['[data-chip="0000000000000001"]'].fire('click');
  await flush(); await flush();
  expect(p.moment()).toBe('H2');
  expect(p.html()).toContain('Hi ثنا! What shall we do today?');
  expect(p.html()).toContain('Switch player');
  expect(p.html()).not.toMatch(/آج کیا کریں|کھلاڑی بدلیں|چیلنج/);
  expect(p.els['#wq-h-ch'].attrs.href).toMatch(/&lang=en$/);
  expect(p.doc).toEqual({ lang: 'en', dir: 'ltr' });
});

test('boot English, pick a sibling whose hub is Urdu: the hub, <html lang> and dir switch to Urdu / rtl', async () => {
  const p = page(boot({ lang: 'en' }), { store: { wq_d: JSON.stringify(DEV) },
    api: { '/api/wq/hub/': { lang: 'ur', kids: KIDS, kid: KIDS[1].chip, teacher: null, again: [], recs: [], challenge: { on: true }, lib: { href: '/lib/t?kid=c&l=ur' } } } });
  expect(p.html()).toContain('Who is playing?');
  p.els['[data-chip="0000000000000002"]'].fire('click');
  await flush(); await flush();
  expect(p.moment()).toBe('H2');
  expect(p.html()).toContain('السلام علیکم بلال! آج کیا کریں؟');
  expect(p.html()).toContain('کھلاڑی بدلیں');
  expect(p.html()).not.toMatch(/What shall we do|Switch player|Challenge/);
  expect(p.els['#wq-h-ch'].attrs.href).toMatch(/&lang=ur$/);
  expect(p.doc).toEqual({ lang: 'ur', dir: 'rtl' });
});

test('server render in one language, the phone\'s own hub in the other: the unlocked hub follows the bot\'s lang', async () => {
  const p = page(LOCKED({ lang: 'en' }), { store: { wq_d: JSON.stringify(DEV) },
    api: { '/api/wq/hub/': { lang: 'ur', kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  expect(p.moment()).toBe('H2');
  expect(p.html()).toContain('السلام علیکم ثنا! آج کیا کریں؟');
  expect(p.doc).toEqual({ lang: 'ur', dir: 'rtl' });
});

test('server render in Urdu for a family, unlocked with no child picked yet: "Who is playing?" stays in the family\'s language', async () => {
  // The bot names no child yet, so its lang is only a default; the server render's lang came from the children.
  const p = page(LOCKED({ lang: 'ur' }), { store: { wq_d: JSON.stringify(DEV) },
    api: { '/api/wq/hub/': { lang: 'en', kids: KIDS, kid: null, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  expect(p.moment()).toBe('H1');
  expect(p.html()).toContain('کس کی باری ہے؟');
  expect(p.html()).not.toContain('Who is playing?');
  expect(p.doc).toEqual({ lang: 'ur', dir: 'rtl' });
});

/* ---------------- the results card's door ---------------- */
test('a hub opened from the results card is counted as the door\'s (hub_view src=door), once', async () => {
  const p = page(LOCKED(), { search: '?from=door', store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  expect(p.moment()).toBe('H2');
  expect(p.beacons.filter((e) => e.n === 'hub_view').map((e) => e.src)).toEqual(['door']);
  const q = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': { lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, teacher: null, again: [], recs: [] } } });
  await flush(); await flush();
  expect(q.beacons.filter((e) => e.n === 'hub_view').map((e) => e.src)).toEqual(['hub']);
});

test('the lock screen first tells the child to open their own quiz and tap the card\'s door, then the /quiz way (EN + UR)', async () => {
  const p = page(LOCKED(), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED() } });
  await flush(); await flush();
  const h = p.html();
  expect(h).toContain('Finish your own quiz, then tap “My quizzes, videos and challenges”.');
  expect(h.indexOf('My quizzes, videos and challenges')).toBeLessThan(h.indexOf('Send /quiz on WhatsApp'));
  const u = page(LOCKED({ lang: 'ur' }), { store: { wq_d: JSON.stringify(DEV) }, api: { '/api/wq/hub/': LOCKED({ lang: 'ur' }) } });
  await flush(); await flush();
  expect(u.html()).toContain('«میرے کوئز، ویڈیوز اور چیلنج»');
  expect(u.html()).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
});

describe('the home page (boot.home_v: the last quiz on top, then Videos + the Challenge)', () => {
  const ONE = [KIDS[0]];
  const LIB = { href: `/lib/${TOKEN}?kid=0000000000000001&l=en` };
  const home = (extra) => boot({ lang: 'en', kids: ONE, kid: KIDS[0].chip, home_v: 1, lib: LIB, challenge: { on: true }, ...extra });
  const order = (h, parts) => parts.map((p) => { const i = h.indexOf(p); expect(i).toBeGreaterThan(-1); return i; });

  test('an unfinished last quiz: "Your last quiz", its topic, the answers so far, ONE Continue to its own chip; then Videos, then the Challenge', () => {
    const p = page(home({ last: { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', k: 'c1', state: 'open', answered: 2 }, teacher: { code: 'OTHR01', topic: 'Plants', subject: 'science', sent_at: new Date().toISOString(), k: 'c2' } }));
    const h = p.html();
    const [a, b, c, d] = order(h, ['Your last quiz', 'id="wq-h-last"', 'id="wq-h-lib"', 'id="wq-h-ch"']);
    expect(a < b && b < c && c < d).toBe(true);
    expect(h).toContain('Shapes');
    expect(h).toContain('Continue');
    expect(p.els['#wq-h-last'].attrs.href).toBe('/q/NEWQ01?k=c1');
    // the teacher's other new quiz still shows, AFTER the tiles
    expect(h.indexOf('id="wq-h-teacher"')).toBeGreaterThan(d);
  });

  test('a finished last quiz: its score and Play again (?again=1 under its chip); no Continue', () => {
    const p = page(home({ last: { code: 'MATH01', topic: 'Fractions', subject: 'maths', k: 'c1', state: 'done', score: { c: 8, t: 10 }, again: true } }));
    const h = p.html();
    expect(h).toMatch(/<bdi dir="ltr">8\/10<\/bdi>/);
    expect(h).not.toContain('Continue');
    expect(p.els['#wq-h-last'].attrs.href).toBe('/q/MATH01?again=1&k=c1');
  });

  test('a finished quiz whose link closed: the score, no button', () => {
    const p = page(home({ last: { code: 'MATH01', topic: 'Fractions', subject: 'maths', k: 'c1', state: 'done', score: { c: 8, t: 10 }, again: false } }));
    expect(p.els['#wq-h-last']).toBeUndefined();
    expect(p.html()).toContain('8/10');
  });

  test('no last quiz and no teacher quiz: Videos and the Challenge lead, no empty "no quiz" card', () => {
    const p = page(home({ last: null }));
    expect(p.html()).not.toContain('wq-hnone');
    expect(p.els['#wq-h-lib']).toBeDefined();
  });

  test('a tap on the last-quiz card is counted (hub_pick src=last) and goes to its href', () => {
    const p = page(home({ last: { code: 'NEWQ01', topic: 'Shapes', subject: 'maths', k: 'c1', state: 'open', answered: 0 } }));
    p.els['#wq-h-last'].fire('click');
    expect(p.assigned).toEqual(['/q/NEWQ01?k=c1']);
  });

  test('Urdu: the copy is Urdu and gender-neutral; the count is isolated', () => {
    const p = page(home({ lang: 'ur', last: { code: 'NEWQ01', topic: 'شکلیں', subject: 'maths', k: 'c1', state: 'open', answered: 3 } }));
    const h = p.html();
    expect(h).toContain('آپ کا پچھلا کوئز');
    expect(h).toContain('جاری رکھیں');
    expect(h).toMatch(/<bdi>3<\/bdi>/);
    expect(h).not.toMatch(/رہا|رہی|بیٹا|بیٹی/);
  });

  test('without home_v the page is today\'s (no last card even if one is sent)', () => {
    const p = page(boot({ lang: 'en', kids: ONE, kid: KIDS[0].chip, lib: LIB, last: { code: 'X', topic: 'T', k: 'c', state: 'open' } }));
    expect(p.html()).not.toContain('Your last quiz');
  });
});

describe('the hub and the Home button (boot.nav_home)', () => {
  const LIB = { href: `/lib/${TOKEN}?kid=0000000000000001&l=en` };
  test('the library and challenge links carry home=1, so those pages show Home', () => {
    const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, lib: LIB, challenge: { on: true }, teacher: { code: 'AB12CD', topic: 'T', subject: 'maths', sent_at: new Date().toISOString(), k: 'k1' }, nav_home: true }));
    expect(p.els['#wq-h-lib'].attrs.href).toBe(`/lib/${TOKEN}?kid=0000000000000001&l=en&home=1`);
    expect(p.els['#wq-h-ch'].attrs.href).toMatch(/[?&]home=1$/);
  });
  test('without nav_home the links are today\'s', () => {
    const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip, lib: LIB, challenge: { on: true }, teacher: { code: 'AB12CD', topic: 'T', subject: 'maths', sent_at: new Date().toISOString(), k: 'k1' } }));
    expect(p.els['#wq-h-lib'].attrs.href).toBe(LIB.href);
    expect(p.els['#wq-h-ch'].attrs.href).not.toContain('home=1');
  });
  test('a hub opened by the Home button is counted as such (hub_view src=home)', () => {
    const p = page(boot({ lang: 'en', kids: [KIDS[0]], kid: KIDS[0].chip }), { search: '?from=home' });
    p.win.pagehide && p.win.pagehide.forEach((fn) => fn({}));
    expect(p.beacons.concat([]).some((e) => e.n === 'hub_view' && e.src === 'home') || p.fetches.some((f) => /hub_view/.test(String(f.init && f.init.body)) && /"src":"home"/.test(String(f.init && f.init.body)))).toBe(true);
  });
});
