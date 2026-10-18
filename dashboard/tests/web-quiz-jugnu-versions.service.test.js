/**
 * Jugnu's pictures built by the page scripts carry their version when the page names them.
 *
 * With app_settings web_quiz_brotli on, an unversioned /wq file is kept a day (web-quiz-static.js), so every Jugnu
 * picture a script builds must ask with ?v=<hash of that picture>, the same URL the page shell uses. The shell puts
 * the versions on the page (window.WQJV, and window.wqjv(url) that reads it) only with the switch on; each script's
 * jv(url) asks wqjv when the page has it. Switch off (no map): the scripts build exactly today's URLs.
 *
 * The scripts run whole in a vm (the shared page harnesses); the edge runs through its router. No first-party
 * module is mocked.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { picMapScript } = require('../routes/web-quiz-static');

const PUB = path.join(__dirname, '..', 'public', 'wq');
const SCRIPTS = ['class-link.js', 'hub-play.js', 'hub.js', 'wq-challenge.js', 'wq-home.js', 'wq-lib.js', 'wq-readalong-listen.js',
  'wq-stories.js', 'wq.js'];
const src = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const hash10 = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(PUB, rel))).digest('hex').slice(0, 10);

/** What the edge puts on the page with the switch on: every Jugnu picture and loop, and its version. */
function MAP() {
  const m = {};
  for (const n of fs.readdirSync(path.join(PUB, 'jugnu')).filter((x) => /\.(webp|webm)$/.test(x))) m[`jugnu/${n}`] = hash10(`jugnu/${n}`);
  for (const n of fs.readdirSync(PUB).filter((x) => /^jugnu_.*\.webp$/.test(x))) m[n] = hash10(n);
  return m;
}
/** Every /wq/jugnu… URL in a piece of html. */
const jugUrls = (html) => [...String(html).matchAll(/\/wq\/jugnu[/_][A-Za-z0-9_-]+\.(?:webp|webm)(?:\?v=[0-9a-f]+)?/g)].map((m) => m[0]);
/** Each URL carries exactly the version of its own picture. */
function expectVersioned(urls, map) {
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) {
    const [p, v] = u.split('?v=');
    expect(`${u}: ${v}`).toBe(`${u}: ${map[p.slice('/wq/'.length)]}`);
  }
}
/** The page's inline script that names Jugnu's pictures (what the edge put before the page's files), or ''. */
const inlineOf = (html) => [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((c) => /WQJV|wqjv/.test(c)).join('\n');
const TAG = (map) => inlineOf(picMapScript(map));
/** The script's own jv, run in a vm on a window that ran `page` (the page's inline code: the map, or nothing). */
function jvOf(f, map, page) {
  const line = src(f).split('\n').filter((l) => /^\s*function jv\(u\)/.test(l));
  expect(line.length).toBe(1);
  const ctx = { window: {}, String };
  vm.createContext(ctx);
  const code = page != null ? page : (map ? TAG(map) : '');
  vm.runInContext(`(function (window) { ${code} })(this.window);`, ctx);
  vm.runInContext(`${line[0]}\nthis.jv = jv;`, ctx);
  return ctx.jv;
}
const JV_SCRIPTS = SCRIPTS.filter((f) => f !== 'wq-stories.js');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

describe('each page script builds Jugnu\'s picture URLs through jv(url)', () => {
  // Every place a script builds a Jugnu picture URL: '/wq/jugnu…' in a string (alone or inside markup), or a picture
  // folder constant + a name. Allowed only as jv(…)'s argument; the folder constants' own declarations and comments
  // are not URLs.
  const LITERAL = /\/wq\/jugnu[/_]/g;
  const JOIN = /\b(?:JUG_DIR|JUG_OLD|IMG|JUG)\s*\+/g;
  test.each(SCRIPTS)('%s: no Jugnu URL is built outside jv()', (f) => {
    const bare = [];
    src(f).split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) || /^\s*var [A-Z_]+ = '\/wq\/jugnu[/_]';/.test(line)) return;
      for (const rx of [LITERAL, JOIN]) {
        for (const m of line.matchAll(rx)) {
          if (rx === LITERAL && line[m.index - 1] === '\\') continue;   // a regex's \/wq\/jugnu, not a URL
          const before = line.slice(0, m.index);
          if (!/jv\('?$/.test(before)) bare.push(`${f}:${i + 1}: ${line.slice(Math.max(0, m.index - 40), m.index + 30).trim()}`);
        }
      }
    });
    expect(bare).toEqual([]);
  });
  test('the stories pages build theirs through img(), which asks the page\'s wqjv when it has one', () => {
    expect(src('wq-stories.js')).toMatch(/' src="' \+ esc\(W\.wqjv \? W\.wqjv\(src\) : src\) \+ '"/);
  });

  test('the stories page: img() versions a Jugnu picture with the map, and leaves every other picture', () => {
    const s = src('wq-stories.js');
    const line = s.split('\n').find((l) => /^\s*function img\(src, w, h, cls, ex\)/.test(l));
    const run = (map) => {
      const ctx = { window: {}, String };
      vm.createContext(ctx);
      if (map) vm.runInContext(`(function (window) { ${TAG(map)} })(this.window);`, ctx);
      vm.runInContext(`var W = this.window; function esc(x) { return String(x == null ? '' : x); }\n${line}\nthis.img = img;`, ctx);
      return ctx.img;
    };
    const map = MAP();
    expect(run(map)('/wq/jugnu/thinking.webp', 96, 96, 'wqs-jg')).toContain(`src="/wq/jugnu/thinking.webp?v=${map['jugnu/thinking.webp']}"`);
    expect(run(map)('/s/book/p1-abcdef12.webp', 96, 96)).toContain('src="/s/book/p1-abcdef12.webp"');
    expect(run(null)('/wq/jugnu/thinking.webp', 96, 96, 'wqs-jg')).toContain('src="/wq/jugnu/thinking.webp"');
  });
  test.each(JV_SCRIPTS)('%s: jv() adds the picture\'s version with the map, and changes nothing without it', (f) => {
    const map = MAP();
    const on = jvOf(f, map);
    const off = jvOf(f, null);
    for (const u of ['/wq/jugnu/hello.webp', '/wq/jugnu/thinking.webp', '/wq/jugnu/celebrate_a.webm', '/wq/jugnu_sleep.webp']) {
      expect(on(u)).toBe(`${u}?v=${map[u.slice(4)]}`);
      expect(off(u)).toBe(u);
    }
    // a name not in the map (a story picture, an unknown pose) is left as it is
    for (const u of ['/s/book/p1-abcdef12.webp', '/wq/jugnu/nope.webp', 'https://x.test/a.webp']) expect(on(u)).toBe(u);
    expect(jvOf(f, {})('/wq/jugnu/hello.webp')).toBe('/wq/jugnu/hello.webp');
    expect(on('/wq/jugnu/constructor')).toBe('/wq/jugnu/constructor');
  });
});

describe('the quiz page (wq.js, run whole): every Jugnu picture it draws carries its version with the map', () => {
  const { page } = require('./wq-page-harness');
  // The landing's html from the code without this change (switch off is today's page, byte for byte).
  const BASE_LANDING = { en: '35d45103d278e1ef', ur: '17231a292938b0c6' };
  test.each(['en', 'ur'])('%s landing: today\'s html without the map; versioned with it', (lang) => {
    const p = page({ lang });
    const plain = p.html();
    expect(jugUrls(plain).length).toBeGreaterThan(0);
    expect(plain).not.toMatch(/jugnu[^"]*\?v=/);
    expect(sha(plain)).toBe(BASE_LANDING[lang]);
    const map = MAP();
    vm.runInContext(TAG(map), p.ctx);
    p.wq.landing();
    expectVersioned(jugUrls(p.html()), map);
    // the map is the only difference
    expect(p.html().replace(/(\/wq\/jugnu[/_][A-Za-z0-9_-]+\.webp)\?v=[0-9a-f]{10}/g, '$1')).toBe(plain);
  });
});

describe('the challenge page (wq-challenge.js, run whole)', () => {
  const H = require('./wqc-page-harness');
  const BASE_MENU = 'ed60a4ad6d90033c';
  const all = (p) => p.root.innerHTML;
  test('without the map: today\'s Jugnu URLs; with it: versioned', async () => {
    const off = H.page();
    await new Promise((r) => setTimeout(r, 30));
    const offHtml = all(off);
    expect(jugUrls(offHtml).length).toBeGreaterThan(0);
    expect(offHtml).not.toMatch(/jugnu[^"]*\?v=/);
    expect(sha(offHtml)).toBe(BASE_MENU);
    const map = MAP();
    const on = H.page({ pre: [TAG(map)] });
    await new Promise((r) => setTimeout(r, 30));
    expectVersioned(jugUrls(all(on)), map);
  });
});

describe('the edge puts the map on the page only with web_quiz_brotli on', () => {
  const { createWebQuizRouter } = require('../routes/web-quiz.routes');
  const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
  const HUB = { lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false };
  const QUIZ = { quiz: { id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1, questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }] }, cls: { label: 'Class 3', teacher: 'Teacher Testwala', chips: [] }, live: { class_today: 0, ict_today_floor: 40 }, video: null, preview: false, brand: 'niete', rt: false };
  const res = (body) => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
  const bot = (fast) => (url) => Promise.resolve(String(url).includes('/hub/') ? res({ ...HUB, fast }) : res({ ...QUIZ, fast }));
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(() => { srv = null; r(); }) : r())));
  function get(p) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'portal.example' } }, (r) => {
        const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
      }).on('error', reject);
    });
  }
  async function serve(fast, on) {
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: bot(fast), brotliOn: () => on }));
    srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    await get(`/h/${TOKEN}`);
  }
  const mapIn = (html) => { const m = /<script>window\.WQJV=(\{[^}<]*\});window\.wqjv=/.exec(html); return m ? JSON.parse(m[1]) : null; };
  test.each([[false, 'web_quiz_fast off'], [true, 'web_quiz_fast on (the streamed page)']])('switch on, %s: one map, before the page\'s first script, every picture\'s version', async (fast) => {
    await serve(fast, true);
    for (const p of [`/h/${TOKEN}`, '/q/AB12CD', '/q/AB12CD?nf=1']) {
      const html = await get(p);
      expect(html.match(/window\.WQJV=/g) || []).toHaveLength(1);
      expect(html.indexOf('<script>window.WQJV=')).toBe(html.indexOf('<script'));
      expect(mapIn(html)).toEqual(MAP());
      expect(html).toContain(picMapScript(MAP()));
      // a script on this page builds the versioned URL
      expect(jvOf('hub.js', null, inlineOf(html))('/wq/jugnu/hello.webp')).toBe(`/wq/jugnu/hello.webp?v=${hash10('jugnu/hello.webp')}`);
    }
  });
  test.each([false, true])('switch off (web_quiz_fast %s): no map on the page', async (fast) => {
    await serve(fast, false);
    for (const p of [`/h/${TOKEN}`, '/q/AB12CD', '/h/not-a-token']) {
      const html = await get(p);
      expect(html).not.toContain('WQJV');
      expect(html).not.toContain('wqjv');
    }
  });

  // Each value the switch reads as OFF, through the real switch: no map, no wqjv, no ?v= on the shell's pictures, and
  // every script run on that page builds today's bare URL.
  const fakeDb = (answer) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => answer() }) }) }) });
  const OFF = [['the string true', 'true'], ['a quoted string', '"true"'], ['yes', 'yes'], ['1', 1], ['an object', { enabled: true }],
    ['no row', undefined], ['a read error', 'ERR']];
  test.each(OFF)('%s is OFF: no map, bare picture URLs from the shell and from every script', async (_, value) => {
    const answer = value === 'ERR' ? () => ({ data: null, error: { message: 'down' } }) : value === undefined ? () => ({ data: null, error: null }) : () => ({ data: { value }, error: null });
    const flag = require('../routes/web-quiz-brotli-flag').createBrotliFlag({ db: () => fakeDb(answer) });
    flag();
    await flag.ready();
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl: bot(true), brotliOn: flag }));
    srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    await get(`/h/${TOKEN}`);
    for (const p of [`/h/${TOKEN}`, '/q/AB12CD']) {
      const html = await get(p);
      expect(html).not.toContain('WQJV');
      expect(html).not.toMatch(/jugnu[^"]*\?v=/);
      for (const f of JV_SCRIPTS) expect(jvOf(f, null, inlineOf(html))('/wq/jugnu/hello.webp')).toBe('/wq/jugnu/hello.webp');
    }
  });
});
