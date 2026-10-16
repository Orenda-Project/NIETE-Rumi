/**
 * The "Keep my place" confirm sheet (public/wq/wq-bind.js): the English STOP line names what STOP removes (this phone
 * number), as the Urdu line does («یہ نمبر ہٹا»). The sentence is the copy deck's jg.bind.notice_stop_phone_only, lifted
 * byte for byte. Everything else on the sheet is as it was. Run whole in a vm; fetch and storage are the faked boundaries.
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
// the deck's jg.bind.notice_stop_phone_only (EN), byte for byte
const EN_STOP = 'A grown-up can remove this phone number any time by sending STOP on WhatsApp.';
const EN_SAVE = '<p>Jugnu will save this phone number with Zara&#39;s name until the end of the school year (31 March), longer only if you keep playing.</p>';
const EN_READINGS = '<p>Readings Zara makes with the microphone are kept too.</p>';
const lines = (html) => notice(html).replace(/^<div class="wqb-notice">|<\/div>$/g, '').split('</p>').filter(Boolean);

test('the EN STOP line reads the deck\'s sentence (remove this phone number), never \'undo this\'', () => {
  const p = load();
  expect(p.B.t('en').noticeStopPhoneOnly).toBe(EN_STOP);
  const { html } = sheetOf('en');
  expect(lines(html)[2] + '</p>').toBe('<p>' + EN_STOP.replace('STOP', '\u2066<bdi dir="ltr" class="wqb-chip">STOP</bdi>\u2069') + '</p>');
  expect(html).toContain('remove this phone number');
  expect(html).not.toContain('undo this');
  for (const w of [/eading/, /ecording/, /delet/i]) expect(lines(html)[2]).not.toMatch(w);
});

test('the Urdu STOP sentence is byte-identical', () => {
  const p = load();
  // the deck's UR, unchanged: «گھر کے بڑے کسی بھی وقت واٹس ایپ پر STOP بھیج کر یہ نمبر ہٹا سکتے ہیں۔» (U+00A0 inside «واٹس ایپ», STOP in U+2066..U+2069)
  expect(p.B.t('ur').noticeStopPhoneOnly).toBe("\u06af\u06be\u0631 \u06a9\u06d2 \u0628\u0691\u06d2 \u06a9\u0633\u06cc \u0628\u06be\u06cc \u0648\u0642\u062a \u0648\u0627\u0679\u0633\u00a0\u0627\u06cc\u067e \u067e\u0631 \u2066STOP\u2069 \u0628\u06be\u06cc\u062c \u06a9\u0631 \u06cc\u06c1 \u0646\u0645\u0628\u0631 \u06c1\u0679\u0627 \u0633\u06a9\u062a\u06d2 \u06c1\u06cc\u06ba\u06d4");
  const { html } = sheetOf('ur');
  expect(html).toContain(UR_KEPT[2]);
  expect(notice(html)).toBe(UR_NOTICE);
});

test('the save and readings lines are byte-identical (EN, UR)', () => {
  const en = sheetOf('en').html;
  expect(notice(en).startsWith(NOTICE + EN_SAVE + EN_READINGS + '<p>')).toBe(true);
  const ur = sheetOf('ur').html;
  expect(notice(ur).startsWith(NOTICE + UR_KEPT[1] + '<p>' + UR_READINGS + '</p><p>')).toBe(true);
  for (const k of UR_KEPT) expect(ur).toContain(k);
});

test('the sheet\'s order is unchanged: title, who-sends line, Yes/No row, notice (EN, UR)', () => {
  for (const lang of ['en', 'ur']) {
    const { html } = sheetOf(lang);
    const order = [TITLE, SUB, ROW, NOTICE].map((s) => html.indexOf(s));
    expect([lang, order.every((i) => i > -1)]).toEqual([lang, true]);
    expect([lang, order[0] < order[1], order[1] < order[2], order[2] < order[3]]).toEqual([lang, true, true, true]);
  }
});

test('the name is escaped exactly once in every line; the STOP line carries no name (EN, UR)', () => {
  for (const lang of ['en', 'ur']) {
    const { html } = sheetOf(lang, "D'Souza <b>");
    const once = 'D&#39;Souza &lt;b&gt;';
    expect([lang, /<h3 class="wqb-title">([^<]*)<\/h3>/.exec(html)[1].includes(once)]).toEqual([lang, true]);
    const l = lines(html);
    expect(l).toHaveLength(3);
    expect([lang, l[0].includes(once), l[1].includes(once), l[2].includes('Souza')]).toEqual([lang, true, true, false]);
    expect([lang, html.includes('&amp;#39;'), html.includes('&amp;lt;'), html.includes('<b>')]).toEqual([lang, false, false, false]);
  }
});
