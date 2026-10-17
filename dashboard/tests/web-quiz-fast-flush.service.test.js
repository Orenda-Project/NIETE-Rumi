/**
 * Fast first page at the edge (the bot's payload says `fast: true` when app_settings web_quiz_fast is on):
 * GET /q/:code sends the page's head (styles, script preloads) and the Jugnu boot frame at once, and the quiz
 * payload + scripts when the bot answers — so a phone paints and fetches the page's files during the bot's wait.
 *
 * The bot is the network boundary (a fake fetch the test releases by hand). No first-party module is mocked.
 * Every request here is a fresh profile phone: no cookie, no device ref, nothing cached — the first open of a link.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const URDU = (extra = {}) => {
  const q = QUIZ(extra);
  return { ...q, quiz: { ...q.quiz, code: 'UR12CD', topic: 'پودے کے حصے', lang: 'ur', dir: 'rtl' }, ui: { ur2: true } };
};

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

/** GET path; resolves with the status, headers, the chunks as they came, and the whole body at the end. */
function get(srv, path, { onFirstChunk } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example' } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks.push(c); if (chunks.length === 1 && onFirstChunk) onFirstChunk(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot whose quiz answers wait for release(); every other call answers at once. */
function heldBot(answers) {
  const calls = [];
  let held = [];
  const fetchImpl = (url) => {
    calls.push(url);
    const body = answers.shift();
    if (body && body.hold) return new Promise((r) => held.push(() => r(body.res)));
    return Promise.resolve(body && body.res ? body.res : body);
  };
  const release = () => { const h = held; held = []; h.forEach((f) => f()); };
  return { fetchImpl, calls, release };
}

function build(fetchImpl) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl }));
  return app;
}

describe('fast first page: GET /q/:code (renderQuizPage, a fresh profile phone)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('switch off (no `fast` in the payload): every page is today\'s server render, byte for byte', async () => {
    const bot = heldBot([jsonRes(200, QUIZ()), jsonRes(200, QUIZ())]);
    srv = await start(build(bot.fetchImpl));
    const a = await get(srv, '/q/AB12CD');
    const b = await get(srv, '/q/AB12CD');
    expect(a.status).toBe(200);
    const want = renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: 'http://portal.example', assetV: a.body.match(/wq\.css\?v=([0-9a-f]+)/)[1] });
    expect(a.body).toBe(want);
    expect(b.body).toBe(want);
  });

  it('switch on: the head and the boot frame reach the phone before the bot answers', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), { hold: true, res: jsonRes(200, QUIZ({ fast: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD'); // the page that teaches this edge the switch is on
    let early = null;
    let answered = false;
    let answeredAtFirstChunk = null;
    const answer = () => { if (!answered) { answered = true; bot.release(); } };
    // Today's edge sends nothing until the bot answers: answer anyway after 400 ms so the test ends red, not hung.
    const fallback = setTimeout(answer, 400);
    const res = await get(srv, '/q/AB12CD', { onFirstChunk: (c) => { early = c; answeredAtFirstChunk = answered; answer(); } });
    clearTimeout(fallback);
    expect(res.status).toBe(200);
    expect(answeredAtFirstChunk).toBe(false);
    // Sent while the bot had not answered: the styles, the script preloads and Jugnu, but no quiz yet.
    expect(early).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=/);
    expect(early).toMatch(/<link rel="preload" href="\/wq\/wq\.js\?v=[0-9a-f]+" as="script">/);
    expect(early).toMatch(/<div class="wq-boot"><img src="\/wq\/jugnu\/hello\.webp"/);
    expect(early).not.toMatch(/id="boot"/);
    // The whole page: the boot JSON, then the same scripts in the same order as today's render.
    const boot = JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(boot.quiz.code).toBe('AB12CD');
    const scripts = (s) => s.match(/<script src="[^"]+" defer><\/script>/g);
    const today = renderQuizPage({ payload: QUIZ({ fast: true }), code: 'AB12CD', view: 'quiz', origin: 'http://portal.example', assetV: res.body.match(/wq\.css\?v=([0-9a-f]+)/)[1] });
    expect(scripts(res.body)).toEqual(scripts(today));
    expect(res.body.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('switch on, an Urdu quiz this edge has not seen: the page is set to Urdu before its scripts run', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, URDU({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/UR12CD');
    const fix = res.body.indexOf('h.lang="ur"');
    expect(fix).toBeGreaterThan(-1);
    expect(res.body).toMatch(/h\.dir="rtl"/);
    expect(res.body).toMatch(/classList\.add\("wq-ur2"\)/);
    expect(fix).toBeLessThan(res.body.indexOf('<script src="/wq/wq.js'));
  });

  it('switch on, a code this edge has seen in Urdu: the head is Urdu from the first byte (font preloaded)', async () => {
    const bot = heldBot([jsonRes(200, URDU({ fast: true })), jsonRes(200, URDU({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/UR12CD');
    const res = await get(srv, '/q/UR12CD');
    expect(res.chunks[0]).toMatch(/<html lang="ur" dir="rtl" class="wq-ur2">/);
    expect(res.chunks[0]).toMatch(/rel="preload" href="\/wq\/fonts\/wq-nastaliq-[0-9]+\.woff2" as="font"/);
    expect(res.body).not.toMatch(/h\.lang=/);
  });

  it('switch on, the bot says closed after the head went: the page asks again the old way (nf=1), which answers 404', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(404, { error: 'not_found' }), jsonRes(404, { error: 'not_found' })]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/ZZ99ZZ');
    expect(res.body).toMatch(/location\.replace\(/);
    expect(res.body).toMatch(/nf=1/);
    expect(res.body).not.toMatch(/id="boot"/);
    const again = await get(srv, '/q/ZZ99ZZ?nf=1');
    expect(again.status).toBe(404);
  });

  it('switch on, the bot unreachable after the head went: the page asks again the old way', async () => {
    let n = 0;
    const fetchImpl = async () => { n += 1; if (n === 1) return jsonRes(200, QUIZ({ fast: true })); throw new Error('ECONNREFUSED'); };
    srv = await start(build(fetchImpl));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD');
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/nf=1/);
  });

  it('switch on, a link-preview fetch for a code this edge has not seen: today\'s preview page, never the flushed head or the quiz', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(500, {}), jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const res = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: '/q/PV12CD',
        headers: { host: 'portal.example', 'user-agent': 'WhatsApp/2.23.20.0 A' } }, (rs) => {
        let b = ''; rs.setEncoding('utf8'); rs.on('data', (c) => { b += c; }); rs.on('end', () => resolve({ status: rs.statusCode, body: b }));
      });
      r.on('error', reject); r.end();
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toMatch(/id="boot"/);
    expect(res.body).not.toMatch(/correct_slot/);
    expect(res.body).not.toMatch(/rel="preload" href="\/wq\/wq\.js/);
    expect(res.body).toMatch(/<body><\/body>/);
  });

  it('switch on, then off again: the next page after an off payload is today\'s render', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ()), jsonRes(200, QUIZ())]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD');
    const want = renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: 'http://portal.example', assetV: res.body.match(/wq\.css\?v=([0-9a-f]+)/)[1] });
    expect(res.body).toBe(want);
  });
});

// ── the kid hub /h/<token> ────────────────────────────────────────────────────────────────────────────────────────
const { renderHubPage } = require('../routes/web-quiz.routes');
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const hubVer = (body) => body.match(/wq\.css\?v=([0-9a-f]+)/)[1];

describe('fast first page: GET /h/:token (renderHubPage, a fresh profile phone)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('switch off: the hub is today\'s server render, byte for byte', async () => {
    const bot = heldBot([jsonRes(200, HUB()), jsonRes(200, HUB())]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(res.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: 'http://portal.example', assetV: hubVer(res.body) }));
  });

  it('switch on: the head and the Jugnu frame reach the phone before the bot answers; the scripts are today\'s, in order', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), { hold: true, res: jsonRes(200, HUB({ fast: true, bind: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    let answered = false; let answeredAtFirstChunk = null; let early = null;
    const answer = () => { if (!answered) { answered = true; bot.release(); } };
    const fallback = setTimeout(answer, 400);
    const res = await get(srv, `/h/${TOKEN}`, { onFirstChunk: (c) => { early = c; answeredAtFirstChunk = answered; answer(); } });
    clearTimeout(fallback);
    expect(answeredAtFirstChunk).toBe(false);
    expect(early).toMatch(/<link rel="preload" href="\/wq\/hub\.js\?v=[0-9a-f]+" as="script">/);
    expect(early).toMatch(/<main id="wq" class="wq-app wq-hub"/);
    expect(early).not.toMatch(/id="boot"/);
    const today = renderHubPage({ payload: HUB({ fast: true, bind: true }), token: TOKEN, origin: 'http://portal.example', assetV: hubVer(res.body) });
    const tags = (s) => s.match(/<script src="[^"]+" defer><\/script>|<link rel="stylesheet" href="[^"]+">/g);
    expect(tags(res.body)).toEqual(tags(today));
    const boot = JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(boot.view).toBe('hub');
  });

  it('switch on, an Urdu hub guessed as English: set to Urdu before its scripts run', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true, lang: 'ur' }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    const fix = res.body.indexOf('h.lang="ur"');
    expect(fix).toBeGreaterThan(-1);
    expect(fix).toBeLessThan(res.body.indexOf('<script src="/wq/hub.js'));
  });

  it('switch on, a link-preview fetch of a hub link: today\'s hub render, byte for byte (no early head)', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path: `/h/${TOKEN}`,
        headers: { host: 'portal.example', 'user-agent': 'WhatsApp/2.23.20.0 A' } }, (rs) => {
        let b = ''; rs.setEncoding('utf8'); rs.on('data', (c) => { b += c; }); rs.on('end', () => resolve({ status: rs.statusCode, body: b }));
      });
      r.on('error', reject); r.end();
    });
    expect(res.body).toBe(renderHubPage({ payload: HUB({ fast: true }), token: TOKEN, origin: 'http://portal.example', assetV: hubVer(res.body) }));
  });

  it('switch on, the link has expired (401 after the head went): the page asks again the old way, which answers 401', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), jsonRes(401, { error: 'bad_token' }), jsonRes(401, { error: 'bad_token' })]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`);
    expect(res.body).toMatch(/nf=1/);
    expect(res.body).not.toMatch(/id="boot"/);
    const again = await get(srv, `/h/${TOKEN}?nf=1`);
    expect(again.status).toBe(401);
  });
});
