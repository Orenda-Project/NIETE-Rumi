/**
 * Two small speed aids at the edge, both only while the bot's pages say `fast: true` (app_settings web_quiz_fast):
 *  1. the page head opens the connection to the audio host early (one <link rel="preconnect">), so the first sound
 *     does not pay DNS + TCP + TLS on a slow phone. The host comes from config: the portal's R2_ENDPOINT, with the
 *     bucket label the bot's presigned URLs put in front of it (no endpoint configured, no preconnect).
 *  2. every answer that waited on the bot says how long (Server-Timing: bot;dur=<ms>); a page already streaming
 *     (headers gone) carries it as a performance mark in its tail.
 * Switch off: pages and headers are today's, byte for byte.
 *
 * The bot is the network boundary (a fake fetch). No first-party module is mocked.
 */
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const WebQuizBrand = require('../../bot/shared/config/web-quiz-brand');
const { createWebQuizRouter, renderQuizPage, renderHubPage, renderChallengePage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const ORIGIN = 'http://portal.example';
const ENDPOINT = 'https://0123abcd.r2.cloudflarestorage.com'; // the portal's R2_ENDPOINT (same as the bot's)
const R2 = 'https://wq-media.0123abcd.r2.cloudflarestorage.com'; // the bot signs virtual-hosted: <bucket>.<endpoint host>
const PRE = `<link rel="preconnect" href="${R2}" crossorigin>`;
const HUB_TOKEN = `${'h'.repeat(40)}.${'s'.repeat(22)}`;
const CH_TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const audio = (host = R2, f = 'q1') => `${host}/quiz/audio/${f}.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc123`;
const QUIZ = (extra = {}, host = R2) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', audio: host ? audio(host) : null,
      options: [{ slot: 'A', text: 'Roots', audio: host ? audio(host, 'a') : null }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null, preview: false, brand: 'niete', rt: false,
  ...extra,
});
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  quizzes: [{ code: 'AB12CD', topic: 'Plants', voice: audio(R2, 'hub') }], brand: 'niete', rt: false,
  ...extra,
});
const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'story', name: 'Story Time', mins: 2, done: false, last: null, clip: audio(R2, 'story') }] };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

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

function bot(answers) {
  const calls = [];
  const fetchImpl = (url) => { calls.push(url); return Promise.resolve(answers.shift()); };
  return { fetchImpl, calls };
}

function build(fetchImpl, r2Endpoint = ENDPOINT) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, r2Endpoint }));
  return app;
}

const ver = (body) => body.match(/wq\.css\?v=([0-9a-f]+)/)[1];
const count = (s, sub) => s.split(sub).length - 1;
const headOf = (body) => body.slice(0, body.indexOf('</head>'));
const MARK_RX = /<script>performance\.mark\("wq-bot",\{detail:\d+\}\)<\/script>\n?<\/body>/;
const TIMING_RX = /^bot;dur=\d+$/;

describe('switch off: pages and headers are today\'s, byte for byte (the payloads carry audio links)', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('/q/, /h/, /c/ and an /api/wq answer: no preconnect, no Server-Timing, no mark', async () => {
    const b = bot([jsonRes(200, QUIZ()), jsonRes(200, QUIZ()), jsonRes(200, HUB()), jsonRes(200, MENU), jsonRes(200, { rows: [] })]);
    srv = await start(build(b.fetchImpl));
    const q1 = await get(srv, '/q/AB12CD');
    const q2 = await get(srv, '/q/AB12CD');
    const want = renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ver(q1.body) });
    expect(q1.body).toBe(want);
    expect(q2.body).toBe(want);
    const h = await get(srv, `/h/${HUB_TOKEN}`);
    expect(h.body).toBe(renderHubPage({ payload: HUB(), token: HUB_TOKEN, origin: ORIGIN, assetV: ver(h.body) }));
    const c = await get(srv, `/c/${CH_TOKEN}`);
    expect(c.status).toBe(200);
    expect(c.body).toBe(renderChallengePage({ menu: MENU, token: CH_TOKEN, kid: null, origin: ORIGIN, assetV: ver(c.body),
      chV: c.body.match(/wq-challenge\.js\?v=([0-9a-z]+)/)[1], brandKey: 'niete' }));
    const api = await get(srv, '/api/wq/board/AB12CD');
    for (const r of [q1, q2, h, c, api]) {
      expect(r.headers['server-timing']).toBeUndefined();
      expect(r.body).not.toMatch(/preconnect|wq-bot/);
    }
  });
});

describe('switch on: the audio host is preconnected, and the bot\'s wait is named', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('/q/ rendered whole (the page that teaches the edge): one preconnect in the head, Server-Timing on the answer', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(b.fetchImpl));
    const r = await get(srv, '/q/AB12CD');
    expect(count(r.body, 'rel="preconnect"')).toBe(1);
    expect(headOf(r.body)).toContain(PRE);
    expect(r.headers['server-timing']).toMatch(TIMING_RX);
  });

  it('/q/ streamed: the preconnect goes in the first chunk; the bot\'s wait rides as a mark before </body>', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(b.fetchImpl));
    await get(srv, '/q/AB12CD');
    const r = await get(srv, '/q/AB12CD');
    expect(headOf(r.chunks[0])).toContain(PRE);
    expect(count(r.body, 'rel="preconnect"')).toBe(1);
    expect(r.body).toMatch(MARK_RX);
    expect(r.body.trimEnd().endsWith('</html>')).toBe(true);
    expect(r.headers['server-timing']).toBeUndefined();
  });

  it('/h/ rendered whole and streamed: one preconnect in the head; Server-Timing, then a mark', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(build(b.fetchImpl));
    await get(srv, '/q/AB12CD');
    const whole = await get(srv, `/h/${HUB_TOKEN}?nf=1`);
    expect(count(whole.body, 'rel="preconnect"')).toBe(1);
    expect(headOf(whole.body)).toContain(PRE);
    expect(whole.headers['server-timing']).toMatch(TIMING_RX);
    const streamed = await get(srv, `/h/${HUB_TOKEN}`);
    expect(headOf(streamed.chunks[0])).toContain(PRE);
    expect(count(streamed.body, 'rel="preconnect"')).toBe(1);
    expect(streamed.body).toMatch(MARK_RX);
  });

  it('/c/<token> (Story Time\'s page) and an /api/wq answer: preconnect and Server-Timing', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, MENU), jsonRes(200, { rows: [] }), jsonRes(404, { error: 'not_found' })]);
    srv = await start(build(b.fetchImpl));
    await get(srv, '/q/AB12CD');
    const c = await get(srv, `/c/${CH_TOKEN}`);
    expect(c.status).toBe(200);
    expect(count(c.body, 'rel="preconnect"')).toBe(1);
    expect(headOf(c.body)).toContain(PRE);
    expect(c.headers['server-timing']).toMatch(TIMING_RX);
    const api = await get(srv, '/api/wq/board/AB12CD');
    expect(api.headers['server-timing']).toMatch(TIMING_RX);
    const miss = await get(srv, '/api/wq/quiz/ZZ99ZZ');
    expect(miss.status).toBe(404);
    expect(miss.headers['server-timing']).toMatch(TIMING_RX);
  });

  it('no audio host known yet: no preconnect (the timing still rides)', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true }, null))]);
    srv = await start(build(b.fetchImpl));
    const r = await get(srv, '/q/AB12CD');
    expect(r.body).not.toMatch(/preconnect/);
    expect(r.headers['server-timing']).toMatch(TIMING_RX);
  });

  it.each([
    ['another host', 'https://media.example.com/x.r2.cloudflarestorage.com'],
    ['a look-alike host', 'https://wq.0123abcd.r2.cloudflarestorage.com.evil.example'],
    ['a host with a port', 'https://wq.0123abcd.r2.cloudflarestorage.com:8443'],
    ['plain http', 'http://wq.0123abcd.r2.cloudflarestorage.com'],
    ['markup in the host', 'https://a"><script>x</script>.r2.cloudflarestorage.com'],
    ['another R2 account', 'https://wq-media.9999ffff.r2.cloudflarestorage.com'],
    ['two labels in front of the endpoint', 'https://a.wq-media.0123abcd.r2.cloudflarestorage.com'],
  ])('%s is never echoed', async (_n, host) => {
    const b = bot([jsonRes(200, QUIZ({ fast: true }, host))]);
    srv = await start(build(b.fetchImpl));
    const r = await get(srv, '/q/AB12CD');
    expect(headOf(r.body)).not.toMatch(/preconnect/);
  });

  it('no R2_ENDPOINT configured on the portal: no preconnect (the timing still rides)', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(b.fetchImpl, ''));
    const r = await get(srv, '/q/AB12CD');
    expect(r.body).not.toMatch(/preconnect/);
    expect(r.headers['server-timing']).toMatch(TIMING_RX);
  });

  it('a path-style link on the endpoint host itself: that host is preconnected', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true }, `${ENDPOINT}/rumi-sandbox`))]);
    srv = await start(build(b.fetchImpl));
    const r = await get(srv, '/q/AB12CD');
    expect(headOf(r.body)).toContain(`<link rel="preconnect" href="${ENDPOINT}" crossorigin>`);
    expect(count(r.body, 'rel="preconnect"')).toBe(1);
  });

  it('switch turned off after it was on: the next page is today\'s again (no tag, no header)', async () => {
    const b = bot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ()), jsonRes(200, QUIZ())]);
    srv = await start(build(b.fetchImpl));
    await get(srv, '/q/AB12CD');
    const turning = await get(srv, '/q/AB12CD?nf=1');
    expect(turning.headers['server-timing']).toBeUndefined();
    expect(turning.body).not.toMatch(/preconnect/);
    const r = await get(srv, '/q/AB12CD');
    expect(r.body).toBe(renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: ORIGIN, assetV: ver(r.body) }));
    expect(r.headers['server-timing']).toBeUndefined();
  });
});

// The fast first page is compressed by the portal itself (br, else gzip): the mark rides inside the compressed tail.
function getRaw(srv, path, enc) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example', 'accept-encoding': enc } }, (res) => {
      const raw = [];
      res.on('data', (c) => raw.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(raw) }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('switch on, the streamed page compressed: the mark is inside the compressed stream', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it.each([
    ['br', 'gzip, deflate, br', (b) => zlib.brotliDecompressSync(b)],
    ['gzip', 'gzip', (b) => zlib.gunzipSync(b)],
  ])('%s: /q/ and /h/ decode to a whole page with one mark before </body>, never in the clear on the wire', async (enc, ae, decode) => {
    const b = bot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true })), jsonRes(200, HUB({ fast: true }))]);
    srv = await start(build(b.fetchImpl));
    await get(srv, '/q/AB12CD');
    for (const path of ['/q/AB12CD', `/h/${HUB_TOKEN}`]) {
      const r = await getRaw(srv, path, ae);
      expect(r.headers['content-encoding']).toBe(enc);
      expect(r.headers['server-timing']).toBeUndefined();
      expect(r.raw.includes('wq-bot')).toBe(false);
      const text = decode(r.raw).toString('utf8');
      expect(count(text, 'performance.mark("wq-bot"')).toBe(1);
      expect(text).toMatch(MARK_RX);
      expect(text.endsWith('</body>\n</html>')).toBe(true);
      expect(headOf(text)).toContain(PRE);
    }
  });
});

// keep the brand table honest for the /c/ golden above (the challenge page's brand is the last one the bot named)
test('the fixtures name a known brand', () => { expect(Object.keys(WebQuizBrand.BRANDS)).toContain('niete'); });
