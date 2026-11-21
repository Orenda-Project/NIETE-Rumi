'use strict';
/**
 * The reminder ask (wq-remind.js) says where it was answered: every step it posts carries src — 'result' on the quiz
 * result screen (WQREMIND.mount, the default), 'class_link' when the standing link mounts it under the chips
 * (ctx.src), 'landing' on /remind/:code. Fake DOM, invented values.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-remind.js'), 'utf8');
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

// PKT = UTC+5. Tue 25 Nov 2025 15:00 PKT, Fri 28 Nov, Sat 29 Nov, Sun 30 Nov.
const TUE = Date.parse('2025-11-25T10:00:00Z');
const FRI = Date.parse('2025-11-28T10:00:00Z');
const SAT = Date.parse('2025-11-29T10:00:00Z');
const SUN = Date.parse('2025-11-30T10:00:00Z');
function page(now = TUE, keyBody = { key: 'BPUBKEYAAAA' }) {
  const posts = [];
  const gets = [];
  const unregistered = [];
  const reg = { pushManager: { subscribe: async () => null, getSubscription: async () => null } };
  const mine = { active: { scriptURL: 'https://wq.example/sw.js' }, unregister: async () => { unregistered.push(1); return true; } };
  const sw = { getRegistrations: async () => [mine], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
  const ctx = {
    console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    Date: class extends Date { static now() { return now; } },
    setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' },
    navigator: { userAgent: UA_CHROME, serviceWorker: sw },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null },
    fetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      gets.push(url);
      return { status: 200, json: async () => keyBody };
    },
    PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: async () => 'default' },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return { ctx, slot, gets, unregistered, html: () => slot.innerHTML, steps: () => posts.filter((p) => p.url === '/api/wqpush/e').map((p) => [p.body.step, p.body.src]) };
}

test('the result screen (default): shown{src: result}', async () => {
  const p = page();
  p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 1 });
  await flush();
  expect(p.steps()).toEqual([['shown', 'result']]);
});
test('under the standing link\'s chips: shown{src: class_link}', async () => {
  const p = page();
  p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 2, src: 'class_link' });
  await flush();
  expect(p.steps()).toEqual([['shown', 'class_link']]);
});
test('a made-up src falls back to result', async () => {
  const p = page();
  p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 1, src: 'evil<' });
  await flush();
  expect(p.steps()).toEqual([['shown', 'result']]);
});

// The reminder comes on the next SCHOOL evening (17:30-18:00 PKT; never Sat/Sun): the ask says when, truthfully.
describe('the ask says when the reminder comes', () => {
  test.each([
    ['Tue', TUE, 'en', 'Jugnu can remind you tomorrow evening.'],
    ['Sun', SUN, 'en', 'Jugnu can remind you tomorrow evening.'],
    ['Fri', FRI, 'en', 'Jugnu can remind you on Monday evening.'],
    ['Sat', SAT, 'en', 'Jugnu can remind you on Monday evening.'],
    ['Tue', TUE, 'ur', 'جگنو کل شام آپ کو یاد دلا سکتا ہے۔'],
    ['Fri', FRI, 'ur', 'جگنو پیر کی شام آپ کو یاد دلا سکتا ہے۔'],
  ])('%s %s: %s', async (_d, now, lang, title) => {
    const p = page(now);
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang, chips: 1 });
    await flush();
    expect(p.html()).toContain(title);
    expect(p.html()).not.toMatch(/after school|اسکول کے بعد/);
  });
  test('the done line names the same evening', () => {
    const p = page(FRI);
    expect(p.ctx.WQREMIND.T.en.remindDoneMon).toBe('Done. Jugnu will remind you on Monday evening.');
    expect(p.ctx.WQREMIND.T.ur.remindDoneMon).toBe('ہو گیا۔ جگنو پیر کی شام یاد دلائے گا۔');
    expect(p.ctx.WQREMIND.T.en.remindDone).toBe('Done. Jugnu will remind you tomorrow evening.');
  });
  test('the /remind landing\'s title too (server-rendered)', () => {
    const { renderRemindPage } = require('../routes/push-remind.routes');
    expect(renderRemindPage({ code: 'AB12CD', lang: 'en', now: FRI })).toContain('<title>Want Jugnu to remind you on Monday evening?</title>');
    expect(renderRemindPage({ code: 'AB12CD', lang: 'ur', now: TUE })).toContain('<title>کیا جگنو کل شام آپ کو یاد دلائے؟</title>');
  });
});

// The tap opens the child's hub (a finished quiz bounces there), so the line never promises a new quiz.
test('the worker\'s fallback is the ruled no-class line: time to play, a quiz is waiting (A14: one noun)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'sw.js'), 'utf8');
  expect(sw).toContain("t: 'Jugnu: time to play ▶', b: 'A quiz is waiting for you.'");
  expect(sw).toContain("t: 'جگنو: کھیلنے کا وقت ہے ▶', b: 'ایک کوئز آپ کا انتظار کر رہا ہے۔'");
  expect(sw).not.toContain("Today's quiz is ready");
});

// The canary (web_quiz_push_canary): the key answer says whether THIS quiz may ask.
describe('the canary', () => {
  test('the key is asked with the quiz code', async () => {
    const p = page();
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(p.gets).toEqual(['/api/wqpush/key?code=AB12CD']);
  });
  test('ask:false: no card, no step, and the phone keeps its worker', async () => {
    const p = page(TUE, { key: 'BPUBKEYAAAA', ask: false });
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(p.html()).toBe('');
    expect(p.steps()).toEqual([]);
    expect(p.unregistered).toEqual([]);
  });
  test('the edge passes the code on to the bot for the key only, in the page\'s code shape', async () => {
    const http = require('http');
    const express = require('express');
    const { createPushRemindRouter } = require('../routes/push-remind.routes');
    const urls = [];
    const app = express();
    app.use(createPushRemindRouter({ botUrl: 'http://bot.test', apiKey: 'k', on: () => true, logEvent: () => {},
      fetchImpl: async (url) => { urls.push(url); return { status: 200, headers: { get: () => 'application/json' }, text: async () => '{"key":"B","ask":true}' }; } }));
    const srv = await new Promise((r) => { const x = http.createServer(app).listen(0, () => r(x)); });
    try {
      const base = `http://127.0.0.1:${srv.address().port}`;
      await fetch(`${base}/api/wqpush/key?code=AB12CD`);
      await fetch(`${base}/api/wqpush/key?code=../../x`);
      expect(urls).toEqual(['http://bot.test/api/internal/wqpush/key?code=AB12CD', 'http://bot.test/api/internal/wqpush/key']);
    } finally { await new Promise((r) => srv.close(r)); }
  });
});

// QF-R3: after Chrome's Allow the subscribe takes seconds (worker + push service); the card says so at once.
describe('the wait after Allow', () => {
  function granted() {
    let release;
    const subPosted = new Promise((r) => { release = r; });
    const posts = [];
    const sub = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; } };
    const reg = { pushManager: { subscribe: async () => sub, getSubscription: async () => null } };
    const sw = { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
    const ctx = {
      console, Promise, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
      Date: class extends Date { static now() { return TUE; } }, setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      location: { host: 'wq.example', protocol: 'https:' }, navigator: { userAgent: UA_CHROME, serviceWorker: sw }, matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { getElementById: () => null, querySelector: () => null },
      indexedDB: undefined,
      fetch: async (url, init) => {
        if (init && init.method === 'POST') {
          posts.push(url);
          if (url === '/api/wqpush/subscribe') await subPosted;
          return { status: 200, json: async () => ({ ok: 1 }) };
        }
        return { status: 200, json: async () => ({ key: 'BPUBKEYAAAA' }) };
      },
      PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: async () => 'granted' },
    };
    ctx.window = ctx; ctx.self = ctx;
    vm.runInNewContext(SRC, ctx);
    const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
    const tap = async (act) => { slot.onclick({ target: { closest: () => ({ getAttribute: (a) => (a === 'data-act' ? act : null) }) }, preventDefault() {} }); await flush(); };
    return { ctx, slot, tap, release, posts };
  }
  test.each([['en', 'Turning reminders on…'], ['ur', 'یاد دہانی آن ہو رہی ہے…']])('%s: "%s" while it subscribes, then done', async (lang, wait) => {
    const p = granted();
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang, chips: 1 });
    await flush();
    await p.tap('yes');
    expect(p.posts).toContain('/api/wqpush/subscribe');
    expect(p.slot.innerHTML).toContain(wait);
    expect(p.slot.innerHTML).toContain('aria-busy="true"');
    p.release();
    await flush();
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T[lang].remindDone);
  });
});

// QF-R4: the /remind page's other-language link is a 48 px target.
test('the /remind language link is at least 48×48', () => {
  const { renderRemindPage } = require('../routes/push-remind.routes');
  const html = renderRemindPage({ code: 'AB12CD', lang: 'ur', now: TUE });
  expect(html).toMatch(/\.wqr \.wqr-l\{[^}]*min-height:48px/);
  expect(html).toMatch(/\.wqr \.wqr-l\{[^}]*min-width:48px/);
});

// The lead's take A (one line, the score and "See my card" stay the heroes): no second paragraph on the result screen,
// a bell on Yes a 6-year-old finds without reading, and a hint behind Chrome's English sheet.
describe('take A: the one-line ask', () => {
  test.each(['en', 'ur'])('%s: one line, a bell Yes and Not now; no body paragraph on the result screen', async (lang) => {
    const p = page(TUE);
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang, chips: 1 });
    await flush();
    const T = p.ctx.WQREMIND.T[lang];
    expect(p.html()).not.toContain(T.remindBody);
    expect(p.html()).toMatch(/data-act="yes"[^>]*>[^<]*(<span[^>]*>)?🔔/);
    expect(p.html()).toContain(T.remindLater);
  });
  test('the /remind landing keeps the consent line', async () => {
    const p = page(TUE);
    p.ctx.WQREMIND.landing(p.slot, { code: 'AB12CD', lang: 'en' });
    await flush();
    expect(p.html()).toContain(p.ctx.WQREMIND.T.en.remindBody);
  });
  test.each([['en', 'Now tap Allow below'], ['ur', 'اب نیچے والے بٹن سے اجازت دیں']])('%s: while Chrome asks, the hint "%s"', async (lang, hint) => {
    const p = page(TUE);
    let answer;
    p.ctx.Notification.requestPermission = () => new Promise((r) => { answer = r; });
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang, chips: 1 });
    await flush();
    p.slot.onclick({ target: { closest: () => ({ getAttribute: (a) => (a === 'data-act' ? 'yes' : null) }) }, preventDefault() {} });
    await flush();
    expect(p.html()).toContain(hint);
    answer('denied');
    await flush();
    expect(p.html()).not.toContain(hint);
  });
});
