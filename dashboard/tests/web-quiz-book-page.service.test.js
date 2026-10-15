/**
 * Jugnu's Book on the edge and the page: the hub page's tags (byte-identical with the Book off), the
 * /api/wq/book/h/:token route, and the shipped wq-book.js run in a vm (the bot's JSON is the boundary).
 * Invented children only.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderHubPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = {
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Zara', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: { on: true, exercises: [] }, lib: null, brand: 'niete', rt: false,
};
const GOLDEN = path.join(__dirname, 'web-quiz-book-hub-golden.html');
const BOOK_SRC = path.join(__dirname, '..', 'public', 'wq', 'wq-book.js');
const HUB_SRC = path.join(__dirname, '..', 'public', 'wq', 'hub.js');

describe('the hub page with the Book off is the base page, byte for byte', () => {
  test('golden: no book_on -> string-equal to the base render (no tile script, no stylesheet)', () => {
    const html = renderHubPage({ payload: HUB, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(html).toBe(fs.readFileSync(GOLDEN, 'utf8'));
    expect(html).not.toContain('wq-book');
  });
  test('book_on: the page is still the base page (the Book loads lazily from hub.js)', () => {
    const html = renderHubPage({ payload: HUB, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    const on = renderHubPage({ payload: { ...HUB, book_on: true }, token: TOKEN, origin: 'https://portal.example.test', assetV: 'abcdef0123' });
    expect(on.replace(/"book_on":true,?/, '').replace(',}', '}')).toBe(html.replace(',}', '}'));
    expect(on).not.toContain('wq-book');
  });
});

describe('GET /api/wq/book/h/:token', () => {
  let srv; let calls;
  function get(p, headers = {}) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers }, (res) => {
        let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
      }).on('error', reject);
    });
  }
  beforeEach(async () => {
    calls = [];
    const app = express();
    app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ name: 'Zara' }) }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
  });
  afterEach(() => new Promise((r) => srv.close(r)));
  test('forwarded to the bot with the phone\'s device; a malformed token never reaches it', async () => {
    const r = await get(`/api/wq/book/h/${TOKEN}?kid=0123456789abcdef&l=ur`, { cookie: 'wq_dv=AAAAAAAAAAAAAAAAAAAAAA' });
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe(`${BOT}/api/internal/wq/book/h/${TOKEN}?kid=0123456789abcdef&l=ur`);
    expect(calls[0].opts.headers['x-wq-device']).toBe('AAAAAAAAAAAAAAAAAAAAAA');
    const bad = await get('/api/wq/book/h/not-a-token');
    expect(bad.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});

// ---- wq-book.js in a vm -------------------------------------------------------------------------------------------
function loadBook() {
  const win = { scrollTo() {} };
  vm.runInNewContext(fs.readFileSync(BOOK_SRC, 'utf8'), { window: win, JSON, Math, String, Number, Array, Object, encodeURIComponent });
  return win.WQBOOK;
}
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&(#39|amp|lt|gt|quot);/g, ' ');
const DIGIT = /[0-9۰-۹]/;
const BOOK = {
  name: 'Zara', trail_stickers: ['missing', 'read', 'listen'], story_stickers: [{ passage_id: 'p-1', title: 'The kite' }, { passage_id: 'p-2', title: 'The mango tree' }],
  lamps: { reading: 2, numbers: 3 }, next_outline: { reading: true, numbers: true }, days_this_week: [true, false, true, true, false, false, false],
  class_lights: { shown: true, term_total: 41, week_n: 7 }, grade_band: 'G2-3',
};
const ctxOf = (over = {}) => ({ token: TOKEN, kid: '0123456789abcdef', lang: 'en', ...over });

describe('the Book screen', () => {
  test('lights hidden under 5: the "playing too" line and no number anywhere on the Book', () => {
    const B = loadBook();
    const html = B._bookHtml({ ...BOOK, class_lights: { shown: false } }, ctxOf(), false);
    expect(html).toContain('Your class is playing too');
    expect(DIGIT.test(text(html))).toBe(false);
  });
  test('lights shown: the term total and +7; the only digits on the Book are the class\'s numbers', () => {
    const B = loadBook();
    const html = B._bookHtml(BOOK, ctxOf(), false);
    // copy.v2.json v2.1 jg.lights.term / jg.lights.week: two whole sentences, the week one on its own line.
    expect(html).toContain('Your class has lit 41 lights this term.');
    expect(html).toContain('<span class="wq-bk-week">7 of them this week.</span>');
    expect(DIGIT.test(text(html).replace('41', '').replace('7 of', ''))).toBe(false);
  });
  test('6 this week from 2 children (the bot sends no week_n): no "+n", only the term total', () => {
    const B = loadBook();
    const html = B._bookHtml({ ...BOOK, class_lights: { shown: true, term_total: 41 } }, ctxOf(), false);
    expect(html).not.toContain('wq-bk-week');
    // week_n 0 (or below): no week line at all, never "0 of them this week".
    expect(B._bookHtml({ ...BOOK, class_lights: { shown: true, term_total: 41, week_n: 0 } }, ctxOf(), false)).not.toContain('wq-bk-week');
    expect(B._bookHtml({ ...BOOK, class_lights: { shown: true, term_total: 41, week_n: -2 } }, ctxOf({ lang: 'ur' }), false)).not.toContain('wq-bk-week');
    expect(DIGIT.test(text(html).replace('41', ''))).toBe(false);
  });
  test('Urdu: the ruled sentences with Urdu digits and no isolate (COPY §C); no Latin digit', () => {
    const B = loadBook();
    const html = B._bookHtml(BOOK, ctxOf({ lang: 'ur' }), false);
    expect(html).toContain('آپ کی کلاس نے اس ٹرم میں ۴۱ روشنیاں جلائی ہیں۔');
    expect(html).toContain('<span class="wq-bk-week">ان میں سے ۷ اس ہفتے۔</span>');
    expect(html.split('data-lights="total"')[1]).not.toMatch(/[\u2066-\u2069]/);
    expect(/[0-9]/.test(text(html))).toBe(false);
  });
  test('the outline: exactly one per ladder after the lit lamps, none at 5, none when the bot sends none', () => {
    const B = loadBook();
    const count = (h, ladder) => (h.split(`data-ladder="${ladder}"`)[1].split('</ol>')[0].match(/wq-bk-outline/g) || []).length;
    const h1 = B._bookHtml(BOOK, ctxOf(), false);
    expect(count(h1, 'reading')).toBe(1);
    expect(count(h1, 'numbers')).toBe(1);
    expect((h1.split('data-ladder="reading"')[1].split('</ol>')[0].match(/wq-bk-lamp"/g) || []).length).toBe(2);
    const h5 = B._bookHtml({ ...BOOK, lamps: { reading: 5, numbers: 0 }, next_outline: { reading: true, numbers: false } }, ctxOf(), false);
    expect(count(h5, 'reading')).toBe(0);
    expect(count(h5, 'numbers')).toBe(0);
    // the outline carries no label
    expect(h1).toMatch(/<li class="wq-bk-outline" aria-hidden="true"><\/li>/);
  });
  test('days: 7 dots, the lit ones filled, no digit and no word in the dots; a new week is an empty row', () => {
    const B = loadBook();
    const days = (h) => h.split('wq-bk-dots')[1].split('</div>')[0];
    const h = B._bookHtml(BOOK, ctxOf(), false);
    expect((days(h).match(/wq-bk-dot/g) || []).length).toBe(7);
    expect((days(h).match(/wq-bk-lit/g) || []).length).toBe(3);
    expect(DIGIT.test(text(days(h)))).toBe(false);
    expect(days(h).match(/<span class="wq-bk-dl">([^<]*)<\/span>/g).map((x) => x.replace(/<[^>]*>/g, ''))).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    const ur = B._bookHtml(BOOK, ctxOf({ lang: 'ur' }), false);
    // Monday first in the markup: the page's rtl flow puts it on the right
    expect(days(ur).match(/<span class="wq-bk-dl">([^<]*)<\/span>/g).map((x) => x.replace(/<[^>]*>/g, ''))).toEqual(['پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ', 'اتوار']);
    expect(DIGIT.test(text(days(ur)))).toBe(false);
    const empty = B._bookHtml({ ...BOOK, days_this_week: [false, false, false, false, false, false, false] }, ctxOf(), false);
    expect((days(empty).match(/wq-bk-lit/g) || []).length).toBe(0);
    expect(empty).not.toMatch(/lost|streak|broken/i);
  });
  test('story stickers open that story as practice; no sticker total; no faded slots', () => {
    const B = loadBook();
    const h = B._bookHtml(BOOK, ctxOf(), false);
    expect(h).toContain(`/c/${TOKEN}?kid=0123456789abcdef&amp;lang=en&amp;room=story&amp;pid=p-1`);
    expect((h.match(/class="wq-bk-st"/g) || []).length).toBe(2);
    expect(h).toContain('<h2>Trail stickers</h2>');
    expect(B._bookHtml(BOOK, ctxOf({ lang: 'ur' }), false)).toContain('ہر پوری کہانی پر ایک اسٹیکر');
    expect(B._bookHtml({ ...BOOK, trail_stickers: [] }, ctxOf(), false)).not.toContain('Trail stickers');
    const none = B._bookHtml({ ...BOOK, story_stickers: [] }, ctxOf(), false);
    expect(none).not.toContain('class="wq-bk-st"');
  });
});

describe('the new lamp shows only when the bot sets it, once', () => {
  function root() {
    const els = {};
    return {
      _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; },
      querySelector: (sel) => (els[sel] = els[sel] || { addEventListener() {}, hidden: true }),
    };
  }
  test('levelup set: shown the first time, not the second; no levelup: never', () => {
    const B = loadBook();
    const store = { m: {}, getItem(k) { return this.m[k] || null; }, setItem(k, v) { this.m[k] = String(v); } };
    const up = { ...BOOK, levelup: { ladder: 'reading', rung: 3, opens: 'longer' } };
    const r1 = root();
    B._render(ctxOf({ root: r1, store }), up);
    expect(r1.innerHTML).toContain('A new lamp is lit!');
    expect(r1.innerHTML).toContain('Now open for you: longer stories');
    expect(r1.innerHTML).toContain('You read a story and answered its questions.');
    expect(r1.innerHTML).toContain('room=story');
    const r2 = root();
    B._render(ctxOf({ root: r2, store }), up);
    expect(r2.innerHTML).not.toContain('A new lamp is lit!');
    const r3 = root();
    B._render(ctxOf({ root: r3, store: { getItem: () => null, setItem() {} } }), BOOK);
    expect(r3.innerHTML).not.toContain('A new lamp is lit!');
  });
  test('no opens (Story Time off): the head and the task line only, no "New for you", no Story Time button', () => {
    const B = loadBook();
    const h = B._bookHtml({ ...BOOK, levelup: { ladder: 'reading', rung: 3 } }, ctxOf(), true);
    expect(h).toContain('A new lamp is lit!');
    expect(h).toContain('You read a story and answered its questions.');
    expect(h).not.toContain('New for you');
    expect(h).not.toContain('wq-bk-go');
  });
  test('a numbers lamp: the head and what opened, never the reading line', () => {
    const B = loadBook();
    const h = B._bookHtml({ ...BOOK, levelup: { ladder: 'numbers', rung: 2, opens: 'two_digit' } }, ctxOf(), true);
    expect(h).toContain('Now open for you: two-digit games');
    expect(h).toContain('You filled in the number games!');
    expect(h).not.toContain('You read a story');
    // N1 is not a filled-in game: no task line
    const n1 = B._bookHtml({ ...BOOK, levelup: { ladder: 'numbers', rung: 1 } }, ctxOf(), true);
    expect(n1).not.toContain('You filled in the number games!');
  });
});

// ---- hub.js: the one guarded hook -------------------------------------------------------------------------------
function runHub(boot, book) {
  const root = { _h: '', set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {} };
  const win = { scrollTo() {}, addEventListener() {} };
  if (book) win.WQBOOK = book;
  const head = [];
  const byId = {};
  const document = {
    documentElement: { setAttribute() {}, classList: { toggle() {} } }, cookie: '',
    getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : byId[id] || null),
    querySelector: (sel) => (/hub\.js/.test(sel) ? { getAttribute: () => '/wq/hub.js?v=abc123' } : null),
    createElement: (tag) => ({ tag, l: {}, addEventListener(n, fn) { this.l[n] = fn; } }),
    head: { appendChild: (el) => { head.push(el); if (el.id) byId[el.id] = el; } },
  };
  vm.runInNewContext(fs.readFileSync(HUB_SRC, 'utf8'), {
    window: win, document, navigator: { sendBeacon: () => true }, history: { replaceState() {} }, location: { search: '', protocol: 'https:' }, Blob: function Blob() {},
    localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent, Uint8Array,
  });
  return { html: root._h, head, win };
}
describe('hub.js', () => {
  const hubLine = (seen) => (B, ctx) => { seen.push([B.kid, ctx.lang, typeof ctx.ev, typeof ctx.back]); return ''; };
  test('book_on: loads wq-book.js/.css at hub.js\'s ?v= and then adds the tile and lights line', () => {
    const seen = [];
    const r = runHub({ ...HUB, brand: null, token: TOKEN, book_on: true }, null);
    expect(r.head.map((e) => e.src || e.href)).toEqual(['/wq/wq-book.css?v=abc123', '/wq/wq-book.js?v=abc123']);
    expect(seen).toHaveLength(0);
    r.win.WQBOOK = { hubLine: hubLine(seen) };
    r.head[1].l.load();
    expect(seen).toEqual([['0123456789abcdef', 'en', 'function', 'function']]);
  });
  test('book_on with the Book already loaded: called at once, nothing loaded again', () => {
    const seen = [];
    const r = runHub({ ...HUB, brand: null, token: TOKEN, book_on: true }, { hubLine: hubLine(seen) });
    expect(seen).toHaveLength(1);
    expect(r.head).toHaveLength(0);
  });
  test('off: nothing loaded, never called', () => {
    const seen = [];
    const r = runHub({ ...HUB, brand: null, token: TOKEN }, { hubLine: hubLine(seen) });
    expect(seen).toHaveLength(0);
    expect(r.head).toHaveLength(0);
    expect(r.html).not.toContain('wq-bk');
  });
});
