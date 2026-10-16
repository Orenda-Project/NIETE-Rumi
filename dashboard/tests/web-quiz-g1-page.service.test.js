/**
 * The grade-1 "how many dots?" stop on the Challenge page (public/wq/wq-g1.js, loaded by wq-challenge.js only when
 * the served exercise is `numbers`). The whole page runs in a vm (wqc-page-harness.js); only the browser and the
 * network are faked. The payload and the result body are the server's shapes (web-quiz-challenge-grade1.js:
 * exercise() payload, submit() reads body.taps [{i, pick, ms}], body.ms, body.helped).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { page, ok, SRC } = require('./wqc-page-harness');

const G1_PATH = path.join(__dirname, '..', 'public', 'wq', 'wq-g1.js');
const G1_SRC = fs.existsSync(G1_PATH) ? fs.readFileSync(G1_PATH, 'utf8') : null;
const GOLDEN = path.join(__dirname, 'fixtures', 'web-quiz-g1-off.golden.json');

// the ten G1A items as the server serves them: { item_id, n, layout, tiles } (no answer field)
const ITEMS = [[3, [3, 2, 4]], [7, [8, 7, 6]], [1, [1, 0, 2]], [9, [10, 8, 9]], [4, [4, 5, 3]], [10, [9, 10, 8]], [2, [3, 1, 2]], [6, [6, 7, 5]], [0, [1, 0, 2]], [8, [8, 9, 7]]]
  .map(([n, tiles]) => ({ item_id: `numid.G1.A.${String(n).padStart(2, '0')}`, n, layout: 'tenframe', tiles }));
const COPY_KEYS = { title: 'jg.g1.title', say: 'jg.g1.say' };
const payload = (lang = 'en') => ({
  ex: 'numbers', form: 'G1', lang, ct: 'CTG1', copy_keys: COPY_KEYS, items: ITEMS, anchor_block: 'G1A', stop_after: 0, per_item_s: 10,
  show_timer: false, sound_off_safe: true, mode: 'check', record: null, period_id: null, passage_id: null, item_set_id: null, exposure_no: 1,
  band: null, anchor_exposure_no: 1, draw: { outcome: 'served' },
});
const G1_MENU = { form: 'G1', exercises: [{ id: 'numbers', copy_keys: COPY_KEYS, mins: 2, done: false, last: null, anchor_block: 'G1A' }], record: true, period_id: null, rt: false };
const SCRIPTS = G1_SRC ? { '/wq/wq-g1.js': G1_SRC } : {};

// the module alone, in its own vm
function g1Alone() {
  if (!G1_SRC) throw new Error('public/wq/wq-g1.js is missing');
  const ctx = { window: {}, document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } }, String, Number, Math };
  vm.createContext(ctx);
  vm.runInContext(G1_SRC, ctx);
  return ctx.window.WQG1;
}
const textOf = (h) => h.replace(/<[^>]*>/g, ' ');
const tileTexts = (h) => [...h.matchAll(/<button class="wq-g1-t[^"]*" type="button" id="wq-g1-t[abc]">([^<]*)<\/button>/g)].map((m) => m[1]);

async function g1Page(lang = 'en', extra = {}) {
  const clock = { t: 1000000 };
  const p = page({ lang, menu: G1_MENU, freshEls: true, clock, scripts: SCRIPTS, routes: { 'ch/HUB\\.TOKEN/numbers': ok(payload(lang)), 'ch/result': ok({ score: { correct: 7, n: 10, stopped: false } }), ...extra } });
  await p.flush();
  return { p, clock };
}
// plays the whole stop: tap tile `pickAt(i)` of each item, `msAt(i)` after the item's paint; returns every screen's HTML
async function playAll(p, clock, { pickAt = () => 0, msAt = (i) => 1000 + i * 100 } = {}) {
  const screens = [];
  await p.click('wqc-ex-numbers');
  await p.flush();
  screens.push(p.html());
  await p.click('wqc-go');
  for (let i = 0; i < ITEMS.length; i += 1) {
    expect(p.screen()).toBe('numbers-play');
    screens.push(p.html());
    clock.t += msAt(i);
    await p.click(['wq-g1-ta', 'wq-g1-tb', 'wq-g1-tc'][pickAt(i)]);
    await p.runTimers();
  }
  screens.push(p.html());
  return screens;
}

describe('grade-1 page: the ten-frame and the tiles (wq-g1.js)', () => {
  test.each([0, 7, 10])('k = %i: ten cells, exactly k filled dots, drawn with CSS (no image)', (k) => {
    const h = g1Alone().html({ items: [{ n: k, layout: 'tenframe', tiles: [k, 1, 2] }] }, { L: 'en' });
    expect((h.match(/class="wq-g1-c[ "]/g) || []).length).toBe(10);
    expect((h.match(/wq-g1-on/g) || []).length).toBe(k);
    expect(h).not.toMatch(/<img|url\(|\.png|\.svg|\.webp/);
  });

  test('three tiles carrying the payload numerals, in the payload order', () => {
    const W = g1Alone();
    expect(tileTexts(W.html(payload('en'), { L: 'en', i: 0 }))).toEqual(['3', '2', '4']);
    expect(tileTexts(W.html(payload('en'), { L: 'en', i: 3 }))).toEqual(['10', '8', '9']);
  });

  test('Urdu: the tiles are Urdu digits, never isolated; the prompt is the Urdu line verbatim', () => {
    const h = g1Alone().html(payload('ur'), { L: 'ur', i: 3 });
    expect(tileTexts(h)).toEqual(['۱۰', '۸', '۹']);
    expect(h).not.toMatch(/[⁦-⁩]/);
    expect(h).toContain('کتنے ہیں؟');
  });
});

describe('grade-1 page: the run on the Challenge page', () => {
  test('a numbers exercise lazy-loads wq-g1.js at the page\'s own ?v= and shows the intro (title + say)', async () => {
    const { p } = await g1Page('en');
    expect(p.html()).toContain('Find the number');
    await p.click('wqc-ex-numbers');
    await p.flush();
    expect(p.loaded).toEqual(['/wq/wq-g1.js?v=abc1234567']);
    expect(p.screen()).toBe('numbers-intro');
    expect(p.html()).toContain('Find the number');
    expect(p.html()).toContain('Count the dots. Tap the number.');
    expect(p.events.map((e) => e.n)).toEqual(['ch_open', 'ch_start']);
  });

  test('one tap per item: the tiles lock, a second tap adds nothing, the next item follows', async () => {
    const { p, clock } = await g1Page('en');
    await p.click('wqc-ex-numbers');
    await p.click('wqc-go');
    expect(p.html()).toContain('How many?');
    clock.t += 1500;
    await p.click('wq-g1-tb');
    expect(['wq-g1-ta', 'wq-g1-tb', 'wq-g1-tc'].map((id) => p.els[id].disabled)).toEqual([true, true, true]);
    expect(p.els['wq-g1-tb'].className).not.toMatch(/wqc-ok|wqc-no/);
    await p.click('wq-g1-ta');
    await p.runTimers();
    expect(tileTexts(p.html())).toEqual(['8', '7', '6']);
  });

  test('after the last item: one POST to ch/result with { ct, taps: [{ i, pick, ms }], ms }, ms from each item\'s paint', async () => {
    const { p, clock } = await g1Page('en');
    await playAll(p, clock, { pickAt: (i) => i % 3 });
    const posts = p.fetches.filter((f) => f.url === '/api/wq/ch/result');
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0].init.body);
    expect(Object.keys(body).sort()).toEqual(['ct', 'ms', 'taps']);
    expect(body.ct).toBe('CTG1');
    expect(body.taps).toEqual(ITEMS.map((it, i) => ({ i, pick: it.tiles[i % 3], ms: 1000 + i * 100 })));
    expect(body.ms).toBe(ITEMS.reduce((a, _, i) => a + 1000 + i * 100, 0));
    // the shape the server's scorer reads: every tap scores against its item (web-quiz-challenge-grade1.js scoreNumberId)
    body.taps.forEach((tp) => { expect(Number.isInteger(tp.i) && Number.isInteger(tp.pick) && Number.isFinite(tp.ms)).toBe(true); });
    expect(p.screen()).toBe('numbers-result');
  });

  test('no score, no count, no digit on any screen of the stop, except the tile numerals (en + ur)', async () => {
    for (const lang of ['en', 'ur']) {
      const { p, clock } = await g1Page(lang);
      const screens = await playAll(p, clock);
      screens.forEach((h) => {
        let txt = textOf(h);
        tileTexts(h).forEach((tt) => { txt = txt.replace(`>${tt}<`, ''); txt = txt.split(` ${tt} `).join(' '); });
        expect(txt).not.toMatch(/[0-9۰-۹٠-٩]/);
        expect(txt).not.toMatch(/ of |میں سے|\//);
        expect(h).not.toMatch(/wqc-timer|wqc-bar|wqc-score|wqc-ok|wqc-no\b/);
      });
    }
  });

  test('Urdu run: the copy lines verbatim and Urdu digits on the tiles', async () => {
    const { p, clock } = await g1Page('ur');
    await p.click('wqc-ex-numbers');
    await p.flush();
    expect(p.html()).toContain('نمبر ڈھونڈیں');
    expect(p.html()).toContain('نقطے گنیں۔ پھر نمبر دبائیں۔');
    await p.click('wqc-go');
    expect(tileTexts(p.html())).toEqual(['۳', '۲', '۴']);
    clock.t += 10;
    await p.click('wq-g1-ta');
    await p.runTimers();
    expect(tileTexts(p.html())).toEqual(['۸', '۷', '۶']);
  });

  test('no helped key in the body when the sitting did not ask (withHelped, as for bigger)', async () => {
    const { p, clock } = await g1Page('en');
    await playAll(p, clock);
    expect(JSON.parse(p.fetches.find((f) => f.url === '/api/wq/ch/result').init.body).helped).toBeUndefined();
  });

  test('a failed submit shows the page\'s error screen with a retry that posts again', async () => {
    const { p, clock } = await g1Page('en', { 'ch/result': () => ({ status: 503, body: { error: 'unavailable' } }) });
    await playAll(p, clock);
    expect(p.screen()).toBe('error');
    expect(p.has('wqc-retry')).toBe(true);
  });

  test('the module cannot load: the error screen, never a blank page', async () => {
    const clock = { t: 1 };
    const p = page({ menu: G1_MENU, freshEls: true, clock, scripts: {}, routes: { 'ch/HUB\\.TOKEN/numbers': ok(payload('en')) } });
    await p.flush();
    await p.click('wqc-ex-numbers');
    await p.flush();
    expect(p.screen()).toBe('error');
  });
});

// ── golden: with no numbers exercise the page is what it was (menu + a whole bigger run, HTML and requests) ──
const BIGGER = { ex: 'bigger', ct: 'CT2', clips: { intro: { text: 'Intro line', url: null }, start: { text: 'Ready? Begin.', url: null }, stop: { text: 'Stop. Thank you!', url: null }, done: { text: 'Great reading! Well done.', url: null } }, per_item_s: 10, stop_after: 4, practice: [{ a: 8, b: 4, answer: 8 }], items: [{ a: 7, b: 5 }, { a: 11, b: 24 }, { a: 39, b: 23 }] };
async function biggerRun(src, lang) {
  const clock = { t: 5000000 };
  const p = page({ src, lang, freshEls: true, clock, routes: { 'ch/HUB\\.TOKEN/bigger': ok(BIGGER), 'ch/result': ok({ score: { correct: 2, n: 3, stopped: false } }), 'ch/HUB\\.TOKEN\\?': ok({ lang, form: 'G3', exercises: [{ id: 'bigger', name: 'Which is bigger?', mins: 2, done: true, last: { correct: 2, n: 3 } }] }) } });
  const html = [];
  await p.flush(); html.push(p.html());
  await p.click('wqc-ex-bigger'); html.push(p.html());
  await p.click('wqc-go'); html.push(p.html());
  await p.click('wqc-a'); await p.runTimers(); html.push(p.html());
  await p.runTimers(); html.push(p.html());
  for (let i = 0; i < BIGGER.items.length; i += 1) { clock.t += 700; await p.click('wqc-b'); await p.runTimers(); html.push(p.html()); }
  await p.click('wqc-menu'); html.push(p.html());
  return { html, requests: p.fetches.map((f) => ({ url: f.url, method: (f.init && f.init.method) || 'GET', body: (f.init && f.init.body) || null })), loaded: p.loaded };
}

describe('grade-1 page beside the Trail v2 page script (web_quiz_challenge_v2 on, as the grade-1 form needs)', () => {
  const TRAIL_SRC = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-trail.js'), 'utf8'); } catch (e) { return ''; } })();
  test('with wq-trail.js active, the numbers stop still opens the grade-1 screen, never the Trail\'s exercise path', async () => {
    const clock = { t: 1000000 };
    const p = page({ lang: 'en', menu: { ...G1_MENU, trail: true, v2: { pool: true, story: false, consent: false } }, pre: TRAIL_SRC ? [TRAIL_SRC] : [], freshEls: true, clock, scripts: SCRIPTS,
      routes: { 'ch/HUB\\.TOKEN/numbers': ok(payload('en')) } });
    await p.flush();
    p.w.open('numbers');
    await p.flush();
    expect(p.loaded.some((u) => /\/wq\/wq-g1\.js/.test(u))).toBe(true);
    expect(p.screen()).toBe('numbers-intro');
    expect(p.html()).toContain('Count the dots. Tap the number.');
  });
});

describe('golden: no numbers exercise ⇒ the page is unchanged', () => {
  if (process.env.WQ_G1_GOLDEN_FROM) {
    // writes the golden from a given wq-challenge.js (the file before this change)
    test('write golden', async () => {
      const base = fs.readFileSync(process.env.WQ_G1_GOLDEN_FROM, 'utf8');
      fs.writeFileSync(GOLDEN, `${JSON.stringify({ en: await biggerRun(base, 'en'), ur: await biggerRun(base, 'ur') }, null, 1)}\n`);
    });
    return;
  }
  test.each(['en', 'ur'])('%s: menu + bigger run, every screen and every request string-equal to the golden', async (lang) => {
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))[lang];
    const got = await biggerRun(SRC, lang);
    expect(got.html.length).toBe(9);
    expect(JSON.stringify(got)).toBe(JSON.stringify(want));
  });
});
