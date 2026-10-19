/**
 * Deck v2.3 lifts on the child pages: every page string below is byte-equal to its key in
 * bot/shared/config/copy.v2.json (EN and UR, U+00A0 and the isolates included). Each page's copy table is read from
 * the shipped file: the exported one through a vm, the others by evaluating the table literal itself (no page code
 * runs). Plus the bind hand-off: "This code works for the next hour." sits under the wa.me button, and only there.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const src = (f) => fs.readFileSync(path.join(WQ, f), 'utf8');
const deckRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bot', 'shared', 'config', 'copy.v2.json'), 'utf8'));
const DECK = deckRaw.keys || deckRaw;

// The object literal that follows `marker` in a page file (strings, template literals and comments skipped).
function literalAfter(code, marker) {
  const at = code.indexOf(marker);
  if (at < 0) throw new Error('marker not found: ' + marker);
  const start = code.indexOf('{', at + marker.length);
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); continue; }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i) + 1; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return code.slice(start, i + 1);
  }
  throw new Error('unclosed literal after ' + marker);
}
// The table's values are plain strings and functions; the few free names a value may touch are given here.
const table = (file, marker) => vm.runInNewContext('(' + literalAfter(src(file), marker) + ')', { MASCOT: 'Jugnu', UR2: false, SUBJ_UR: {}, ud: String });
const trailT = () => { const ctx = { window: {}, document: {} }; vm.createContext(ctx); vm.runInContext(src('wq-trail.js'), ctx); return ctx.window.WQTRAIL.T; };

// Bind page (wq-bind.js), whole, in a vm with a small fake DOM; the bot API (fetch) and storage are the fakes.
function bindPage(api) {
  const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const ctx = {
    window: { addEventListener() {}, open() {} },
    document: { visibilityState: 'visible', addEventListener() {} },
    localStorage: store({}), sessionStorage: store({}), location: { assign() {} },
    fetch: (url, init) => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(JSON.stringify(api[`${(init && init.method) || 'GET'} ${url.replace(/\?.*$/, '')}`] || {})) }),
    Date, JSON, Promise, encodeURIComponent, setTimeout, console,
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  // wq-tel.js first, as on the hub page (its WQT.nowrap holds «واٹس ایپ» on one line).
  vm.runInContext(src('wq-tel.js'), ctx);
  vm.runInContext(src('wq-bind.js'), ctx);
  return ctx.window.WQBIND;
}
function mount() {
  const els = {};
  return {
    els, _h: '',
    set innerHTML(h) {
      this._h = h;
      for (const k of Object.keys(els)) delete els[k];
      for (const m of h.matchAll(/data-b="([^"]+)"/g)) els[m[1]] = { l: [], addEventListener(n, fn) { this.l.push(fn); }, click() { this.l.forEach((f) => f({ preventDefault() {} })); } };
    },
    get innerHTML() { return this._h; },
    querySelector(sel) { const m = /data-b="([^"]+)"/.exec(sel); return m ? els[m[1]] || null : null; },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LIFTS = [
  ['jg.keep.notice', 'wq-trail.js T.noticeT', () => trailT(), 'noticeT'],
  ['jg.keep.notice_ok', 'wq-trail.js T.noticeOk', () => trailT(), 'noticeOk'],
  ['jg.lantern.trail_many', 'wq-trail.js T.lanternTrailMany', () => trailT(), 'lanternTrailMany'],
  ['jg.lantern.trail_many', 'hub-play.js T.lanternTrailMany', () => table('hub-play.js', 'var T = '), 'lanternTrailMany'],
  ['jg.trail.listen_down', 'wq-challenge.js T.listenWrong', () => table('wq-challenge.js', 'var T = '), 'listenWrong'],
  ['jg.card.sub', 'wq-card.js W.cardSub', () => table('wq-card.js', 'var W = '), 'cardSub'],
  ['jg.card.title', 'wq-card.js W.cardTitle', () => table('wq-card.js', 'var W = '), 'cardTitle'],
  ['jg.bind.valid_hour', 'wq-bind.js T.validHour', () => { const B = bindPage({}); return { en: B.t('en'), ur: B.t('ur') }; }, 'validHour'],
  ['jg.who.someone_else', 'wq-trail.js T.whoSomeoneElse', () => trailT(), 'whoSomeoneElse'],
  ['jg.who.someone_else', 'wq.js TW.someone (wq-identity.js)', () => table('wq.js', 'var TW = ('), 'someone'],
  ['jg.lib.lock_say', 'wq-lib.js T.lockSay', () => table('wq-lib.js', 'var T = '), 'lockSay'],
  ['jg.lib.lock_say', 'hub.js COPY.lockSay', () => table('hub.js', 'var COPY = '), 'lockSay'],
  ['jg.trail.welcome_back', 'wq-trail.js T.welcomeBack', () => trailT(), 'welcomeBack'],
  ['jg.who.turn', 'wq-trail.js T.whoTurn', () => trailT(), 'whoTurn'],
  ['jg.who.turn', 'wq-card.js W.whoTurn', () => table('wq-card.js', 'var W = '), 'whoTurn'],
  ['jg.who.turn', 'class-link.js COPY.turn', () => table('class-link.js', 'var COPY = '), 'turn'],
  ['jg.link.is_here', 'class-link.js COPY.is_here', () => table('class-link.js', 'var COPY = '), 'is_here'],
];

describe('deck v2.3 lifts: byte-equal to bot/shared/config/copy.v2.json', () => {
  test.each(LIFTS)('%s -> %s (EN, UR)', (key, where, get, prop) => {
    expect(DECK[key]).toBeDefined();
    const T = get();
    for (const l of ['en', 'ur']) expect(T[l][prop]).toBe(DECK[key][l]);
  });
  test('the notice UR still isolates {name} itself (the page inserts the bare name)', () => {
    expect(trailT().ur.noticeT).toContain('⁨{name}⁩');
  });
});

describe('bind hand-off: the valid-hour line under the wa.me button', () => {
  // the sheet holds «واٹس ایپ» on one line (its chips() span), as every other sheet line
  const held = (h) => h.replace(/واٹس[ \u00a0]ایپ/g, '<span class="wqb-nowrap">واٹس\u00a0ایپ</span>');
  const MINT = { 'POST /api/wq/bind/mint': { ok: true, code: 'JUGNU-7KQ2X', href: 'https://wa.me/?text=x' } };
  test.each(['en', 'ur'])('%s: card and sheet without it; the send screen is today\'s plus the line, under the button', async (lang) => {
    const B = bindPage(MINT);
    const t = B.t(lang);
    const m = mount();
    expect(B.card(m, { hub: 'h.tok', kid: '0123456789abcdef', first: '<Name> Testwala', lang, ev() {} })).toBe(true);
    expect(m.innerHTML).not.toContain(esc(DECK['jg.bind.valid_hour'][lang]));
    m.els.keep.click();
    expect(m.innerHTML).toContain('data-b="yes"');
    expect(m.innerHTML).not.toContain(esc(DECK['jg.bind.valid_hour'][lang]));
    m.els.yes.click();
    await flush(); await flush();
    expect(m.innerHTML).toBe('<div class="wqb-card" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '"><p class="wqb-sub">' + held(esc(t.whoSends)) + '</p><a class="wqb-btn wqb-go wqb-wa" data-b="send" href="https://wa.me/?text=x" target="_blank" rel="noopener">' +
      esc(t.sendBtn) + '</a><p class="wqb-sub">' + esc(DECK['jg.bind.valid_hour'][lang]) + '</p></div>');
  });
});
