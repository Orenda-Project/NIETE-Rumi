/**
 * A wordless first paint (app_settings web_quiz_plain_paint, decided by the bot: its quiz and hub answers say
 * `plain_paint: true` beside `fast: true`; each portal process learns it from its last answer, like the fast page).
 *
 * The fast first page sends a head before the bot answers. When that head is only a guess (a class quiz this process
 * has not seen; a child's home from a link with no ?lang=), today it guesses English, so an Urdu child sees English,
 * left-to-right, with an English opening line and an English tab title for the whole wait. On, a guessed head says no
 * words in any language: the brand's name as the title, an empty opening line, and the language and direction from the
 * link's ?lang= or else left to the one fix line the page already gets when the bot answers (a link's ?lang= is a
 * guess too: the bot decides whether it wins). A head that is known (a code this process has seen) is today's, and off
 * every page is today's, byte for byte (plain-paint-off-golden.json, recorded on the code before this switch).
 * On, each early head also logs one `web_quiz.first_head` event { path, guess, plain }, and nothing else.
 */
const GOLDEN = require('./fixtures/plain-paint-off-golden.json');
const { SCENARIOS, run } = require('./fixtures/plain-paint-scenarios');

// What a phone draws before any script: the head and the opening frame (the tail's scripts come with the bot's answer).
const early = (body) => body.slice(0, body.indexOf('<script'));
// The words in it a child (or the tab bar) shows: the title, the share tags' text, and the text between tags.
function words(html) {
  const h = html.replace(/<style[\s\S]*?<\/style>/g, '');
  const shown = [];
  const t = h.match(/<title>([\s\S]*?)<\/title>/);
  if (t) shown.push(t[1]);
  for (const m of h.matchAll(/<meta property="og:(?:title|description|image:alt)" content="([^"]*)">/g)) shown.push(m[1]);
  const body = h.slice(h.indexOf('<body>') + 6);
  for (const m of body.matchAll(/>([^<]+)</g)) shown.push(m[1]);
  return shown.join(' ');
}
// Latin words other than the brand's own name.
const english = (html) => (words(html).match(/[A-Za-z]{2,}/g) || []).filter((w) => w !== 'NIETE');
const urdu = (s) => /[؀-ۿ]/.test(s);

describe('switch off: every guessed and known head is today\'s, byte for byte', () => {
  test.each(Object.keys(SCENARIOS))('%s', async (name) => {
    expect(await run(name, false)).toEqual(GOLDEN[name]);
  });
});

describe('switch on: a guessed head says no words', () => {
  test('an Urdu class quiz this process has not seen: no English before the bot answers, then the page is set to Urdu', async () => {
    const res = await run('q_miss_ur', true);
    expect(res.status).toBe(200);
    const top = early(res.body);
    expect(english(top)).toEqual([]);
    expect(urdu(words(top))).toBe(false);
    expect(top).toMatch(/<html lang="" dir="auto">/);
    expect(top).toMatch(/<title>NIETE<\/title>/);
    expect(top).toMatch(/<p class="wq-bootsay"><\/p>/);
    // the fix line, before the page's scripts: Urdu, right to left, the opening line and the title in Urdu
    const fix = res.body.match(/<script>\(function\(h\)\{([\s\S]*?)\}\)\(document\.documentElement\)<\/script>/)[1];
    expect(fix).toMatch(/h\.lang="ur"/);
    expect(fix).toMatch(/h\.dir="rtl"/);
    expect(fix).toMatch(/b\.textContent="کوئز کھل رہا ہے…"/);
    expect(fix).toMatch(/document\.title="پودے کے حصے/);
    expect(res.body.indexOf(fix)).toBeLessThan(res.body.indexOf('<script src="/wq/wq.js'));
  });

  test('an English class quiz this process has not seen: no words either, then set to English', async () => {
    const res = await run('q_miss_en', true);
    const top = early(res.body);
    expect(english(top)).toEqual([]);
    expect(top).toMatch(/<html lang="" dir="auto">/);
    expect(res.body).toMatch(/h\.lang="en";h\.dir="ltr"/);
    expect(res.body).toMatch(/b\.textContent="Opening the quiz…"/);
  });

  test('a link that names its language (?lang=ur): that language and direction from the first byte, still no words', async () => {
    const res = await run('q_miss_ur_lang', true);
    const top = early(res.body);
    expect(top).toMatch(/<html lang="ur" dir="rtl">/);
    expect(english(top)).toEqual([]);
    expect(res.body).not.toMatch(/h\.lang=/);
    expect(res.body).toMatch(/b\.textContent="کوئز کھل رہا ہے…"/);
  });

  test('a class quiz this process has seen: today\'s head, byte for byte', async () => {
    const res = await run('q_hit_ur', true);
    expect(early(res.body)).toBe(early(GOLDEN.q_hit_ur.body));
  });

  test('an Urdu child\'s home on a phone set to English (a link with no ?lang=): no English before the bot answers', async () => {
    const res = await run('h_ur_en_phone', true);
    expect(res.status).toBe(200);
    const top = early(res.body);
    expect(english(top)).toEqual([]);
    expect(top).toMatch(/<html lang="" dir="auto">/);
    expect(top).toMatch(/<title>NIETE<\/title>/);
    expect(res.body).toMatch(/h\.lang="ur";h\.dir="rtl"/);
    expect(res.body.indexOf('h.lang="ur"')).toBeLessThan(res.body.indexOf('<script src="/wq/hub.js'));
  });

  test('an English child\'s home on a phone set to Urdu: no Urdu words before the bot answers either', async () => {
    const res = await run('h_en_ur_phone', true);
    const top = early(res.body);
    expect(urdu(words(top))).toBe(false);
    expect(english(top)).toEqual([]);
    expect(res.body).toMatch(/h\.lang="en";h\.dir="ltr"/);
  });

  test('a home link that names its language (?lang=ur, a guess too): that language and direction, still no words', async () => {
    const res = await run('h_ur_lang', true);
    const top = early(res.body);
    expect(top).toMatch(/<html lang="ur" dir="rtl"/);
    expect(english(top)).toEqual([]);
    expect(top).toMatch(/<title>NIETE<\/title>/);
    expect(res.body).not.toMatch(/h\.lang=/);
    expect(res.body).toMatch(/b\.textContent="کھل رہا ہے…"/);
  });

  test('the rest of the page (the boot JSON aside) is today\'s: the same scripts in the same order', async () => {
    const tags = (s) => s.match(/<script src="[^"]+" defer><\/script>|<link rel="stylesheet" href="[^"]+">/g);
    for (const name of ['q_miss_ur', 'h_ur_en_phone']) {
      expect(tags((await run(name, true)).body)).toEqual(tags(GOLDEN[name].body));
    }
  });
});

describe('the first_head event (on only): how each early head was known, and nothing else', () => {
  const heads = async (name, plain) => {
    const seen = [];
    await run(name, plain, { logEvent: (e, p) => { if (e === 'web_quiz.first_head') seen.push(p); } });
    return seen;
  };
  test.each([
    ['q_miss_ur', { path: 'q', guess: 'miss', plain: true }],
    ['q_miss_en', { path: 'q', guess: 'miss', plain: true }],
    ['q_miss_ur_lang', { path: 'q', guess: 'lang', plain: true }],
    ['q_hit_ur', { path: 'q', guess: 'hit', plain: true }],
    ['h_ur_en_phone', { path: 'h', guess: 'miss', plain: true }],
    ['h_ur_lang', { path: 'h', guess: 'lang', plain: true }],
  ])('%s: one event for the early head, with exactly path, guess and plain', async (name, want) => {
    expect(await heads(name, true)).toEqual([want]);
  });

  test.each(Object.keys(SCENARIOS))('switch off, %s: no first_head event', async (name) => {
    expect(await heads(name, false)).toEqual([]);
  });

  test('the event changes no byte of the page', async () => {
    for (const name of Object.keys(SCENARIOS)) {
      const logged = await run(name, true, { logEvent: () => {} });
      expect(logged).toEqual(await run(name, true));
    }
  });
});

// ── a fresh portal process that learns the page switches from the bot before its first page (web_quiz_edge_learn) ──
describe('a fresh process learns plain_paint with the fast page (the bot\'s learn answer)', () => {
  const http = require('http');
  const express = require('express');
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const res = (status, body) => ({ status, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  const URDU = { quiz: { id: 'q-1', code: 'UR12CD', topic: 'پودے کے حصے', lang: 'ur', dir: 'rtl', grade: '3', subject: 'Science', n: 1, questions: [] }, cls: { label: 'Class 3', chips: [] }, brand: 'niete', rt: false, fast: true };
  const timers = () => ({ set: () => ({ unref() {} }), clear() {}, after: () => ({ unref() {} }), cancel() {} });
  async function firstQuizHead(learn) {
    const fetchImpl = (url) => Promise.resolve(url.endsWith('/api/internal/wq/edge') ? res(200, learn) : res(200, URDU));
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, edgeLearn: { timers: timers() } }));
    const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      await new Promise((r) => setTimeout(r, 30)); // the learn ask, at boot
      const body = await new Promise((resolve, reject) => {
        const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/q/UR12CD', headers: { host: 'portal.example' } }, (rs) => {
          let b = ''; rs.setEncoding('utf8'); rs.on('data', (c) => { b += c; }); rs.on('end', () => resolve(b));
        });
        q.on('error', reject); q.end();
      });
      return early(body);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  }
  const LEARN = { learn: true, fast: true, brand: 'niete', rt: false };

  test('learn says plain_paint: true → the very first guessed head says no words', async () => {
    const top = await firstQuizHead({ ...LEARN, plain_paint: true });
    expect(top).toMatch(/<html lang="" dir="auto">/);
    expect(english(top)).toEqual([]);
  });

  test.each([['false', { ...LEARN, plain_paint: false }], ['absent', LEARN]])('learn says plain_paint %s → today\'s guessed head', async (_n, learn) => {
    const top = await firstQuizHead(learn);
    expect(top).toMatch(/<html lang="en" dir="ltr">/);
    expect(top).toMatch(/Opening the quiz…/);
  });
});
