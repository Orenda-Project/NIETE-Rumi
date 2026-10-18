/**
 * The child pages' designed wait (app_settings web_quiz_wait_ux; the bot's hub answer says `wait_ux: true`;
 * routes/web-quiz-wait-ux.js). On: the hub page's frame carries a thin progress bar for any wait over 400 ms and
 * Jugnu's waiting moment for an opening over 1.5 s, on the buffered page and on the streamed (fast) page, which learns
 * the switch from the last hub answer. Off: every hub page is today's, byte for byte (a golden captured from the
 * code before this change). The piece's own script is run in a vm over a small fake DOM, with fake timers.
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const http = require('http');
const vm = require('vm');
const express = require('express');
const { createWebQuizRouter, renderHubPage } = require('../routes/web-quiz.routes');
const WaitUx = require('../routes/web-quiz-wait-ux');
const GOLDEN = require('./fixtures/wait-ux-off-hub-golden.json');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const ARGS = (payload) => ({ payload, token: TOKEN, origin: 'http://portal.example', assetV: 'v1' });

describe('the hub page', () => {
  test.each([['en', {}], ['ur', { lang: 'ur' }], ['fast', { fast: true }], ['not-true', { wait_ux: 'true' }]])('off (%s): today\'s page byte for byte', (name, extra) => {
    const html = renderHubPage(ARGS(HUB(extra)));
    expect(html).toBe(GOLDEN[name]);
    expect(html).not.toMatch(/wq-wbar|wq-wait/);
  });
  test('on: the bar and Jugnu\'s moment ride the frame, right after it; nothing else changes but the boot\'s own key', () => {
    const html = renderHubPage(ARGS(HUB({ wait_ux: true })));
    expect(html).toContain(`</main>${WaitUx.TAG}\n<script id="boot"`);
    expect(html.replace(WaitUx.TAG, '').replace(',"wait_ux":true', '')).toBe(GOLDEN.en);
  });
  test('the piece adds no words, takes no taps and calms down under reduced motion', () => {
    expect(WaitUx.CSS).toMatch(/pointer-events:none/);
    expect(WaitUx.JS).toMatch(/aria-hidden/);
    expect(WaitUx.CSS).toMatch(/prefers-reduced-motion:reduce/);
    expect(WaitUx.TAG).toBe(`<style id="wq-wait">${WaitUx.CSS}</style><script>${WaitUx.JS}</script>`);
    expect(WaitUx.CSS.match(/content:"[^"]*"/g)).toEqual(['content:""']);
    expect(WaitUx.JS).not.toMatch(/textContent|innerText|createTextNode/);
    expect(Buffer.byteLength(WaitUx.TAG)).toBeLessThan(2600);
  });
});

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path, headers: { host: 'portal.example' } }, (res) => {
    let out = '';
    res.on('data', (c) => { out += c; });
    res.on('end', () => resolve(out));
  }).on('error', reject);
});
async function serve(answers, fn) {
  const q = answers.slice();
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: async () => jsonRes(200, q.length > 1 ? q.shift() : q[0]), logEvent: () => {} }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { return await fn(srv); } finally { await new Promise((r) => srv.close(r)); }
}

describe('the edge learns the switch from the hub answer', () => {
  test('the streamed page: once a hub answer said wait_ux, the next page\'s early frame carries the bar', async () => {
    await serve([HUB({ fast: true, wait_ux: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html.split(WaitUx.TAG)).toHaveLength(2);
      expect(html.indexOf(WaitUx.TAG)).toBeLessThan(html.indexOf('<script id="boot"'));
    });
  });
  test('a portal worker that learnt the switch before it was turned on: the early frame goes without the piece, so the tail carries it, once', async () => {
    // the portal runs one process per core, and each learns from its own last hub answer
    await serve([HUB({ fast: true }), HUB({ fast: true, wait_ux: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const late = await get(srv, `/h/${TOKEN}`);
      expect(late.split(WaitUx.TAG)).toHaveLength(2);
      expect(late.indexOf(WaitUx.TAG)).toBeGreaterThan(late.indexOf('<div class="wq-boot">'));
      expect(late.indexOf(WaitUx.TAG)).toBeLessThan(late.indexOf('<script id="boot"'));
      const next = await get(srv, `/h/${TOKEN}`);
      expect(next.split(WaitUx.TAG)).toHaveLength(2); // the frame carries it now; the tail adds no second one
      expect(next.indexOf(WaitUx.TAG)).toBeLessThan(next.indexOf('<div class="wq-boot">') + 400);
    });
  });
  test('off: the streamed page carries nothing of it', async () => {
    await serve([HUB({ fast: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      expect(await get(srv, `/h/${TOKEN}`)).not.toMatch(/wq-wbar|wq-wait/);
    });
  });
});

// ── the piece's script, in a vm over a small fake DOM ─────────────────────────────────────────────
function page({ share = false } = {}) {
  const cls = (el) => ({ add: (c) => el.c.add(c), remove: (c) => el.c.delete(c), contains: (c) => el.c.has(c) });
  const mk = (tag) => { const el = { tag, c: new Set(), style: {}, attrs: {}, kids: [], setAttribute(k, v) { el.attrs[k] = v; } }; el.classList = cls(el);
    Object.defineProperty(el, 'innerHTML', { set() { el.firstChild = mk('i'); } }); Object.defineProperty(el, 'className', { set(v) { v.split(' ').forEach((c) => el.c.add(c)); } }); return el; };
  let boot = mk('div');
  const observers = [];
  const pending = [];
  const calls = [];
  const document = {
    body: { appendChild(el) { document.bar = el; } },
    createElement: mk,
    querySelector: (s) => (s === '.wq-boot' ? boot : null),
    getElementById: (id) => (id === 'wq' ? {} : null),
  };
  const window = {
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    AbortController,
    fetch: (u, o) => new Promise((res, rej) => {
      pending.push(res);
      calls.push(o || {});
      if (o && o.signal) o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  };
  vm.runInNewContext(WaitUx.JS, { document, window, setTimeout, clearTimeout, setInterval, clearInterval, String, RegExp, Object });
  if (share) vm.runInNewContext(WaitUx.SHARE_JS, { window, Promise });
  return {
    document, window, calls, boot: () => boot,
    removeBoot() { boot = null; observers.forEach((fn) => fn()); },
    addBoot() { boot = mk('div'); observers.forEach((fn) => fn()); return boot; },
    settle(i, v) { pending[i](v); },
  };
}
const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

describe('the bar and Jugnu\'s moment, run', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  test('the opening frame: nothing before 400 ms, the bar after it, Jugnu\'s moment at 1.5 s, the bar finished and gone once the home draws', () => {
    const p = page();
    const bar = p.document.bar;
    expect(bar.attrs['aria-hidden']).toBe('true');
    jest.advanceTimersByTime(399);
    expect(bar.classList.contains('on')).toBe(false);
    jest.advanceTimersByTime(2);
    expect(bar.classList.contains('on')).toBe(true);
    jest.advanceTimersByTime(900);
    const w = parseFloat(bar.firstChild.style.width);
    expect(w).toBeGreaterThan(8);
    expect(w).toBeLessThan(90);
    expect(p.boot().classList.contains('wq-bwait')).toBe(false);
    jest.advanceTimersByTime(200);
    expect(p.boot().classList.contains('wq-bwait')).toBe(true);
    p.removeBoot();
    expect(bar.firstChild.style.width).toBe('100%');
    jest.advanceTimersByTime(600);
    expect(bar.classList.contains('on')).toBe(false);
  });

  test('an opening frame the page draws again later (it asks once more) brings the bar and Jugnu\'s moment back', () => {
    const p = page();
    jest.advanceTimersByTime(500);
    p.removeBoot();
    jest.advanceTimersByTime(1000);
    expect(p.document.bar.classList.contains('on')).toBe(false);
    const again = p.addBoot();
    jest.advanceTimersByTime(401);
    expect(p.document.bar.classList.contains('on')).toBe(true);
    jest.advanceTimersByTime(1100);
    expect(again.classList.contains('wq-bwait')).toBe(true);
  });

  test('a fast opening (under 400 ms) never shows the bar', () => {
    const p = page();
    jest.advanceTimersByTime(300);
    p.removeBoot();
    jest.advanceTimersByTime(2000);
    expect(p.document.bar.classList.contains('on')).toBe(false);
  });

  test('a child data read over 400 ms shows the bar until it answers; a POST or another address never does', async () => {
    const p = page();
    p.removeBoot();
    jest.advanceTimersByTime(1000);
    p.window.fetch('/api/wq/doors/h/x?d=games');
    p.window.fetch('/api/wq/hub/x', { method: 'POST' });
    p.window.fetch('https://cdn.example/a.png');
    jest.advanceTimersByTime(399);
    expect(p.document.bar.classList.contains('on')).toBe(false);
    jest.advanceTimersByTime(2);
    expect(p.document.bar.classList.contains('on')).toBe(true);
    p.settle(0);
    await flush();
    expect(p.document.bar.firstChild.style.width).toBe('100%');
    jest.advanceTimersByTime(600);
    expect(p.document.bar.classList.contains('on')).toBe(false);
  });

  test('a POST made as a Request (fetch(new Request(url, {method: POST}))) is not a read: no bar', () => {
    const p = page();
    p.removeBoot();
    jest.advanceTimersByTime(1000);
    p.window.fetch({ url: '/api/wq/hub/x', method: 'POST' });
    jest.advanceTimersByTime(1000);
    expect(p.document.bar.classList.contains('on')).toBe(false);
  });

  test('a read that hangs: at 15 s it is called off (the screen\'s own try-again shows) and the bar finishes; it never creeps forever', async () => {
    const p = page();
    p.removeBoot();
    jest.advanceTimersByTime(1000);
    let failed = null;
    p.window.fetch('/api/wq/stories/shelf/h/x').catch((e) => { failed = e.name; });
    jest.advanceTimersByTime(14000);
    expect(p.document.bar.classList.contains('on')).toBe(true);
    expect(failed).toBeNull();
    jest.advanceTimersByTime(1001);
    await flush();
    expect(failed).toBe('AbortError');
    expect(p.document.bar.firstChild.style.width).toBe('100%');
    jest.advanceTimersByTime(600);
    expect(p.document.bar.classList.contains('on')).toBe(false);
  });

  test('a read that answers in time is not called off later; a caller\'s own signal is passed on and left to the caller', async () => {
    const p = page();
    p.removeBoot();
    let failed = null;
    p.window.fetch('/api/wq/doors/h/x?d=games').catch((e) => { failed = e.name; });
    p.settle(0);
    await flush();
    jest.advanceTimersByTime(20000);
    await flush();
    expect(failed).toBeNull();
    const own = new AbortController();
    p.window.fetch('/api/wq/lib/h/x', { signal: own.signal });
    expect(p.calls[1].signal).toBe(own.signal);
    jest.advanceTimersByTime(15001);
    await flush();
    expect(own.signal.aborted).toBe(false);
    expect(p.document.bar.firstChild.style.width).toBe('100%');
  });
});

describe('the same child data read asked twice while the first is out (web_quiz_hub_fanout on too: the share line)', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());
  const answer = (body) => { const r = { body, clones: 0, clone() { r.clones += 1; return { body, copy: true }; } }; return r; };

  test('rides the first: one request goes out, the first caller gets the answer, the later one its own copy', async () => {
    const p = page({ share: true });
    p.removeBoot();
    const one = p.window.fetch('/api/wq/stories/shelf/h/x?kid=k&l=en');
    const two = p.window.fetch('/api/wq/stories/shelf/h/x?kid=k&l=en');
    expect(p.calls.length).toBe(1);
    const res = answer({ books: [1] });
    p.settle(0, res);
    expect(await one).toBe(res);
    expect(await two).toEqual({ body: { books: [1] }, copy: true });
    expect(res.clones).toBe(1);
  });

  test('once answered, the same read goes out again (nothing is kept); another address, a caller\'s own signal or a POST never rides', async () => {
    const p = page({ share: true });
    p.removeBoot();
    const one = p.window.fetch('/api/wq/doors/h/x?d=stories');
    p.settle(0, answer({}));
    await one;
    p.window.fetch('/api/wq/doors/h/x?d=stories');
    expect(p.calls.length).toBe(2);
    p.window.fetch('/api/wq/doors/h/x?d=games');
    p.window.fetch('/api/wq/doors/h/x?d=games', { signal: new AbortController().signal });
    p.window.fetch('/api/wq/doors/h/x?d=games', { method: 'POST' });
    expect(p.calls.length).toBe(5);
  });

  test('a read called off at 15 s fails for the later caller too (each screen shows its own try-again)', async () => {
    const p = page({ share: true });
    p.removeBoot();
    const why = [];
    p.window.fetch('/api/wq/lib/h/x').catch((e) => why.push(e.name));
    p.window.fetch('/api/wq/lib/h/x').catch((e) => why.push(e.name));
    expect(p.calls.length).toBe(1);
    jest.advanceTimersByTime(15001);
    await flush();
    expect(why).toEqual(['AbortError', 'AbortError']);
  });
});

describe('fanout off: the piece alone, today\'s reads', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  test('wait_ux on, fanout off: two identical reads both go out, as today', () => {
    const p = page();
    p.removeBoot();
    p.window.fetch('/api/wq/stories/shelf/h/x?kid=k&l=en');
    p.window.fetch('/api/wq/stories/shelf/h/x?kid=k&l=en');
    expect(p.calls.length).toBe(2);
  });

  test('the page gets the share line only when the answer says wait_share (and wait_ux); the piece itself never changes', () => {
    expect(WaitUx.tag({ wait_ux: true })).toBe(WaitUx.TAG);
    expect(WaitUx.tag({ wait_ux: true, wait_share: true })).toBe(WaitUx.TAG + WaitUx.SHARE);
    expect(WaitUx.tag({ wait_share: true })).toBe('');
    expect(WaitUx.tag({ wait_ux: true, wait_share: 'true' })).toBe(WaitUx.TAG);
  });
});

describe('the edge learns the share from the hub answer', () => {
  test('the streamed page: after an answer with wait_share, the early frame carries the piece and the share line, once each', async () => {
    await serve([HUB({ fast: true, wait_ux: true, wait_share: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html.split(WaitUx.TAG)).toHaveLength(2);
      expect(html.split(WaitUx.SHARE)).toHaveLength(2);
      expect(html.indexOf(WaitUx.SHARE)).toBe(html.indexOf(WaitUx.TAG) + WaitUx.TAG.length);
    });
  });
  test('wait_ux without wait_share: the piece alone', async () => {
    await serve([HUB({ fast: true, wait_ux: true })], async (srv) => {
      await get(srv, `/h/${TOKEN}`);
      const html = await get(srv, `/h/${TOKEN}`);
      expect(html).not.toContain(WaitUx.SHARE);
      expect(html.split(WaitUx.TAG)).toHaveLength(2);
    });
  });
});
