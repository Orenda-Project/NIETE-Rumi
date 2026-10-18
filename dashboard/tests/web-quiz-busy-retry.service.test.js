/**
 * The busy page asks again by itself (app_settings web_quiz_busy_retry; the bot's hub and quiz answers say
 * `busy_retry: true` beside `busy_page: true`, the portal learns it from the last one, like `busy_page`).
 *
 * On: the busy page carries one small script that re-asks this same address after 2 s, 4 s and 8 s. The first good
 * answer opens the page (the home, the quiz); after three failures it stops, and the one Try again link is what is left.
 * A thin bar shows it is still trying. No new words.
 * Off (no `busy_retry`, or anything but JSON true, or the busy page itself off): the busy page is #2872's, byte for byte,
 * with no script; with the busy page off the failure pages are today's.
 * The bot is the network boundary (a fake fetch); the page's script runs in a vm with a fake clock and fetch.
 * Invented children only.
 */
const vm = require('vm');
const H = require('./web-quiz-busy-page.harness');

const UPSTREAM = ['throw', 'timeout', '500', '502', '504'];
const SITES = Object.keys(H.SITES);

describe('off: the busy page is today\'s (#2872), no script', () => {
  test.each([['absent', {}], ['false', { busy_retry: false }], ['the string true', { busy_retry: 'true' }], ['1', { busy_retry: 1 }], ['null', { busy_retry: null }]])(
    'busy_retry %s', async (_n, extra) => {
      for (const site of SITES) {
        const off = await H.runCase(site, '500', { busy_page: true });
        const r = await H.runCase(site, '500', { busy_page: true, ...extra });
        expect(r).toEqual(off);
        expect(r.body.split('<body>')[1]).not.toMatch(/<script/);
      }
    },
  );
  test('busy_retry on but the busy page off: today\'s failure page (the retry rides the busy page only)', async () => {
    for (const site of SITES) {
      expect(await H.runCase(site, '500', { busy_retry: true })).toEqual(await H.runCase(site, '500', {}));
    }
  });
});

const scriptOf = (body) => {
  const m = body.split('<body>')[1].match(/<script>([\s\S]*?)<\/script>/g) || [];
  return m.map((s) => s.replace(/^<script>|<\/script>$/g, ''));
};

describe('on: the busy page asks again by itself', () => {
  test.each(SITES.flatMap((s) => UPSTREAM.map((f) => [s, f])))('%s, the bot %s: 503, one script, the bar, the same Try again link', async (site, fail) => {
    const plain = await H.runCase(site, fail, { busy_page: true });
    const r = await H.runCase(site, fail, { busy_page: true, busy_retry: true });
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    expect(scriptOf(r.body)).toHaveLength(1);
    expect(r.body).toContain('<i class="wq-busybar" aria-hidden="true"></i>');
    // everything a child reads is #2872's: the same words and the same one link
    const words = (b) => b.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<i class="wq-busybar"[^>]*><\/i>/g, '');
    expect(words(r.body)).toBe(plain.body);
  });
  test('Urdu: the same script, the Urdu page', async () => {
    const r = await H.runCase('hur', 'timeout', { busy_page: true, busy_retry: true });
    expect(r.body).toContain('<html lang="ur" dir="rtl"');
    expect(scriptOf(r.body)).toHaveLength(1);
  });
});

// The page's script in a vm: a fake clock (setTimeout queued, run by advance), a fake fetch, a fake location.
function page(answers) {
  const timers = [];
  let now = 0;
  const calls = [];
  const replaced = [];
  const bar = { hidden: false };
  const ctx = {
    location: { href: 'https://portal.example/h/tok?kid=0123456789abcdef', replace: (u) => replaced.push(u) },
    document: { querySelector: (s) => (s === '.wq-busybar' ? bar : null) },
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); },
    fetch: (u, o) => {
      calls.push({ at: now, u, o });
      const a = answers.length > 1 ? answers.shift() : answers[0];
      return a === 'net' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: a >= 200 && a < 300, status: a });
    },
  };
  ctx.window = ctx;
  const flush = () => new Promise((r) => setImmediate(r));
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
      await flush(); await flush();
    }
    now = end;
  }
  return { ctx, calls, replaced, bar, advance, get pending() { return timers.length; } };
}
async function scriptFor(extra = {}) {
  const r = await H.runCase('h', '500', { busy_page: true, busy_retry: true, ...extra });
  return scriptOf(r.body)[0];
}

describe('the script: 2 s, 4 s, 8 s, then the Try again link', () => {
  test('a bot that answers on the 2nd re-ask: the page opens (the home), after 2 s + 4 s', async () => {
    const p = page([503, 200]);
    vm.runInNewContext(await scriptFor(), p.ctx);
    expect(p.calls).toHaveLength(0);
    await p.advance(1999);
    expect(p.calls).toHaveLength(0);
    await p.advance(1);
    expect(p.calls.map((c) => c.at)).toEqual([2000]);
    expect(p.replaced).toEqual([]);
    await p.advance(4000);
    expect(p.calls.map((c) => c.at)).toEqual([2000, 6000]);
    expect(p.replaced).toEqual(['https://portal.example/h/tok?kid=0123456789abcdef']);
    expect(p.pending).toBe(0);
    // the same address, never cached, the page's own cookies
    p.calls.forEach((c) => {
      expect(c.u).toBe('https://portal.example/h/tok?kid=0123456789abcdef');
      expect(c.o.cache).toBe('no-store');
      expect(c.o.credentials).toBe('same-origin');
    });
  });
  test('three failures (busy, a 5xx, no network): it stops; the bar goes; nothing opens; Try again is left', async () => {
    const p = page([503, 502, 'net']);
    vm.runInNewContext(await scriptFor(), p.ctx);
    await p.advance(60000);
    expect(p.calls.map((c) => c.at)).toEqual([2000, 6000, 14000]);
    expect(p.replaced).toEqual([]);
    expect(p.bar.hidden).toBe(true);
    expect(p.pending).toBe(0);
  });
  test('a real answer that is not the page (a closed quiz, 404) opens too: the bot is back, its page says why', async () => {
    const p = page([404]);
    vm.runInNewContext(await scriptFor(), p.ctx);
    await p.advance(2000);
    expect(p.replaced).toHaveLength(1);
  });
  test('a first good answer opens at once, after 2 s', async () => {
    const p = page([200]);
    vm.runInNewContext(await scriptFor(), p.ctx);
    await p.advance(2000);
    expect(p.replaced).toHaveLength(1);
    expect(p.calls).toHaveLength(1);
  });
  test('a phone without fetch: nothing runs (the link is still there)', async () => {
    const p = page([200]);
    delete p.ctx.fetch;
    vm.runInNewContext(await scriptFor(), p.ctx);
    await p.advance(60000);
    expect(p.replaced).toEqual([]);
  });
});
