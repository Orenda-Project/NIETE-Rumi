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
function page(now = TUE) {
  const posts = [];
  const reg = { pushManager: { subscribe: async () => null, getSubscription: async () => null } };
  const sw = { getRegistrations: async () => [], getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) };
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
      return { status: 200, json: async () => ({ key: 'BPUBKEYAAAA' }) };
    },
    PushManager: function PushManager() {}, Notification: { permission: 'default', requestPermission: async () => 'default' },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(SRC, ctx);
  const slot = { innerHTML: '', onclick: null, setAttribute() {}, removeAttribute() {} };
  return { ctx, slot, html: () => slot.innerHTML, steps: () => posts.filter((p) => p.url === '/api/wqpush/e').map((p) => [p.body.step, p.body.src]) };
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
    ['Tue', TUE, 'en', 'Want Jugnu to remind you tomorrow evening?'],
    ['Sun', SUN, 'en', 'Want Jugnu to remind you tomorrow evening?'],
    ['Fri', FRI, 'en', 'Want Jugnu to remind you on Monday evening?'],
    ['Sat', SAT, 'en', 'Want Jugnu to remind you on Monday evening?'],
    ['Tue', TUE, 'ur', 'کیا جگنو کل شام آپ کو یاد دلائے؟'],
    ['Fri', FRI, 'ur', 'کیا جگنو پیر کی شام آپ کو یاد دلائے؟'],
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
test('the worker\'s fallback line is the hub\'s own: a game is waiting', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'sw.js'), 'utf8');
  expect(sw).toContain("b: 'A game is waiting for you. Tap to play.'");
  expect(sw).toContain("b: 'ایک کھیل آپ کا انتظار کر رہا ہے۔ کھیلنے کے لیے دبائیں۔'");
  expect(sw).not.toContain("Today's quiz is ready");
});
