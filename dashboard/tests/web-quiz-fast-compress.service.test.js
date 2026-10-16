/**
 * The fast first page, light on data: the streamed /q/:code and /h/:token pages (app_settings web_quiz_fast on)
 * are compressed by the portal itself (the hosting edge compresses only a whole, buffered answer), and the head still
 * reaches the phone before the bot answers — on a repeat visit too (an early paint, never a 304 that waits for the
 * bot). The buffered path (nf=1) keeps its ETag and 304.
 *
 * The bot is the network boundary (a fake fetch the test releases by hand). No first-party module is mocked.
 */
const http = require('http');
const zlib = require('zlib');
const express = require('express');
const { createWebQuizRouter, renderQuizPage, renderHubPage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const AE = 'gzip, deflate, br';

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
// A quiz the size of a real one (~50 KB of page): thirty questions with voices, as the bot sends them.
const QUIZ_BIG = (extra = {}) => {
  const q = QUIZ(extra);
  const questions = Array.from({ length: 30 }, (_, i) => ({
    qid: `x${i}`, i: i + 1, text: `Question ${i + 1}: which part of the plant ${['drinks water', 'makes food', 'holds it up', 'makes seeds', 'protects the bud'][i % 5]}?`,
    options: ['Roots', 'Leaves', 'Stem', 'Flower'].map((t, k) => ({ slot: 'ABCD'[k], text: t, audio: `https://media.example/voice/q${i}-${k}.mp3?X-Amz-Signature=${(i * 7919 + k * 104729).toString(16).repeat(8)}` })),
    correct_slot: 'A', explain: 'Roots take in water and minerals from the soil and carry them up the stem to every leaf. '.repeat(6),
  }));
  return { ...q, quiz: { ...q.quiz, n: 30, questions } };
};
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Sana', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
const ver = (body) => body.match(/wq\.css\?v=([0-9a-f]+)/)[1];

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function decoderFor(enc) {
  if (enc === 'br') return zlib.createBrotliDecompress();
  if (enc === 'gzip') return zlib.createGunzip();
  return null;
}

/**
 * GET path like a phone: raw bytes on the wire are counted; the body is decoded as it streams, so `onFirstText`
 * fires on the first DECODED text the phone could paint (a compressor that holds the head back fails here).
 */
function get(srv, path, { headers = {}, onFirstText } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example', ...headers } }, (res) => {
      let wire = 0;
      const texts = [];
      const enc = res.headers['content-encoding'];
      const dec = decoderFor(enc);
      const src = dec ? res.pipe(dec) : res;
      res.on('data', (c) => { wire += c.length; });
      src.on('data', (c) => { texts.push(c.toString('utf8')); if (texts.length === 1 && onFirstText) onFirstText(texts[0]); });
      src.on('end', () => resolve({ status: res.statusCode, headers: res.headers, wire, body: texts.join('') }));
      src.on('error', reject);
    });
    r.on('error', reject);
    r.end();
  });
}

/** A bot whose answers marked { hold } wait for release(); every other call answers at once. */
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

/** Waits for the first decoded text, then lets the bot answer; a 400 ms fallback keeps a red run from hanging. */
async function earlyGet(srv, bot, path, headers) {
  let answered = false;
  let answeredAtFirstText = null;
  let early = null;
  const answer = () => { if (!answered) { answered = true; bot.release(); } };
  const fallback = setTimeout(answer, 400);
  const res = await get(srv, path, { headers, onFirstText: (t) => { early = t; answeredAtFirstText = answered; answer(); } });
  clearTimeout(fallback);
  return { res, early, answeredAtFirstText };
}

describe('fast first page, compressed: GET /q/:code', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('switch on, the phone takes br: br + vary, the head decodes before the bot answers, the page is whole', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), { hold: true, res: jsonRes(200, QUIZ({ fast: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const { res, early, answeredAtFirstText } = await earlyGet(srv, bot, '/q/AB12CD', { 'accept-encoding': AE });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(String(res.headers.vary || '')).toMatch(/accept-encoding/i);
    expect(answeredAtFirstText).toBe(false);
    expect(early).toMatch(/<link rel="stylesheet" href="\/wq\/wq\.css\?v=/);
    expect(early).toMatch(/<div class="wq-boot">/);
    expect(early).not.toMatch(/id="boot"/);
    const boot = JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(boot.quiz.code).toBe('AB12CD');
    expect(res.body.trimEnd().endsWith('</html>')).toBe(true);
    // Light on data: the wire carries well under half the page.
    expect(res.wire).toBeLessThan(Buffer.byteLength(res.body) / 2);
  });

  it('switch on, the phone takes gzip only: gzip, and the head still decodes before the bot answers', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), { hold: true, res: jsonRes(200, QUIZ({ fast: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const { res, early, answeredAtFirstText } = await earlyGet(srv, bot, '/q/AB12CD', { 'accept-encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(answeredAtFirstText).toBe(false);
    expect(early).toMatch(/<div class="wq-boot">/);
    expect(res.body).toMatch(/<script id="boot"/);
  });

  it('switch on: the decoded page is the same page with or without compression', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const plain = await get(srv, '/q/AB12CD');
    const br = await get(srv, '/q/AB12CD', { headers: { 'accept-encoding': AE } });
    const gz = await get(srv, '/q/AB12CD', { headers: { 'accept-encoding': 'gzip' } });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(br.body).toBe(plain.body);
    expect(gz.body).toBe(plain.body);
  });

  it('switch on, a repeat visit (the phone holds a copy): the head again before the bot answers, compressed, a full page under 15 KB on the wire', async () => {
    const big = QUIZ_BIG({ fast: true });
    const bot = heldBot([jsonRes(200, big), jsonRes(200, big), { hold: true, res: jsonRes(200, big) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const first = await get(srv, '/q/AB12CD', { headers: { 'accept-encoding': AE } });
    expect(Buffer.byteLength(first.body)).toBeGreaterThan(45000);
    const { res, early, answeredAtFirstText } = await earlyGet(srv, bot, '/q/AB12CD', { 'accept-encoding': AE, 'if-none-match': 'W/"anything"', 'if-modified-since': new Date().toUTCString() });
    expect(res.status).toBe(200);
    expect(answeredAtFirstText).toBe(false);
    expect(early).toMatch(/<div class="wq-boot">/);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers.etag).toBeUndefined();
    expect(res.body).toBe(first.body);
    expect(res.wire).toBeLessThan(15 * 1024);
  });

  it('switch on, the old way (nf=1): a whole answer the edge compresses, with its ETag, and an unchanged revisit is a 304', async () => {
    const bot = heldBot([jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true })), jsonRes(200, QUIZ({ fast: true }))]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const first = await get(srv, '/q/AB12CD?nf=1', { headers: { 'accept-encoding': AE } });
    expect(first.headers['content-encoding']).toBeUndefined();
    expect(first.headers.etag).toBeTruthy();
    const again = await get(srv, '/q/AB12CD?nf=1', { headers: { 'accept-encoding': AE, 'if-none-match': first.headers.etag } });
    expect(again.status).toBe(304);
    expect(again.wire).toBe(0);
  });

  it('switch off, the phone takes br: today\'s render byte for byte, no content-encoding of the portal\'s own (the edge compresses it)', async () => {
    const bot = heldBot([jsonRes(200, QUIZ()), jsonRes(200, QUIZ())]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, '/q/AB12CD');
    const res = await get(srv, '/q/AB12CD', { headers: { 'accept-encoding': AE } });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(renderQuizPage({ payload: QUIZ(), code: 'AB12CD', view: 'quiz', origin: 'http://portal.example', assetV: ver(res.body) }));
  });
});

describe('fast first page, compressed: GET /h/:token', () => {
  let srv;
  afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

  it('switch on, the phone takes br: br + vary, the head decodes before the bot answers, the hub is whole', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), { hold: true, res: jsonRes(200, HUB({ fast: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const { res, early, answeredAtFirstText } = await earlyGet(srv, bot, `/h/${TOKEN}`, { 'accept-encoding': AE });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    expect(String(res.headers.vary || '')).toMatch(/accept-encoding/i);
    expect(answeredAtFirstText).toBe(false);
    expect(early).toMatch(/<main id="wq" class="wq-app wq-hub"/);
    const boot = JSON.parse(res.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    expect(boot.view).toBe('hub');
    expect(res.body.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('switch on, a repeat visit to the hub: the head again before the bot answers, compressed', async () => {
    const bot = heldBot([jsonRes(200, HUB({ fast: true })), jsonRes(200, HUB({ fast: true })), { hold: true, res: jsonRes(200, HUB({ fast: true })) }]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const first = await get(srv, `/h/${TOKEN}`, { headers: { 'accept-encoding': AE } });
    const { res, answeredAtFirstText } = await earlyGet(srv, bot, `/h/${TOKEN}`, { 'accept-encoding': AE, 'if-none-match': 'W/"anything"' });
    expect(res.status).toBe(200);
    expect(answeredAtFirstText).toBe(false);
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body).toBe(first.body);
  });

  it('switch off: the hub is today\'s render byte for byte, no content-encoding of the portal\'s own', async () => {
    const bot = heldBot([jsonRes(200, HUB()), jsonRes(200, HUB())]);
    srv = await start(build(bot.fetchImpl));
    await get(srv, `/h/${TOKEN}`);
    const res = await get(srv, `/h/${TOKEN}`, { headers: { 'accept-encoding': AE } });
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toBe(renderHubPage({ payload: HUB(), token: TOKEN, origin: 'http://portal.example', assetV: ver(res.body) }));
  });
});
