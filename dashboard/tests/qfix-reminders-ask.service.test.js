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

function page() {
  const posts = [];
  const reg = { pushManager: { subscribe: async () => null, getSubscription: async () => null } };
  const sw = { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
  const ctx = {
    console, Promise, JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error, encodeURIComponent, decodeURIComponent, Uint8Array,
    setTimeout, clearTimeout, Intl, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { host: 'wq.example', protocol: 'https:' },
    navigator: { userAgent: UA_CHROME, serviceWorker: sw },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null },
    fetch: async (url, init) => {
      if (init && init.method === 'POST') { posts.push({ url, body: JSON.parse(init.body) }); return { status: 200, json: async () => ({ ok: 1 }) }; }
      return { status: 200, json: async () => ({ key: 'BPUBKEYAAAA' }) };
    },
    PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: async () => 'default' },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return { ctx, slot, steps: () => posts.filter((p) => p.url === '/api/wqpush/e').map((p) => [p.body.step, p.body.src]) };
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
