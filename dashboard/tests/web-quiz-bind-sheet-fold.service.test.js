/**
 * The "Keep my place" confirm sheet (public/wq/wq-bind.js) on a small phone: the two answers come before the notice,
 * so after the sheet scrolls its top into view both Yes and No are on screen at 360x640.
 * Order: title -> who-sends line -> Yes/No row -> notice. Every sentence and every button is as it was.
 * Run whole in a vm with a small fake DOM: the bot API (fetch) and localStorage/sessionStorage are the faked boundaries.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-bind.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');

function load({ mint } = {}) {
  const fetches = [];
  const store = () => { const o = {}; return { getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } }; };
  const ctx = {
    // a 360x640 phone, scrolled to the top
    window: { innerWidth: 360, innerHeight: 640, scrollY: 0, addEventListener() {} },
    document: { visibilityState: 'visible', addEventListener() {} },
    localStorage: store(), sessionStorage: store(),
    fetch: (url, init) => {
      fetches.push({ url, init });
      if (!mint) return new Promise(() => {});
      return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(mint)) });
    },
    Date, JSON, Promise, encodeURIComponent, setTimeout, console,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  // wq-tel.js first, as on the hub page (its WQT.nowrap holds «واٹس ایپ» on one line).
  vm.runInContext(TEL, ctx);
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
function sheetOf(lang, first = 'Zara', extra = {}) {
  const p = load(extra.load);
  const m = mount(extra.mount);
  expect(p.B.card(m, ctxOf({ lang, first }))).toBe(true);
  m.els.keep.click();
  return { p, m, html: m.innerHTML };
}

// The Urdu sheet's lines, as the existing sheet suite holds them (verbatim).
const UR_KEPT = [
  '<h3 class="wqb-title">⁨Zara⁩، کیا یہ آپ ہیں؟</h3>',
  '<p>جگنو اس فون نمبر کو ⁨Zara⁩ کے ساتھ جوڑ کر محفوظ کرے گا۔ یہ اسکول کا سال ختم ہونے تک (۳۱ مارچ) رہے گا، اور اگر کھیلنا جاری رہے تو اس کے بعد بھی۔</p>',
  '<p>گھر کے بڑے کسی بھی وقت <span class="wqb-nowrap">واٹس ایپ</span> پر ⁦<bdi dir="ltr" class="wqb-chip">STOP</bdi>⁩ بھیج کر یہ نمبر ہٹا سکتے ہیں۔</p></div>',
  'data-b="yes">جی ہاں، یہ میں ہوں</button>',
  'data-b="no">یہ میں نہیں ہوں</button>',
];
const UR_READINGS = 'مائیک پر ⁨Zara⁩ کی پڑھائی کی ریکارڈنگ بھی رکھی جاتی ہے۔';
const UR_NOTICE = '<div class="wqb-notice">' + UR_KEPT[1] + '<p>' + UR_READINGS + '</p>' + UR_KEPT[2];

const TITLE = '<h3 class="wqb-title">';
const SUB = '<p class="wqb-sub">';
const ROW = '<div class="wqb-row';
const NOTICE = '<div class="wqb-notice">';

test('after Keep, EN and UR: the Yes/No row precedes the notice in the sheet\'s markup', () => {
  for (const lang of ['en', 'ur']) {
    const { html } = sheetOf(lang);
    const title = html.indexOf(TITLE);
    const row = html.indexOf(ROW);
    const note = html.indexOf(NOTICE);
    expect([lang, title > -1, row > -1, note > -1]).toEqual([lang, true, true, true]);
    expect([lang, title < row]).toEqual([lang, true]);
    expect([lang, row < note]).toEqual([lang, true]);
    // both answers sit inside the row, before the notice
    expect([lang, html.indexOf('data-b="yes"') < note, html.indexOf('data-b="no"') < note]).toEqual([lang, true, true]);
  }
});

test('the who-sends line sits between the title and the row', () => {
  for (const lang of ['en', 'ur']) {
    const { html } = sheetOf(lang);
    const order = [TITLE, SUB, ROW, NOTICE].map((s) => html.indexOf(s));
    expect([lang, order.every((i) => i > -1)]).toEqual([lang, true]);
    expect([lang, order[0] < order[1], order[1] < order[2], order[2] < order[3]]).toEqual([lang, true, true, true]);
    // each part appears once
    expect([lang, html.split(SUB).length, html.split(NOTICE).length, html.split(ROW).length]).toEqual([lang, 2, 2, 2]);
  }
});

test('the notice\'s three Urdu sentences are byte-identical', () => {
  const { html } = sheetOf('ur');
  for (const k of UR_KEPT) expect(html).toContain(k);
  expect(html).toContain('<p>' + UR_READINGS + '</p>');
  expect(notice(html)).toBe(UR_NOTICE);
  expect(notice(html).match(/<p>/g)).toHaveLength(3);
});

test('the English notice is unchanged', () => {
  const { html } = sheetOf('en');
  const block = notice(html);
  expect(block).toBe('<div class="wqb-notice">' +
    '<p>Jugnu will save this phone number with Zara&#39;s name until the end of the school year (31 March), longer only if you keep playing.</p>' +
    '<p>Readings Zara makes with the microphone are kept too.</p>' +
    '<p>A grown-up can remove this phone number any time by sending \u2066<bdi dir="ltr" class="wqb-chip">STOP</bdi>\u2069 on WhatsApp.</p></div>');
  const save = block.indexOf('Jugnu will save this phone number with Zara');
  const readings = block.indexOf('Readings Zara makes with the microphone are kept too.');
  const stop = block.indexOf('A grown-up can remove this phone number');
  expect(save).toBeGreaterThan(-1);
  expect(readings).toBeGreaterThan(save);
  expect(stop).toBeGreaterThan(readings);
  expect(/<p class="wqb-sub">(.*?)<\/p>/.exec(html)[1]).toBe('A grown-up sends one WhatsApp message from this phone.');
});

test('Yes still mints, No still closes, scrollIntoView still called', async () => {
  for (const lang of ['en', 'ur']) {
    const s = sheetOf(lang, 'Zara', { mount: { scrollIntoView: jest.fn() } });
    expect(s.m.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(s.m.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    s.m.els.yes.click();
    await flush(); await flush();
    const mints = s.p.fetches.filter((f) => f.url === '/api/wq/bind/mint');
    expect([lang, mints.length]).toEqual([lang, 1]);
    expect(JSON.parse(mints[0].init.body)).toEqual({ hub: 'h.tok', kid: '0123456789abcdef', lang });

    const n = sheetOf(lang);
    n.m.els.no.click();
    expect([lang, n.m.innerHTML]).toEqual([lang, '']);
    expect(n.p.fetches.filter((f) => f.url === '/api/wq/bind/mint')).toHaveLength(0);
  }
});

test('the name is escaped exactly once in every line', () => {
  for (const lang of ['en', 'ur']) {
    const { html } = sheetOf(lang, "D'Souza <b>");
    const once = 'D&#39;Souza &lt;b&gt;';
    expect([lang, /<h3 class="wqb-title">([^<]*)<\/h3>/.exec(html)[1].includes(once)]).toEqual([lang, true]);
    const lines = notice(html).replace(/^<div class="wqb-notice">|<\/div>$/g, '').split('</p>').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect([lang, lines[0].includes(once), lines[1].includes(once), lines[2].includes(once)]).toEqual([lang, true, true, false]);
    expect([lang, html.includes('&amp;#39;'), html.includes('&amp;lt;'), html.includes('<b>')]).toEqual([lang, false, false, false]);
    // the parts that do not carry the name still do not
    expect([lang, /<p class="wqb-sub">(.*?)<\/p>/.exec(html)[1].includes('Souza')]).toEqual([lang, false]);
  }
});
