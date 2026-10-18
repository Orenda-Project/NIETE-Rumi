/**
 * The busy page (app_settings web_quiz_busy_page; the bot's hub and quiz answers say `busy_page: true`, the portal
 * learns it from the last one, like `wait_ux`). When the bot cannot be reached, does not answer in time, or answers a
 * 5xx other than 503, a child page says the app is slow right now and offers one Try again link to the same page:
 * 503 with Retry-After: 5. Never the "not open" words: the quiz is open, the server is slow.
 * Off (no learn yet, or a last answer without the key): every failure page is today's, byte for byte, its status
 * and headers too (fixtures/busy-page-off-golden.json, recorded on the code before this change).
 * A 503 from the bot (a true off), 401 (expired) and 404 (closed) stay today's pages, on or off.
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const H = require('./web-quiz-busy-page.harness');
const GOLDEN = require('./fixtures/busy-page-off-golden.json');

const SITES = Object.keys(H.SITES);
const FAILS = Object.keys(H.FAILS);
const UPSTREAM = ['throw', 'timeout', '500', '500ur', '502', '504'];
const TODAY_ON = ['503', '401', '404', '404c'];
// The page's language, by the closed page's own rule: /h the phone, /c ?lang=, /q the bot's answer (en when none), /k en.
const LANG = (site, fail) => (site === 'hur' || site === 'cur' || ((site === 'q' || site === 'qclass') && fail === '500ur') ? 'ur' : 'en');

const COPY = {
  en: { title: 'Jugnu is a little slow right now', say: 'Tap Try again in a moment.', go: 'Try again' },
  ur: { title: 'جگنو کو ابھی تھوڑی دیر لگ رہی ہے', say: 'تھوڑی دیر بعد بٹن دبائیں۔', go: 'دوبارہ کوشش کریں' },
};
const NOT_OPEN = /The quiz is not open right now|کوئز ابھی کھلا نہیں ہے|This quiz has closed|یہ کوئز بند ہو چکا ہے/;
const TEST_WORDS = /\btest\b|\bexam\b|assessment|امتحان|ٹیسٹ/i;
const esc = (s) => s.replace(/&/g, '&amp;');

describe('off: today\'s failure pages, byte for byte (status, headers, page)', () => {
  test.each(SITES.flatMap((s) => FAILS.map((f) => [s, f])))('%s, the bot %s, nothing learned yet (the switch absent is off)', async (site, fail) => {
    expect(await H.runCase(site, fail, null)).toEqual(GOLDEN[`${site}|${fail}|cold`]);
  });
  test.each(SITES.flatMap((s) => FAILS.map((f) => [s, f])))('%s, the bot %s, after a hub answer without the key', async (site, fail) => {
    expect(await H.runCase(site, fail, {})).toEqual(GOLDEN[`${site}|${fail}|warm`]);
  });
  test.each([['false', false], ['the string true', 'true'], ['1', 1], ['an object', {}], ['null', null]].flatMap(([n, v]) => SITES.flatMap((s) => UPSTREAM.map((f) => [n, v, s, f]))))(
    'busy_page %s: off (%s, the bot %s)', async (_n, value, site, fail) => {
      expect(await H.runCase(site, fail, { busy_page: value })).toEqual(GOLDEN[`${site}|${fail}|warm`]);
    },
  );
});

describe('on: an upstream failure is the busy page', () => {
  test.each(SITES.flatMap((s) => UPSTREAM.map((f) => [s, f])))('%s, the bot %s: 503, Retry-After 5, Jugnu slow, one Try again to the same page', async (site, fail) => {
    const r = await H.runCase(site, fail, { busy_page: true });
    const l = LANG(site, fail);
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.body).not.toMatch(NOT_OPEN);
    expect(r.body).not.toMatch(TEST_WORDS);
    expect(r.body).toContain(`<html lang="${l}" dir="${l === 'ur' ? 'rtl' : 'ltr'}"`);
    expect(r.body).toContain(`<h1>${COPY[l].title}</h1>`);
    expect(r.body).toContain(`<p class="wq-sub">${COPY[l].say}</p>`);
    // One link, a plain <a href> to this very page (works with no script at all).
    const links = r.body.match(/<a [^>]*>[^<]*<\/a>/g) || [];
    const tries = links.filter((a) => a.includes(`>${COPY[l].go}</a>`));
    expect(tries).toEqual([`<a class="wq-btn wq-go" href="${esc(H.SITES[site].path)}">${COPY[l].go}</a>`]);
    // Jugnu's frame, as the closed page draws it.
    expect(r.body).toContain('<section class="wq-screen wq-closed">');
    expect(r.body).toContain('<img class="wq-jugnu" src="/wq/jugnu_sleep.webp" alt="" width="160" height="160">');
    expect(r.body.split('<body>')[1]).not.toMatch(/<script/);
  });

  test.each(SITES.flatMap((s) => TODAY_ON.map((f) => [s, f])))('%s, the bot %s: today\'s page, byte for byte', async (site, fail) => {
    expect(await H.runCase(site, fail, { busy_page: true })).toEqual(GOLDEN[`${site}|${fail}|warm`]);
  });

  test('the Try again link keeps the whole query, escaped', async () => {
    const path = `/h/${H.HUB_TOKEN}?kid=0123456789abcdef&from=hs&lang=ur`;
    const [, r] = await H.serve([{ status: 200, body: H.HUB({ busy_page: true }) }, { throw: true }], [{ path: `/h/${H.HUB_TOKEN}` }, { path }]);
    expect(r.status).toBe(503);
    expect(r.body).toContain(`href="/h/${H.HUB_TOKEN}?kid=0123456789abcdef&amp;from=hs&amp;lang=ur"`);
  });
});

describe('the busy page look (design review B1, B2)', () => {
  const css = (body) => (body.match(/<style id="wq-busy">([^<]*)<\/style>/) || [])[1] || '';
  test.each([['en', 'h', 'throw'], ['ur', 'hur', 'throw']])('%s: the title is balanced and the line under it is large enough to read', async (l, site, fail) => {
    const r = await H.runCase(site, fail, { busy_page: true });
    const c = css(r.body);
    expect(c).toMatch(/\.wq-closed h1\{text-wrap:balance\}/);
    const sub = Number((c.match(/\.wq-closed \.wq-sub\{font-size:(\d+)px/) || [])[1]);
    expect(sub).toBeGreaterThanOrEqual(15);
    if (l === 'ur') {
      expect(c).toMatch(/\[lang=ur\] \.wq-closed \.wq-sub\{font-size:17px;line-height:2\}/);
      expect(c).toMatch(/\[lang=ur\] \.wq-closed h1\{font-size:22px\}/);
    }
  });
  test('the look rides the busy page only: the failure pages with the switch off carry none of it', async () => {
    expect((await H.runCase('h', 'throw', {})).body).not.toContain('wq-busy');
  });
});

describe('how the portal learns it', () => {
  test('the last answer wins: on, then a hub answer without the key, is off again', async () => {
    const steps = [{ status: 200, body: H.HUB({ busy_page: true }) }, { status: 200, body: H.HUB() }, { throw: true }];
    const out = await H.serve(steps, [{ path: `/h/${H.HUB_TOKEN}` }, { path: `/h/${H.HUB_TOKEN}` }, H.SITES.h]);
    const g = GOLDEN['h|throw|warm'];
    // (one more page opened than the golden's case: only the rate limit's count differs)
    expect({ ...out[2], headers: { ...out[2].headers, 'ratelimit-remaining': null } }).toEqual({ ...g, headers: { ...g.headers, 'ratelimit-remaining': null } });
  });
  test('a quiz answer teaches it too: on from the quiz page, then the bot away is the busy page', async () => {
    const [first, r] = await H.serve([{ status: 200, body: H.QUIZ({ busy_page: true }) }, { status: 502 }], [H.SITES.q, H.SITES.q]);
    expect(first.status).toBe(200);
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('5');
    expect(r.body).toContain(`<h1>${COPY.en.title}</h1>`);
  });
  test('a quiz answer without the key turns it off', async () => {
    const steps = [{ status: 200, body: H.HUB({ busy_page: true }) }, { status: 200, body: H.QUIZ() }, { throw: true }];
    const out = await H.serve(steps, [{ path: `/h/${H.HUB_TOKEN}` }, H.SITES.q, H.SITES.h]);
    expect(out[2].status).toBe(502);
    expect(out[2].headers['retry-after']).toBeUndefined();
  });
});

describe('the words', () => {
  test('short, no test words, nothing that says the quiz is closed or not open', () => {
    for (const l of ['en', 'ur']) {
      for (const s of Object.values(COPY[l])) { expect(s).not.toMatch(TEST_WORDS); expect(s).not.toMatch(NOT_OPEN); expect(s.length).toBeLessThan(40); }
    }
  });
});
