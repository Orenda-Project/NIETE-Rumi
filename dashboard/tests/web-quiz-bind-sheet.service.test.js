/**
 * The "Keep my place" confirm sheet (public/wq/wq-bind.js), run whole in a vm with a small fake DOM: the bot API
 * (fetch) and localStorage/sessionStorage are the faked boundaries; the script is the shipped file.
 * - On a small screen the sheet can open below the fold: it brings its mount into view (when the browser can).
 * - The notice says readings made with the microphone are kept too (EN, UR), between the save line and the STOP line.
 * - A save that fails without a known reason says so and keeps Yes, so the parent can tap again.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-bind.js'), 'utf8');

function load({ mint } = {}) {
  const fetches = [];
  const store = () => { const o = {}; return { getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } }; };
  const ctx = {
    // a 360x740 phone, scrolled to the top
    window: { innerWidth: 360, innerHeight: 740, scrollY: 0, addEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {} },
    localStorage: store(), sessionStorage: store(),
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (!mint) return new Promise(() => {});
      if (mint === 'network') return Promise.reject(new Error('offline'));
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(mint)) });
    },
    Date, JSON, Promise, encodeURIComponent, setTimeout, console,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { B: ctx.window.WQBIND, win: ctx.window, fetches };
}
function mount(extra = {}) {
  const els = {};
  return {
    els,
    _h: '',
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/data-b="([^"]+)"/g)) {
        els[m[1]] = { l: [], addEventListener(n, fn) { this.l.push(fn); }, click() { this.l.forEach((f) => f({ preventDefault() {} })); } };
      }
    },
    get innerHTML() { return this._h; },
    querySelector(sel) { const m = /data-b="([^"]+)"/.exec(sel); return m ? els[m[1]] || null : null; },
    ...extra,
  };
}
const ctxOf = (x = {}) => ({ hub: 'h.tok', kid: '0123456789abcdef', first: 'Zara', lang: 'ur', ev() {}, ...x });
const flush = () => new Promise((r) => setImmediate(r));
const notice = (html) => (/<div class="wqb-notice">.*?<\/div>/.exec(html) || [''])[0];

// The Urdu sheet's lines that stay as they were (title, save line, STOP line with its chip and nowrap span, buttons).
const UR_KEPT = [
  '<h3 class="wqb-title">\u2068Zara\u2069، کیا یہ آپ ہیں؟</h3>',
  '<p>جگنو اس فون نمبر کو \u2068Zara\u2069 کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔</p>',
  '<p>گھر کے بڑے کسی بھی وقت <span class="wqb-nowrap">واٹس\u00a0ایپ</span> پر \u2066<bdi dir="ltr" class="wqb-chip">STOP</bdi>\u2069 بھیج کر یہ نمبر ہٹا سکتے ہیں۔</p></div>',
  'data-b="yes">جی ہاں، یہ میں ہوں</button>',
  'data-b="no">یہ میں نہیں ہوں</button>',
];
const UR_READINGS = 'مائیک پر \u2068Zara\u2069 کی پڑھائی کی ریکارڈنگ بھی رکھی جاتی\u00a0ہے۔';
const TRY = { en: 'Your place wasn&#39;t saved just now. Please tap again.', ur: 'ابھی جگہ محفوظ نہیں ہو\u00a0سکی۔ دوبارہ دبائیں۔' };

test('360x740 Urdu, after Keep: the sheet scrolls its mount into view', () => {
  const p = load();
  expect(p.win.innerHeight).toBe(740);
  const m = mount({ scrollIntoView: jest.fn() });
  expect(p.B.card(m, ctxOf({ lang: 'ur' }))).toBe(true);
  expect(m.scrollIntoView).not.toHaveBeenCalled();   // the card's first draw is not scrolled
  m.els.keep.click();
  expect(m.scrollIntoView).toHaveBeenCalledTimes(1);
  expect(m.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  expect(m.els.yes).toBeTruthy();
});

test('a mount without scrollIntoView: the sheet still draws, nothing throws', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'ur' }));
  expect(() => m.els.keep.click()).not.toThrow();
  expect(m.innerHTML).toContain('data-b="yes"');
  expect(m.innerHTML).toContain('جی ہاں، یہ میں ہوں');
  // a browser whose scrollIntoView throws: the sheet is still drawn
  const q = load();
  const n = mount({ scrollIntoView() { throw new Error('unsupported'); } });
  q.B.card(n, ctxOf({ lang: 'en' }));
  expect(() => n.els.keep.click()).not.toThrow();
  expect(n.innerHTML).toContain('data-b="yes"');
});

test('English sheet: the recordings sentence between the save line and the STOP line', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'en', first: 'Zara' }));
  m.els.keep.click();
  const html = m.innerHTML;
  const line = 'Readings Zara makes with the microphone are kept too.';
  expect(html).toContain('<p>' + line + '</p>');
  const save = html.indexOf('Jugnu will save this phone number with Zara');
  const readings = html.indexOf(line);
  const stop = html.indexOf('A grown-up can undo this');
  expect(save).toBeGreaterThan(-1);
  expect(readings).toBeGreaterThan(save);
  expect(stop).toBeGreaterThan(readings);
  expect(notice(html).match(/<p>/g)).toHaveLength(3);
});

test('Urdu sheet: the readings line between the save line and the STOP line, bytes exact', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'ur', first: 'Zara' }));
  m.els.keep.click();
  const html = m.innerHTML;
  expect(html).toContain('<p>' + UR_READINGS + '</p>');
  const save = html.indexOf('جگنو اس فون نمبر کو');
  const readings = html.indexOf(UR_READINGS);
  const stop = html.indexOf('گھر کے بڑے');
  expect(save).toBeGreaterThan(-1);
  expect(readings).toBeGreaterThan(save);
  expect(stop).toBeGreaterThan(readings);
  expect(notice(html).match(/<p>/g)).toHaveLength(3);
  // the rest of the Urdu sheet is as it was
  for (const k of UR_KEPT) expect(html).toContain(k);
  expect(html).not.toContain('microphone');
});

test('the name is escaped in the readings line', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'en', first: '<b>Zara' }));
  m.els.keep.click();
  const block = notice(m.innerHTML);
  const lines = block.replace(/^<div class="wqb-notice">|<\/div>$/g, '').split('</p>').filter(Boolean);
  const readings = lines.find((l) => l.includes('makes with the microphone are kept too.'));
  expect(readings).toBeDefined();
  expect(readings).not.toContain('<b>');
  // escaped the same way as the save line beside it
  expect(readings).toMatch(/&(amp;)?lt;b&(amp;)?gt;Zara/);
  expect(lines[0]).toMatch(/&(amp;)?lt;b&(amp;)?gt;Zara/);
  expect(readings.match(/&(amp;)?lt;b&(amp;)?gt;/)[0]).toBe(lines[0].match(/&(amp;)?lt;b&(amp;)?gt;/)[0]);
});

test('the name is escaped in the Urdu readings line', () => {
  const p = load();
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'ur', first: '<b>Zara' }));
  m.els.keep.click();
  const readings = notice(m.innerHTML).split('</p>').find((l) => l.includes('کی پڑھائی کی ریکارڈنگ'));
  expect(readings).toBeDefined();
  expect(readings).not.toContain('<b>');
  expect(readings).toMatch(/\u2068&(amp;)?lt;b&(amp;)?gt;Zara\u2069/);
});

test('a mint that answers neither ok nor a refusal -> the try-again line (EN, then UR bytes) with a Yes button; tapping Yes mints again', async () => {
  for (const lang of ['en', 'ur']) {
    const p = load({ mint: {} });
    const m = mount();
    p.B.card(m, ctxOf({ lang }));
    m.els.keep.click();
    m.els.yes.click();
    await flush(); await flush();
    expect([lang, m.innerHTML.includes(TRY[lang])]).toEqual([lang, true]);
    expect(m.innerHTML).toContain('class="wqb-msg"');
    expect(m.els.yes).toBeTruthy();
    expect(m.els.no).toBeUndefined();
    const before = p.fetches.filter((f) => f.url === '/api/wq/bind/mint').length;
    m.els.yes.click();
    await flush(); await flush();
    expect(p.fetches.filter((f) => f.url === '/api/wq/bind/mint').length).toBe(before + 1);
    expect(JSON.parse(p.fetches[p.fetches.length - 1].init.body)).toEqual({ hub: 'h.tok', kid: '0123456789abcdef', lang });
  }
});

test('a network error on mint -> the same try-again line', async () => {
  const p = load({ mint: 'network' });
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'ur' }));
  m.els.keep.click();
  m.els.yes.click();
  await flush(); await flush();
  expect(m.innerHTML).toContain(TRY.ur);
  expect(m.els.yes).toBeTruthy();
});

test('a known refusal (max_kids) still shows its own line and no Yes button', async () => {
  const p = load({ mint: { ok: false, refused: 'max_kids' } });
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'en' }));
  m.els.keep.click();
  m.els.yes.click();
  await flush(); await flush();
  expect(m.innerHTML).toContain('This phone already keeps four children&#39;s places.');
  expect(m.innerHTML).not.toContain('tap again');
  expect(m.els.yes).toBeUndefined();
});

test('the name is escaped exactly once in every line of the sheet', () => {
  for (const lang of ['en', 'ur']) {
    const p = load();
    const m = mount();
    p.B.card(m, ctxOf({ lang, first: "D'Souza <b>" }));
    m.els.keep.click();
    const html = m.innerHTML;
    const once = 'D&#39;Souza &lt;b&gt;';
    expect([lang, /<h3 class="wqb-title">([^<]*)<\/h3>/.exec(html)[1].includes(once)]).toEqual([lang, true]);
    const lines = notice(html).replace(/^<div class="wqb-notice">|<\/div>$/g, '').split('</p>').filter(Boolean);
    expect(lines).toHaveLength(3);
    // the save line and the readings line carry the name; the STOP line does not
    expect([lang, lines[0].includes(once), lines[1].includes(once)]).toEqual([lang, true, true]);
    expect([lang, html.includes('&amp;#39;'), html.includes('&amp;lt;')]).toEqual([lang, false, false]);
  }
});

test('the who-sends line keeps «واٹس ایپ» on one line (the sheet and the send step)', async () => {
  const held = '<span class="wqb-nowrap">واٹس ایپ</span>';
  const sub = (html) => (/<p class="wqb-sub">(.*?)<\/p>/.exec(html) || [])[1] || '';
  const p = load({ mint: { ok: true, code: 'JUGNU-7KQ2X', href: 'https://wa.me/?text=x' } });
  const m = mount();
  p.B.card(m, ctxOf({ lang: 'ur' }));
  m.els.keep.click();
  expect(sub(m.innerHTML)).toContain(held);
  expect(sub(m.innerHTML)).toContain('پھر گھر کے بڑے اس فون سے');
  m.els.yes.click();
  await flush(); await flush();
  expect(m.els.send).toBeTruthy();
  expect(sub(m.innerHTML)).toContain(held);
  // English has no such pair: the line is as it was
  const q = load();
  const n = mount();
  q.B.card(n, ctxOf({ lang: 'en' }));
  n.els.keep.click();
  expect(sub(n.innerHTML)).toBe('A grown-up sends one WhatsApp message from this phone.');
});
