'use strict';
/**
 * The child's web-push reminder at the edge (routes/push-remind.routes.js; switch web_quiz_push_remind, decided by the
 * BOT for every route but /sw.js, which reads the edge's own 30 s app_settings value). Off — the bot's 404, no bot, a
 * junk code — the page falls through and the API answers 404 {error:'not_found'}; /sw.js answers the kill-switch worker.
 * Also the three browser files read as source (sw.js has no fetch handler; sw-off.js only unregisters) and wq-remind.js
 * run against a small fake DOM (no jsdom in this package). Invented values.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { createPushRemindRouter, renderRemindPage } = require('../routes/push-remind.routes');

const WQ = path.join(__dirname, '..', 'public', 'wq');
const read = (f) => fs.readFileSync(path.join(WQ, f), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/.*$/gm, '$1');
const FETCH_HANDLER_RX = /\bfetch\b\s*['"]?\s*[,)]/;

function start({ bot = () => ({ status: 404, body: { off: true } }), on = () => false, botUrl = 'http://bot.test', apiKey = 'k' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = bot(url, init);
    if (r.throw) throw new Error('down');
    return { status: r.status, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(r.body || {}) };
  };
  const app = express();
  app.use(createPushRemindRouter({ botUrl, apiKey, fetchImpl, on, logEvent: () => {} }));
  app.use((req, res) => res.status(404).send('portal'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, () => r({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}

let s;
afterEach(() => new Promise((r) => (s ? s.server.close(() => { s = null; r(); }) : r())));

describe('edge routes', () => {
  test('switch off at the bot: /remind/:code falls through, the API answers 404 not_found', async () => {
    s = await start();
    const page = await fetch(`${s.base}/remind/AB12CD`);
    expect(page.status).toBe(404);
    expect(await page.text()).toBe('portal');
    expect(s.calls[0].url).toBe('http://bot.test/api/internal/wqpush/state');
    const key = await fetch(`${s.base}/api/wqpush/key`);
    expect(key.status).toBe(404);
    expect(await key.json()).toEqual({ error: 'not_found' });
    for (const op of ['subscribe', 'unsubscribe', 'opened', 'test', 'e']) {
      const r = await fetch(`${s.base}/api/wqpush/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'not_found' });
    }
  });

  test('a junk code, no bot configured, or the bot down: falls through', async () => {
    s = await start({ bot: () => ({ status: 200, body: { remind: true, test: false } }) });
    expect(await (await fetch(`${s.base}/remind/no!`)).text()).toBe('portal');
    expect(await (await fetch(`${s.base}/remind/ABCDEFGHIJKLMNOP`)).text()).toBe('portal');
    expect(s.calls).toHaveLength(0);
    s.server.close();
    s = await start({ bot: () => ({ throw: true }) });
    expect(await (await fetch(`${s.base}/remind/AB12CD`)).text()).toBe('portal');
    const k = await fetch(`${s.base}/api/wqpush/key`);
    expect(k.status).toBe(503);
    s.server.close();
    s = await start({ botUrl: '' });
    expect(await (await fetch(`${s.base}/remind/AB12CD`)).text()).toBe('portal');
    expect((await fetch(`${s.base}/api/wqpush/key`)).status).toBe(404);
  });

  test('/sw.js: the kill-switch worker when off, the worker when on, both with the three headers', async () => {
    let on = false;
    s = await start({ on: () => on });
    const off = await fetch(`${s.base}/sw.js`);
    expect(off.status).toBe(200);
    expect(off.headers.get('content-type')).toMatch(/^application\/javascript/);
    expect(off.headers.get('cache-control')).toBe('no-cache');
    expect(off.headers.get('service-worker-allowed')).toBe('/');
    expect(await off.text()).toBe(read('sw-off.js'));
    on = true;
    const onR = await fetch(`${s.base}/sw.js`);
    expect(onR.headers.get('content-type')).toMatch(/^application\/javascript/);
    expect(onR.headers.get('cache-control')).toBe('no-cache');
    expect(onR.headers.get('service-worker-allowed')).toBe('/');
    expect(await onR.text()).toBe(read('sw.js'));
  });

  test('/remind/:code on: the shell (Urdu by default, English by ?lang or the phone), the boot, no name', async () => {
    s = await start({ bot: () => ({ status: 200, body: { remind: true, test: true } }) });
    const r = await fetch(`${s.base}/remind/AB12CD`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(r.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(r.headers.get('referrer-policy')).toBe('same-origin');
    const ur = await r.text();
    expect(ur).toContain('<html lang="ur" dir="rtl">');
    expect(ur).toContain('کیا جگنو کل آپ کو یاد دلائے؟');
    expect(ur).toContain('Want Jugnu to remind you tomorrow?');
    expect(ur).toContain('"code":"AB12CD"');
    expect(ur).toContain('"test":true');
    expect(ur).toMatch(/\/wq\/wq-remind\.js\?v=[0-9a-f]{10}/);
    expect(ur).toMatch(/\/wq\/wq\.css\?v=[0-9a-f]{10}/);
    expect(s.calls[0].init.headers['x-api-key']).toBe('k');
    const en = await (await fetch(`${s.base}/remind/AB12CD?lang=en`)).text();
    expect(en).toContain('<html lang="en" dir="ltr">');
    expect(en).toContain('"lang":"en"');
    const phone = await (await fetch(`${s.base}/remind/AB12CD`, { headers: { 'accept-language': 'en-GB,en;q=0.9' } })).text();
    expect(phone).toContain('<html lang="en" dir="ltr">');
    const html = renderRemindPage({ code: 'AB12CD', lang: 'ur', test: false });
    expect(html).not.toMatch(/student|first_name|phone_number|name"/i);
    expect(html).toContain('"test":false');
  });

  test('the API forwards to the bot path with the key, the device and the body; the answer passes back', async () => {
    s = await start({ bot: (url) => (url.endsWith('/key') ? { status: 200, body: { key: 'BPUB' } } : { status: 200, body: { ok: 1 } }) });
    const k = await fetch(`${s.base}/api/wqpush/key`);
    expect(await k.json()).toEqual({ key: 'BPUB' });
    expect(s.calls[0].url).toBe('http://bot.test/api/internal/wqpush/key');
    expect(s.calls[0].init.method).toBe('GET');
    for (const op of ['subscribe', 'unsubscribe', 'opened', 'test', 'e']) {
      const body = { endpoint: 'https://push.example/x', step: 'yes' };
      const r = await fetch(`${s.base}/api/wqpush/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'wq_dv=dev-ref-1' }, body: JSON.stringify(body) });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: 1 });
      const c = s.calls[s.calls.length - 1];
      expect(c.url).toBe(`http://bot.test/api/internal/wqpush/${op}`);
      expect(c.init.method).toBe('POST');
      expect(c.init.headers['x-api-key']).toBe('k');
      expect(c.body).toEqual(body);
    }
    // a 409 from the bot passes back as it came
    s.server.close();
    s = await start({ bot: () => ({ status: 409, body: { err: 'class_phone' } }) });
    const r = await fetch(`${s.base}/api/wqpush/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ err: 'class_phone' });
  });

  test('a body over 8 KB is refused; test is limited to 5 a minute', async () => {
    s = await start({ bot: () => ({ status: 200, body: { ok: 1 } }) });
    const big = await fetch(`${s.base}/api/wqpush/e`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(9000) }) });
    expect(big.status).toBe(413);
    const codes = [];
    for (let i = 0; i < 6; i += 1) {
      codes.push((await fetch(`${s.base}/api/wqpush/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('browser files (source)', () => {
  test('sw.js: push, notificationclick, pushsubscriptionchange; NO fetch handler of any kind', () => {
    const src = read('sw.js');
    const code = stripComments(src);
    expect(code).toMatch(/addEventListener\('push'/);
    expect(code).toMatch(/addEventListener\('notificationclick'/);
    expect(code).toMatch(/addEventListener\('pushsubscriptionchange'/);
    expect(code).not.toMatch(FETCH_HANDLER_RX);
    expect(code).not.toMatch(/onfetch/);
    expect(code).not.toMatch(/['"`]fetch['"`]/);
    expect(code).toContain('/api/wqpush/');
    expect(code).not.toContain('/api/wq/push');
    expect(code).toContain('/wq/jugnu/hello.webp');
    expect(code).toContain('یاد دہانی بند کریں');
    expect(code).toContain('Stop reminders');
    expect(code).not.toMatch(/caches\b|precache/);
  });

  test('the fetch-handler check itself catches a fetch listener', () => {
    expect("self.addEventListener('fetch', function () {})").toMatch(FETCH_HANDLER_RX);
    expect('self.addEventListener("fetch",f)').toMatch(FETCH_HANDLER_RX);
    expect("fetch('/api/wqpush/opened', {})").not.toMatch(FETCH_HANDLER_RX);
  });

  test('sw-off.js: unregisters, listens to nothing else', () => {
    const code = stripComments(read('sw-off.js'));
    expect(code).toContain('unregister()');
    expect(code).toContain('skipWaiting()');
    const events = [...code.matchAll(/addEventListener\(\s*['"]([a-z]+)['"]/g)].map((m) => m[1]).sort();
    expect(events).toEqual(['activate', 'install']);
    expect(code).not.toMatch(/\bfetch\b|\bpush\b|onmessage|onfetch|onpush/);
  });

  test('wq-remind.js: every copy key in both languages, no hash or ?p= read, the right API prefix', () => {
    const src = read('wq-remind.js');
    const ctx = { window: {}, document: { getElementById: () => null, querySelector: () => null } };
    ctx.window = ctx;
    vm.runInNewContext(src, ctx);
    const T = ctx.WQREMIND.T;
    const keys = ['remindTitle', 'remindBody', 'remindYes', 'remindLater', 'remindDone', 'remindTest', 'remindStop', 'remindDenied',
      'iabTitle', 'iabBody', 'iabChrome', 'iabHint', 'iabCopy', 'iosBody', 'noPush', 'play', 'stopped'];
    for (const k of keys) {
      expect(typeof T.en[k]).toBe('string');
      expect(typeof T.ur[k]).toBe('string');
      expect(T.ur[k]).toMatch(/[؀-ۿ]/);
      expect(T.ur[k]).not.toMatch(/[A-Za-z]/);
    }
    expect(Object.keys(T.en).sort()).toEqual(Object.keys(T.ur).sort());
    expect(src).not.toMatch(/location\.hash/);
    expect(src).not.toContain('?p=');
    expect(src).toContain('/api/wqpush/');
    expect(src).not.toContain('/api/wq/push');
    expect(src.split('requestPermission').length).toBe(2); // one caller: the Yes tap
  });
});

// ---- wq-remind.js against a small fake DOM ---------------------------------------------------------------------------
const UA_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const UA_WA = 'Mozilla/5.0 (Linux; Android 12; RMX3263 Build/SP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WhatsApp/2.24';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };

function page({ ua = UA_CHROME, key = { status: 200, body: { key: 'BPUBKEYAAAA' } }, push = true, install = null, perm = 'granted', regs = [], store = {}, existingSub = null } = {}) {
  const posts = [];
  const gets = [];
  const ls = { ...store };
  const sub = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'p', auth: 'a' } }; }, unsubscribe: jest.fn(async () => true) };
  let current = existingSub;
  const reg = { pushManager: { subscribe: jest.fn(async () => { current = sub; return sub; }), getSubscription: jest.fn(async () => current) } };
  const sw = {
    getRegistrations: jest.fn(async () => regs),
    getRegistration: jest.fn(async () => reg),
    register: jest.fn(async () => reg),
    ready: Promise.resolve(reg),
  };
  const Notification = { permission: 'default', requestPermission: jest.fn(async () => perm) };
  const ctx = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    setTimeout, clearTimeout,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Intl,
    location: { host: 'wq.example', protocol: 'https:' },
    navigator: { userAgent: ua, ...(push ? { serviceWorker: sw } : {}), clipboard: { writeText: jest.fn(async () => {}) } },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    document: {
      getElementById: (id) => (id === 'wqp-inst' ? install : null),
      querySelector: (sel) => (sel === '[data-door="install"]' && install === 'door' ? {} : null),
    },
    fetch: jest.fn(async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      gets.push(url);
      return { status: key.status, json: async () => key.body };
    }),
  };
  if (push) { ctx.PushManager = function PushManager() {}; ctx.Notification = Notification; }
  ctx.window = ctx;
  ctx.self = ctx;
  vm.runInNewContext(read('wq-remind.js'), ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  const tap = async (act) => {
    const el = { getAttribute: (a) => (a === 'data-act' ? act : null) };
    slot.onclick({ target: { closest: () => el }, preventDefault() {} });
    await flush();
  };
  return { ctx, slot, posts, gets, ls, sw, reg, sub, Notification, tap };
}

describe('wq-remind.js (fake DOM)', () => {
  test('key 404 (switch off): unregisters our /sw.js worker only, renders nothing', async () => {
    const mine = { active: { scriptURL: 'https://wq.example/sw.js' }, unregister: jest.fn(async () => true) };
    const other = { active: { scriptURL: 'https://wq.example/other.js' }, unregister: jest.fn(async () => true) };
    const p = page({ key: { status: 404, body: { error: 'not_found' } }, regs: [mine, other] });
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 1 });
    await flush();
    expect(p.gets).toEqual(['/api/wqpush/key']);
    expect(mine.unregister).toHaveBeenCalled();
    expect(other.unregister).not.toHaveBeenCalled();
    expect(p.slot.innerHTML).toBe('');
    expect(p.Notification.requestPermission).not.toHaveBeenCalled();
  });

  test('an install card on screen: nothing rendered, nothing asked', async () => {
    for (const install of [{ innerHTML: '<div>install</div>' }, 'door']) {
      const p = page({ install });
      p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 1 });
      await flush();
      expect(p.slot.innerHTML).toBe('');
      expect(p.gets).toEqual([]);
    }
  });

  test('a class phone (4 chips) never sees the card', async () => {
    const p = page();
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 4 });
    await flush();
    expect(p.slot.innerHTML).toBe('');
  });

  test('Chrome: the card (Urdu, rtl), permission asked only on Yes, then subscribe; never a test button on the results screen', async () => {
    const p = page();
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 1, test: true });
    await flush();
    const T = p.ctx.WQREMIND.T.ur;
    expect(p.slot.innerHTML).toContain(T.remindTitle);
    expect(p.slot.innerHTML).toContain('dir="rtl"');
    expect(p.slot.innerHTML).toContain('lang="ur"');
    expect(p.slot.innerHTML).toMatch(/class="wq-btn wq-soft"[^>]*data-act="yes"/);
    expect(p.Notification.requestPermission).not.toHaveBeenCalled();
    expect(p.posts.map((x) => x.body.step)).toEqual(['shown']);
    await p.tap('yes');
    expect(p.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(p.sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(p.reg.pushManager.subscribe).toHaveBeenCalled();
    expect(p.reg.pushManager.subscribe.mock.calls[0][0].userVisibleOnly).toBe(true);
    const subPost = p.posts.find((x) => x.url === '/api/wqpush/subscribe');
    expect(subPost.body).toMatchObject({ code: 'AB12CD', lang: 'ur', chips: 1, sub: { endpoint: 'https://push.example/abc' } });
    expect(p.slot.innerHTML).toContain(T.remindDone);
    expect(p.slot.innerHTML).toContain(T.remindStop);
    expect(p.slot.innerHTML).not.toContain(T.remindTest);
    expect(p.slot.innerHTML).not.toContain('data-act="test"');
    expect(p.posts.filter((x) => x.url === '/api/wqpush/e').map((x) => x.body.step)).toEqual(['shown', 'yes', 'granted', 'subscribed']);
  });

  test('landing: Done shows the Play door and, only with ctx.test, the test send', async () => {
    const p = page();
    p.ctx.WQREMIND.landing(p.slot, { code: 'AB12CD', lang: 'en', test: true });
    await flush();
    await p.tap('yes');
    const T = p.ctx.WQREMIND.T.en;
    expect(p.slot.innerHTML).toContain(T.remindDone);
    expect(p.slot.innerHTML).toContain('href="/q/AB12CD"');
    expect(p.slot.innerHTML).toContain(T.remindTest);
    await p.tap('test');
    expect(p.posts.find((x) => x.url === '/api/wqpush/test').body).toEqual({ endpoint: 'https://push.example/abc' });
    const q = page();
    q.ctx.WQREMIND.landing(q.slot, { code: 'AB12CD', lang: 'en', test: false });
    await flush();
    await q.tap('yes');
    expect(q.slot.innerHTML).not.toContain(T.remindTest);
  });

  test('Stop: unsubscribes at the bot (by page) and in the browser', async () => {
    const p = page();
    p.ctx.WQREMIND.landing(p.slot, { code: 'AB12CD', lang: 'en' });
    await flush();
    await p.tap('yes');
    await p.tap('stop');
    expect(p.posts.find((x) => x.url === '/api/wqpush/unsubscribe').body).toEqual({ endpoint: 'https://push.example/abc', by: 'page' });
    expect(p.sub.unsubscribe).toHaveBeenCalled();
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T.en.stopped);
  });

  test('denied: the note, then 30 days of quiet; Not now: 7 days of quiet', async () => {
    const p = page({ perm: 'denied' });
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    await p.tap('yes');
    expect(p.slot.innerHTML).toContain(p.ctx.WQREMIND.T.en.remindDenied);
    expect(Number(p.ls.wq_rm_asked)).toBeGreaterThan(0);
    const again = page({ store: { wq_rm_asked: String(Date.now()) } });
    again.ctx.WQREMIND.mount(again.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(again.slot.innerHTML).toBe('');

    const l = page();
    l.ctx.WQREMIND.mount(l.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    await l.tap('later');
    expect(l.slot.innerHTML).toBe('');
    expect(Number(l.ls.wq_rm_later)).toBeGreaterThan(0);
    const later = page({ store: { wq_rm_later: String(Date.now() - 6 * 864e5) } });
    later.ctx.WQREMIND.mount(later.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(later.slot.innerHTML).toBe('');
    const after = page({ store: { wq_rm_later: String(Date.now() - 8 * 864e5) } });
    after.ctx.WQREMIND.mount(after.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(after.slot.innerHTML).toContain(after.ctx.WQREMIND.T.en.remindTitle);
  });

  test("WhatsApp's Android browser: the escape card (intent to Chrome at /remind/<code>?from=iab, hint, copy link)", async () => {
    const p = page({ ua: UA_WA });
    p.ctx.WQREMIND.mount(p.slot, { code: 'AB12CD', lang: 'ur', chips: 1 });
    await flush();
    const T = p.ctx.WQREMIND.T.ur;
    expect(p.slot.innerHTML).toContain(T.iabTitle);
    expect(p.slot.innerHTML).toContain(T.iabHint);
    expect(p.slot.innerHTML).toMatch(/href="intent:\/\/wq\.example\/remind\/AB12CD\?from=iab[^"]*#Intent;scheme=https;package=com\.android\.chrome;S\.browser_fallback_url=https%3A%2F%2Fwq\.example%2Fremind%2FAB12CD%3Ffrom%3Diab[^"]*;end"/);
    expect(p.slot.innerHTML).toContain('data-act="copy"');
    await p.tap('copy');
    expect(p.ctx.navigator.clipboard.writeText.mock.calls[0][0]).toMatch(/^https:\/\/wq\.example\/remind\/AB12CD\?from=iab/);
    expect(p.Notification.requestPermission).not.toHaveBeenCalled();
  });

  test('iPhone (not installed): explain only; a browser with no push: one line', async () => {
    const i = page({ ua: UA_IOS, push: false });
    i.ctx.WQREMIND.mount(i.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(i.slot.innerHTML).toContain(i.ctx.WQREMIND.T.en.iosBody);
    expect(i.slot.innerHTML).not.toContain('data-act="yes"');
    const n = page({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/115.0', push: false });
    n.ctx.WQREMIND.mount(n.slot, { code: 'AB12CD', lang: 'en', chips: 1 });
    await flush();
    expect(n.slot.innerHTML).toContain(n.ctx.WQREMIND.T.en.noPush);
  });
});
