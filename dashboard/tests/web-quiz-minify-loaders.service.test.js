/**
 * Minified page files (web_quiz_minify): each script a page loads by itself afterwards rides on its loader's own
 * ?v=, so a page that links `?v=<hex>m` gets the minified copy of the file it loads too.
 *
 *   hub.js loadOnce        (hub-play, wq-bind, wq-book .js/.css)  copies hub.js's ?v=        → keeps the `m`
 *   wq-challenge.js        (wq-g1.js)                             copies wq-challenge.js's ?v= → keeps the `m`
 *   wq.js jugnuCard        (wq-card.js)                           copies wq.js's ?v=          → keeps the `m`
 *   wq.js finishCard       (wq-finish-card.js)                    copies wq.js's ?v=          → keeps the `m`
 *   wq-trail.js raLoad     (wq-readalong.js)                      its own fixed RA_V (the file's hash): the raw file,
 *                                                                  at its own URL, whatever the page's ?v= (documented here)
 *
 * wq-challenge.js runs whole in its harness (wqc-page-harness.js). hub.js's loadOnce and wq.js's jugnuCard are
 * the shipped functions, cut from the files and run in a vm with a fake document (only the browser is faked).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { page, ok } = require('./wqc-page-harness');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const read = (f) => fs.readFileSync(path.join(WQ, f), 'utf8');

/** `function <name>(…) { … }` as written in src (braces matched; these functions hold no brace inside a string). */
function cut(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && (depth -= 1) === 0) return src.slice(at, i + 1);
  }
  throw new Error(`${name} not closed`);
}

/** A document whose script tag for `own` has src `ownSrc`; every element appended to head is kept. */
function fakeDoc(own, ownSrc) {
  const head = [];
  const document = {
    querySelector: (sel) => (sel.includes(own) ? { getAttribute: () => ownSrc } : null),
    createElement: (tag) => ({ tag, listeners: {}, addEventListener(n, fn) { (this.listeners[n] = this.listeners[n] || []).push(fn); } }),
    head: { appendChild: (el) => head.push(el) },
  };
  return { document, head };
}

describe('hub.js loadOnce: the lazy files at hub.js\'s own ?v=', () => {
  const FN = cut(read('hub.js'), 'loadOnce');
  const run = (ownSrc, name, css) => {
    const { document, head } = fakeDoc('/wq/hub.js', ownSrc);
    const ctx = { document, asked: {} };
    vm.createContext(ctx);
    vm.runInContext(`var asked = {};\n${FN}\nloadOnce(${JSON.stringify(name)}, ${css}, function () {});`, ctx);
    return head.map((e) => e.src || e.href);
  };
  test('?v=<hex>m (switch on): the book\'s .css and .js keep the m', () => {
    expect(run('/wq/hub.js?v=abc123def0m', 'wq-book', true)).toEqual(['/wq/wq-book.css?v=abc123def0m', '/wq/wq-book.js?v=abc123def0m']);
  });
  test('?v=<hex>m: hub-play.js keeps the m', () => {
    expect(run('/wq/hub.js?v=abc123def0m', 'hub-play', false)).toEqual(['/wq/hub-play.js?v=abc123def0m']);
  });
  test('?v=<hex> (switch off): today\'s URLs', () => {
    expect(run('/wq/hub.js?v=abc123def0', 'wq-bind', true)).toEqual(['/wq/wq-bind.css?v=abc123def0', '/wq/wq-bind.js?v=abc123def0']);
  });
});

describe('wq.js jugnuCard: wq-card.js at wq.js\'s own ?v=', () => {
  const FN = cut(read('wq.js'), 'jugnuCard');
  const run = (ownSrc) => {
    const { document, head } = fakeDoc('/wq/wq.js', ownSrc);
    const ctx = { document, window: {} };
    vm.createContext(ctx);
    vm.runInContext(`var jcAsked = false;\n${FN}\njugnuCard();`, ctx);
    return head.map((e) => e.src);
  };
  test('?v=<hex>m: wq-card.js keeps the m', () => {
    expect(run('/wq/wq.js?v=abc123def0m')).toEqual(['/wq/wq-card.js?v=abc123def0m']);
  });
  test('?v=<hex>: today\'s URL', () => {
    expect(run('/wq/wq.js?v=abc123def0')).toEqual(['/wq/wq-card.js?v=abc123def0']);
  });
});

describe('wq.js finishCard: wq-finish-card.js at wq.js\'s own ?v=', () => {
  const FN = cut(read('wq.js'), 'finishCard');
  const run = (ownSrc) => {
    const { document, head } = fakeDoc('/wq/wq.js', ownSrc);
    const ctx = { document, window: {} };
    vm.createContext(ctx);
    vm.runInContext(`var fcAsked = false;\n${FN}\nfinishCard();`, ctx);
    return head.map((e) => e.src);
  };
  test('?v=<hex>m: wq-finish-card.js keeps the m', () => {
    expect(run('/wq/wq.js?v=abc123def0m')).toEqual(['/wq/wq-finish-card.js?v=abc123def0m']);
  });
  test('?v=<hex>: today\'s URL', () => {
    expect(run('/wq/wq.js?v=abc123def0')).toEqual(['/wq/wq-finish-card.js?v=abc123def0']);
  });
});

describe('wq-challenge.js: wq-g1.js at the page\'s own ?v= (the whole page, wqc-page-harness)', () => {
  const COPY_KEYS = { title: 'jg.g1.title', say: 'jg.g1.say' };
  const G1_MENU = { form: 'G1', exercises: [{ id: 'numbers', copy_keys: COPY_KEYS, mins: 2, done: false, last: null, anchor_block: 'G1A' }], record: true, period_id: null, rt: false };
  const PAYLOAD = {
    ex: 'numbers', form: 'G1', lang: 'en', ct: 'CTG1', copy_keys: COPY_KEYS, anchor_block: 'G1A', stop_after: 0, per_item_s: 10,
    items: [{ item_id: 'numid.G1.A.03', n: 3, layout: 'tenframe', tiles: [3, 2, 4] }],
    show_timer: false, sound_off_safe: true, mode: 'check', record: null, period_id: null, passage_id: null, item_set_id: null, exposure_no: 1,
    band: null, anchor_exposure_no: 1, draw: { outcome: 'served' },
  };
  const loads = async (chV) => {
    const p = page({ menu: G1_MENU, freshEls: true, clock: { t: 1000000 }, chV, scripts: { '/wq/wq-g1.js': read('wq-g1.js') }, routes: { 'ch/HUB\\.TOKEN/numbers': ok(PAYLOAD) } });
    await p.flush();
    await p.click('wqc-ex-numbers');
    await p.flush();
    return p.loaded;
  };
  test('?v=<hex>m: wq-g1.js keeps the m', async () => {
    expect(await loads('abc1234567m')).toEqual(['/wq/wq-g1.js?v=abc1234567m']);
  });
  test('?v=<hex>: today\'s URL', async () => {
    expect(await loads('abc1234567')).toEqual(['/wq/wq-g1.js?v=abc1234567']);
  });
});

describe('wq-trail.js raLoad: the read-along player at its own fixed version (raw, documented)', () => {
  const SRC = read('wq-trail.js');
  test('it loads /wq/wq-readalong.js?v=RA_V, RA_V being the hash of today\'s file (no m: the raw file at its own URL)', () => {
    const RA_V = /var RA_V = '([0-9a-f]+)';/.exec(SRC)[1];
    expect(RA_V).toBe(crypto.createHash('sha256').update(fs.readFileSync(path.join(WQ, 'wq-readalong.js'))).digest('hex').slice(0, 10));
    const FN = cut(SRC, 'raLoad');
    const { document, head } = fakeDoc('/wq/wq-trail.js', '/wq/wq-trail.js?v=abc123def0m');
    const ctx = { document, window: {}, RA_V };
    vm.createContext(ctx);
    // raLoad's load listener (`warm`, the clip preload) lives beside it in wq-trail.js: a stand-in here
    vm.runInContext(`${FN}\nfunction warm() {}\nraLoad();`, ctx);
    expect(head.map((e) => e.src)).toEqual([`/wq/wq-readalong.js?v=${RA_V}`]);
  });
});
