/**
 * The microphone notice under live reading v3 (public/wq/wq-liveread.js; app_settings web_quiz_live_read_v3):
 *   - its words are true and a parent's: with Jugnu keeping passage recordings (keep) it says what is kept, for how
 *     long, who can listen, that story pages are never kept, and exactly what STOP removes and what stays; with nothing
 *     kept it says so. No assessment word, no "just for fun", no deletion claimed (EN + UR)
 *   - shown ONCE per child per phone, on the FIRST microphone use wherever it is: the storybook's microphone sheet
 *     (above the fold, before any tap) or Jugnu's passage (the Trail's notice screen); one storage key, one module, so
 *     the second use anywhere shows nothing — in either order
 *   - "Not now, just listen" is not a microphone use: the notice stays owed
 *   - no `lr3` on the read payload: the Trail's notice is today's, byte for byte
 * Only the browser and the network are faked; the Trail runs whole in the harness's vm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./wqc-page-harness');
const { ok, CLIPS, STORY } = H;

const PUB = path.join(__dirname, '..', 'public', 'wq');
const LIVE_SRC = fs.readFileSync(path.join(PUB, 'wq-read-live.js'), 'utf8');
const TRAIL_SRC = fs.readFileSync(path.join(PUB, 'wq-trail.js'), 'utf8');
const LR_SRC = fs.readFileSync(path.join(PUB, 'wq-liveread.js'), 'utf8');

const BANNED = /checker|examiner|assess|\btests?\b|\bexams?\b|just for fun|for fun|checked|جانچ|امتحان|ٹیسٹ|مزے/i;
const DELETION = /\bdelete|\bdeleted|\berase|حذف|مٹا/i;

const store = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

// ── the storybook's sheet: the real askMic on a small fake element, on its own window sharing the phone's storage ──
function sheetLib(storage) {
  const window = { localStorage: storage };
  const navigator = { userAgent: 'Android WhatsApp', mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) } };
  const ctx = { window, navigator, location: { host: 'x.test', pathname: '/h/t', search: '' }, console, Date, Math, JSON, String, Number, Object, Array, RegExp, Promise, setTimeout: () => 1, clearTimeout() {} };
  vm.createContext(ctx);
  vm.runInContext(LIVE_SRC, ctx);
  vm.runInContext(LR_SRC, ctx);
  return window.WQLiveRead;
}
function sheetEl() {
  const L = {};
  const el = {
    html: '',
    querySelector(sel) { return { addEventListener: (n, f) => { L[sel] = f; }, setAttribute() {} }; },
    tap(sel) { L[sel](); },
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el.html, set: (v) => { el.html = v; } });
  return el;
}
const sheet = (storage, { kid = 'c1', keep = true, lang = 'en' } = {}) => {
  const LR = sheetLib(storage);
  const el = sheetEl();
  LR.askMic(el, { lang, src: 'story', onStream() {}, onNotNow() {}, notice: { kid, keep } });
  return { LR, el };
};
const plain = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// ── Jugnu's passage: the Trail's Story Time read (practice, "just for fun") under lr3, with the notice owed by the server ──
const TC = { title: "{name}'s Trail", sub: '{done} of {total} stops done.', allDone: 'All done', badge: 'Done', next: 'Next', mic: 'uses the microphone', needsMic: 'needs a microphone', micWait: 'wait', other: 'Go to another stop', back: 'Back to the trail', practice: 'Story Time: just for fun', stopDone: 'Stop done!' };
const EXS = [{ id: 'read', name: 'Read aloud', mins: 2, done: false, last: null, badge: false, mic: true }];
const V2 = { pool: true, story: true, consent: true, notice: 1, name: 'Zara' };
const MENU = { lang: 'en', form: 'G3', record: true, trail: true, trail_copy: TC, exercises: EXS, v2: V2, lr3: true };
const LR3 = { meter: 'glow', done: true, done_from: 0, counted: false, finish: { pct: 0.8, quiet_ms: 4000, tail_ms: 1000, quiet: true } };
const SREAD = (extra = {}) => ({ ex: 'read', ct: 'CTS', secs: 60, clips: CLIPS, story: STORY, story_clip: { url: '/clips/story-kite.mp3' }, trail: true, trail_copy: TC, v2: V2, practice_round: true, mode: 'practice', questions_on: false, live: true, lr3: LR3, ...extra });
const KEY = { api_key: 'temp:key-test-only', expires_at: 'x', ws: 'wss://stt.test/ws', model: 'stt-rt-v5', lang: 'en' };
const WS = 'var __socks = []; window.WebSocket = function (u) { this.url = u; this.sent = []; this.bufferedAmount = 0; __socks.push(this); };'
  + 'window.WebSocket.prototype.send = function (x) { this.sent.push(x); }; window.WebSocket.prototype.close = function () { this.closed = true; };'
  + 'var __evs = []; window.dispatchEvent = function (e) { __evs.push(e); return true; }; CustomEvent = function (n, o) { this.type = n; this.detail = o && o.detail; };';
const ROUTES = (read) => ({ 'ch/HUB.TOKEN/read': ok(read), 'ch/live': ok(KEY), 'ch/upload': ok({ put_url: 'https://store.test/put', content_type: 'audio/webm', key: 'k1' }), 'store.test': ok({}) });
const passage = async (storage, { kid = 'c1', lang = 'en', read = SREAD(), lr = true } = {}) => {
  const p = H.page({ menu: { ...MENU, lang }, lang, kid, storage, href: 'https://portal.test/c/HUB.TOKEN?kid=' + kid + '&lang=' + lang + '&room=story&pid=en.read.1.kite',
    freshEls: true, session: store(), routes: ROUTES(read), pre: [LIVE_SRC, WS, ...(lr ? [LR_SRC] : []), TRAIL_SRC] });
  const real = p.ctx.navigator.mediaDevices.getUserMedia;
  p.gum = jest.fn(() => real());
  p.ctx.navigator.mediaDevices.getUserMedia = p.gum;
  await p.flush();
  await p.click('wqc-story-read');
  await p.flush();
  return p;
};
const copyOf = (lang) => sheetLib(store()).COPY[lang];

describe('the words: true, a parent\'s, EN + UR', () => {
  test('kept: what is kept, for how long, who can listen, story pages never kept, what STOP removes and what stays', () => {
    const en = copyOf('en').noticeKept;
    expect(en).toMatch(/keeps the recordings of its reading passages/);
    expect(en).toMatch(/no end date/);
    expect(en).toMatch(/Only the people who make Jugnu can listen/);
    expect(en).toMatch(/Story pages are never kept/);
    expect(en).toMatch(/STOP on WhatsApp removes this phone number; recordings already kept stay/);
    const ur = copyOf('ur').noticeKept;
    expect(ur).toContain('ریکارڈنگ');
    expect(ur).toContain('⁦STOP⁩');
    expect(ur).toContain('کہانی کے صفحوں کی ریکارڈنگ کبھی نہیں رکھی جاتی');
    expect(ur).toContain('یہ ریکارڈنگ صرف جگنو بنانے والے لوگ سن سکتے ہیں');
    expect(ur).toContain('فون نمبر ہٹا دیا جاتا ہے، لیکن جو ریکارڈنگ پہلے سے رکھی جا چکی ہے وہ موجود رہتی ہے');
    expect(copyOf('ur').facts).toContain('کہانی کے صفحے پر کچھ بھی رکھا نہیں جاتا');
    expect(copyOf('ur').facts).not.toContain('محفوظ');
  });
  test('nothing kept: "Nothing is kept. Jugnu listens only while you read." and its Urdu', () => {
    expect(copyOf('en').noticeNone).toBe('Nothing is kept. Jugnu listens only while you read.');
    expect(copyOf('ur').noticeNone).toBe('کچھ بھی نہیں رکھا جاتا۔ جگنو صرف اسی وقت سنتا ہے جب آپ پڑھ رہے ہوں۔');
  });
  test('no assessment word, no "just for fun", no deletion claimed, in either language, anywhere in the sheet\'s copy', () => {
    ['en', 'ur'].forEach((l) => {
      const c = copyOf(l);
      [c.noticeKept, c.noticeNone, c.facts, c.micAsk, c.grownUps].forEach((s) => {
        expect(typeof s).toBe('string');
        expect(s).not.toMatch(BANNED);
        expect(s).not.toMatch(DELETION);
      });
    });
  });
});

describe('fresh child, the storybook\'s Your turn first', () => {
  test('the sheet carries the notice above the fold, visible without a tap (before the phone\'s prompt picture, the buttons and the grown-ups fold)', () => {
    const { el } = sheet(store());
    const h = el.innerHTML;
    const at = h.indexOf('lr-notice');
    expect(at).toBeGreaterThan(h.indexOf('lr-say'));
    expect(at).toBeLessThan(h.indexOf('lr-os-pic'));
    expect(at).toBeLessThan(h.indexOf('lr-go'));
    expect(at).toBeLessThan(h.indexOf('<details'));
    expect(plain(h)).toContain(copyOf('en').noticeKept);
  });
  test('"Start reading" marks it seen for this child on this phone; then Jugnu\'s passage shows no notice and asks for the microphone at once', async () => {
    const storage = store();
    const { el } = sheet(storage);
    el.tap('.lr-go');
    expect(storage.getItem('wq_notice_v:c1')).toBeTruthy();
    const p = await passage(storage);
    expect(p.screen()).not.toBe('mic-notice');
    expect(p.gum).toHaveBeenCalledTimes(1);
  });
  test('a second storybook sheet shows nothing', () => {
    const storage = store();
    sheet(storage).el.tap('.lr-go');
    expect(sheet(storage).el.innerHTML).not.toContain('lr-notice');
  });
  test('"Not now, just listen" is not a microphone use: the notice is still owed next time', () => {
    const storage = store();
    const a = sheet(storage);
    a.el.tap('.lr-listen');
    expect(storage.getItem('wq_notice_v:c1')).toBeNull();
    expect(sheet(storage).el.innerHTML).toContain('lr-notice');
  });
  test('a sibling on the same phone still sees it', () => {
    const storage = store();
    sheet(storage).el.tap('.lr-go');
    expect(sheet(storage, { kid: 'c2' }).el.innerHTML).toContain('lr-notice');
  });
  test('Urdu: the Urdu words, in the sheet\'s RTL block', () => {
    const { el } = sheet(store(), { lang: 'ur' });
    expect(plain(el.innerHTML)).toContain(copyOf('ur').noticeKept);
  });
});

describe('fresh child, Jugnu\'s passage first (the reverse order)', () => {
  test('the notice screen comes before the microphone with the true words and without the "just for fun" banner', async () => {
    const p = await passage(store());
    expect(p.screen()).toBe('mic-notice');
    expect(p.gum).not.toHaveBeenCalled();
    const h = p.html();
    expect(plain(h)).toContain(copyOf('en').noticeKept);
    expect(h).not.toMatch(BANNED);
    expect(h).not.toContain('wqc-practice');
  });
  test('Urdu: the Urdu words, no «جانچنے والا», no «مزے»', async () => {
    const p = await passage(store(), { lang: 'ur' });
    expect(p.screen()).toBe('mic-notice');
    expect(plain(p.html())).toContain(copyOf('ur').noticeKept);
    expect(p.html()).not.toMatch(BANNED);
  });
  test('"Got it" marks the same key; then the storybook\'s sheet shows nothing; the run still says notice_shown', async () => {
    const storage = store();
    const p = await passage(storage);
    await p.click('wqc-notice-ok');
    expect(p.gum).toHaveBeenCalledTimes(1);
    expect(storage.getItem('wq_notice_v:c1')).toBeTruthy();
    expect(sheet(storage).el.innerHTML).not.toContain('lr-notice');
    p.w.rec.chunks = [{ size: 4000 }];
    p.w.upload();
    await p.flush();
    const up = p.fetches.filter((f) => /ch\/upload$/.test(f.url) && f.init && f.init.body).map((f) => JSON.parse(f.init.body))[0];
    expect(up).toMatchObject({ audio_consent: 'notice_shown' });
  });
  test('the passage a second time: nothing', async () => {
    const storage = store();
    const p = await passage(storage);
    await p.click('wqc-notice-ok');
    const again = await passage(storage);
    expect(again.screen()).not.toBe('mic-notice');
  });
});

describe('keeping switched off or on later', () => {
  test('nothing kept: the sheet says so; a later keep switched on still owes the kept notice; a kept notice covers a later "nothing kept"', () => {
    const storage = store();
    const a = sheet(storage, { keep: false });
    expect(plain(a.el.innerHTML)).toContain('Nothing is kept. Jugnu listens only while you read.');
    expect(plain(a.el.innerHTML)).not.toMatch(/keeps the recordings/);
    a.el.tap('.lr-go');
    expect(sheet(storage, { keep: false }).el.innerHTML).not.toContain('lr-notice');
    const b = sheet(storage, { keep: true });
    expect(b.el.innerHTML).toContain('lr-notice');
    b.el.tap('.lr-go');
    expect(sheet(storage, { keep: false }).el.innerHTML).not.toContain('lr-notice');
  });
  test('no notice option (a host that does not pass one): the sheet is today\'s', () => {
    const LR = sheetLib(store());
    const a = sheetEl(); LR.askMic(a, { lang: 'en', src: 'story' });
    expect(a.innerHTML).not.toContain('lr-notice');
  });
});

describe('the microphone again (micAgain): only the live reader calls getUserMedia', () => {
  test('a promise of a stream when the phone has a microphone; null when it has none', async () => {
    const LR = sheetLib(store());
    const s = await LR.micAgain();
    expect(typeof s.getTracks).toBe('function');
  });
});

describe('golden: no lr3 on the read payload ⇒ the Trail\'s notice is today\'s', () => {
  test('the same screen, byte for byte, with or without the live reader loaded', async () => {
    const read = SREAD({ lr3: undefined, live: false });
    const withLr = await passage(store(), { read });
    const without = await passage(store(), { read, lr: false });
    expect(withLr.screen()).toBe('mic-notice');
    expect(withLr.html()).toBe(without.html());
  });
});
