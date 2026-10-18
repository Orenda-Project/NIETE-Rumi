/**
 * The designed wait across a page hop (app_settings web_quiz_wait_hops, decided by the bot: the hub answer says
 * `wait_hops: true`, only with `wait_ux`). A child who taps «My class», «My school», a game or a quiz leaves the hub
 * page; until the next page's first bytes arrive (3.6–5.5 s on slow 4G) the old page sat still with no sign of life.
 * On, the bar's piece also starts when the page begins to leave (beforeunload): the bar shows 400 ms in and creeps, as
 * for any wait, and a page brought back from the back/forward cache (pageshow, persisted) ends it.
 * Off: the piece is today's, byte for byte (WaitUx.TAG), and leaving shows nothing.
 */
const http = require('http');
const vm = require('vm');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const WaitUx = require('../routes/web-quiz-wait-ux');

describe('the piece', () => {
  test('wait_ux with wait_hops: the hop piece; wait_ux alone: today\'s piece, byte for byte; hops without wait_ux: nothing', () => {
    expect(WaitUx.tag({ wait_ux: true })).toBe(WaitUx.TAG);
    expect(WaitUx.tag({ wait_ux: true, wait_hops: true })).toBe(WaitUx.TAG_HOPS);
    expect(WaitUx.TAG_HOPS).not.toBe(WaitUx.TAG);
    expect(WaitUx.tag({ wait_hops: true })).toBe('');
    expect(WaitUx.tag({ wait_ux: true, wait_hops: 'true' })).toBe(WaitUx.TAG);
  });
  test('the hop piece is today\'s piece plus the hop lines only (the bar, Jugnu and the fetch count unchanged)', () => {
    const HOP = 'w.addEventListener("beforeunload",function(){lv=1;start();setTimeout(function(){lv=0;end()},15000)});'
      + 'w.addEventListener("pageshow",function(e){if(e&&e.persisted){lv=0;end()}});';
    const strip = WaitUx.JS_HOPS.replace('var lv=0;', '').replace('||lv', '').replace(HOP, '');
    expect(strip).toBe(WaitUx.JS);
  });
});

// ── run in a vm over a small fake DOM: a hub page with Home drawn (no opening frame), nothing in flight ──
function page(js) {
  const cls = (el) => ({ add: (c) => el.c.add(c), remove: (c) => el.c.delete(c), contains: (c) => el.c.has(c) });
  const mk = (tag) => { const el = { tag, c: new Set(), style: {}, attrs: {}, setAttribute(k, v) { el.attrs[k] = v; } }; el.classList = cls(el);
    Object.defineProperty(el, 'innerHTML', { set() { el.firstChild = mk('i'); } }); Object.defineProperty(el, 'className', { set(v) { v.split(' ').forEach((c) => el.c.add(c)); } }); return el; };
  const listeners = {};
  const document = { body: { appendChild(el) { document.bar = el; } }, createElement: mk, querySelector: () => null, getElementById: () => ({}) };
  const window = {
    MutationObserver: class { observe() {} },
    AbortController,
    fetch: () => new Promise(() => {}),
    addEventListener: (n, fn) => { (listeners[n] = listeners[n] || []).push(fn); },
  };
  vm.runInNewContext(js, { document, window, setTimeout, clearTimeout, setInterval, clearInterval, String, RegExp, Object });
  const fire = (n, e) => (listeners[n] || []).forEach((fn) => fn(e || {}));
  return { bar: document.bar, fire };
}

describe('the hop, run', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const settleOpening = (p) => { jest.advanceTimersByTime(1000); expect(p.bar.classList.contains('on')).toBe(false); };

  test('on: leaving the page brings the bar 400 ms in, creeping, and it stays while the next page is on its way', () => {
    const p = page(WaitUx.JS_HOPS);
    settleOpening(p);
    p.fire('beforeunload');
    jest.advanceTimersByTime(399);
    expect(p.bar.classList.contains('on')).toBe(false);
    jest.advanceTimersByTime(2);
    expect(p.bar.classList.contains('on')).toBe(true);
    jest.advanceTimersByTime(3000);
    expect(p.bar.classList.contains('on')).toBe(true);
    const w = parseFloat(p.bar.firstChild.style.width);
    expect(w).toBeGreaterThan(30);
    expect(w).toBeLessThan(90);
  });
  test('on: the page brought back from the back/forward cache ends the bar', () => {
    const p = page(WaitUx.JS_HOPS);
    settleOpening(p);
    p.fire('beforeunload');
    jest.advanceTimersByTime(1000);
    p.fire('pageshow', { persisted: true });
    jest.advanceTimersByTime(1000);
    expect(p.bar.classList.contains('on')).toBe(false);
  });
  test('on: a pageshow that is not from the cache changes nothing', () => {
    const p = page(WaitUx.JS_HOPS);
    settleOpening(p);
    p.fire('beforeunload');
    jest.advanceTimersByTime(1000);
    p.fire('pageshow', { persisted: false });
    jest.advanceTimersByTime(1000);
    expect(p.bar.classList.contains('on')).toBe(true);
  });
  test('on: a leave that never happens (a download, a cancelled tap) lets the bar go after 15 s', () => {
    const p = page(WaitUx.JS_HOPS);
    settleOpening(p);
    p.fire('beforeunload');
    jest.advanceTimersByTime(14000);
    expect(p.bar.classList.contains('on')).toBe(true);
    jest.advanceTimersByTime(2000);
    expect(p.bar.classList.contains('on')).toBe(false);
  });
  test('off (today\'s piece): leaving shows nothing', () => {
    const p = page(WaitUx.JS);
    settleOpening(p);
    p.fire('beforeunload');
    jest.advanceTimersByTime(2000);
    expect(p.bar.classList.contains('on')).toBe(false);
  });
});

// ── the edge learns it from the hub answer, like the bar ──
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({ lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra });
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const get = (srv, p) => new Promise((res, rej) => { http.get({ port: srv.address().port, path: p }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res(b)); }).on('error', rej); });
async function serve(answer, fn) {
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => jsonRes(200, answer), logEvent: () => {} }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { return await fn(srv); } finally { await new Promise((r) => srv.close(r)); }
}
describe('the edge', () => {
  test('after an answer with wait_hops, both the early frame and the page carry the hop piece once, and never today\'s piece too', async () => {
    await serve(HUB({ fast: true, wait_ux: true, wait_hops: true }), async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html.split(WaitUx.TAG_HOPS)).toHaveLength(2);
      expect(html.split(WaitUx.TAG)).toHaveLength(1);
    });
  });
  test('a frame flushed before this process learnt the switches: the hop piece rides the tail, once, and never today\'s piece too', async () => {
    let answer = HUB({ fast: true });
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => jsonRes(200, answer), logEvent: () => {} }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      await get(srv, `/h/${TOKEN}`);
      answer = HUB({ fast: true, wait_ux: true, wait_hops: true });
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html.split(WaitUx.TAG_HOPS)).toHaveLength(2);
      expect(html.split(WaitUx.TAG)).toHaveLength(1);
      expect(html.indexOf(WaitUx.TAG_HOPS)).toBeLessThan(html.lastIndexOf('/wq/hub.js')); // before the page's scripts
    } finally { await new Promise((r) => srv.close(r)); }
  });
  test('wait_ux alone: today\'s piece, no hop piece', async () => {
    await serve(HUB({ fast: true, wait_ux: true }), async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html.split(WaitUx.TAG)).toHaveLength(2);
      expect(html).not.toContain('beforeunload');
    });
  });
});
