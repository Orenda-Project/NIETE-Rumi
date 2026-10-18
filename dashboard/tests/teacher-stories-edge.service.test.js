/**
 * A teacher sends a storybook to the class, at the edge: /api/teacher/stories, /api/teacher/story/share and the page
 * /quiz/teacher/<th>/stories. The bot is the network boundary (a fake fetch). With the switch off the bot answers 404
 * and the page falls through to whatever answers that path today.
 */
const http = require('http');
const express = require('express');
const { createTeacherStoriesRouter } = require('../routes/teacher-stories.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TH = 'eyJrIjoidGgiLCJ1aWQiOiJ1MSJ9.AbCdEfGhIjKlMnOpQrStUv';
const BOOK = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function jsonRes(status, body, location = null) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : h.toLowerCase() === 'location' ? location : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}
const PAGE = '<!doctype html><html lang="en" dir="ltr"><body><main data-screen="teacher-stories">Book 1 Testwala</main></body></html>';
function htmlRes(status, html) {
  return { status, ok: status === 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    arrayBuffer: async () => Buffer.from(html), text: async () => html };
}
function start(app) { return new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); }); }
function req(srv, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const SHELF = { grade: 2, lang: 'en', ui: 'en', books: [{ id: BOOK, title: 'Book 1 Testwala', grade: 2, lang: 'en', dir: 'ltr', pages: 6, minutes: 2.5, cover: `/s/${BOOK}/cover-00000001.webp`, featured: true, first_page: null }] };

function bot(on = true) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (!on) return jsonRes(404, { error: 'stories_off' });
    if (url.includes('/api/internal/ts/stories')) return jsonRes(200, SHELF);
    if (url.endsWith('/api/internal/ts/share')) return jsonRes(200, { code: 'AB12CD', link: 'https://quiz.example.org/q/AB12CD', class_message: 'A story for you' });
    if (url.endsWith('/api/internal/ts/send')) return jsonRes(302, {}, 'https://wa.me/?text=A%20story%20for%20you');
    if (url.includes('/api/internal/ts/page/')) return htmlRes(200, PAGE);
    return jsonRes(404, { error: 'not_found' });
  };
  return { calls, fetchImpl };
}
function build(fetchImpl, { teacherOn = async () => true } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createTeacherStoriesRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, teacherOn }));
  app.use((r, res) => res.status(418).send('fell through'));
  return app;
}

let srv;
afterEach(() => new Promise((r) => (srv ? srv.close(r) : r())));

test('the shelf is forwarded with the token, grade, language and all — nothing else', async () => {
  const b = bot();
  srv = await start(build(b.fetchImpl));
  const out = await req(srv, 'GET', `/api/teacher/stories?th=${TH}&grade=2&lang=en&all=1&phone=x`);
  expect(out.status).toBe(200);
  expect(JSON.parse(out.body)).toEqual(SHELF);
  expect(out.headers['cache-control']).toBe('no-store');
  expect(b.calls[0].url).toBe(`${BOT}/api/internal/ts/stories?th=${TH}&grade=2&lang=en&all=1`);
  expect(b.calls[0].opts.headers['x-api-key']).toBe(KEY);
});

test('a malformed token never reaches the bot', async () => {
  const b = bot();
  srv = await start(build(b.fetchImpl));
  expect((await req(srv, 'GET', '/api/teacher/stories?th=nope')).status).toBe(401);
  expect((await req(srv, 'POST', '/api/teacher/story/share', { th: 'nope', story_id: BOOK })).status).toBe(401);
  expect((await req(srv, 'POST', '/api/teacher/story/share', { th: TH, story_id: 'x' })).status).toBe(400);
  expect(b.calls).toHaveLength(0);
});

test('share forwards {th, story_id, class} and answers the class message', async () => {
  const b = bot();
  srv = await start(build(b.fetchImpl));
  const out = await req(srv, 'POST', '/api/teacher/story/share', { th: TH, story_id: BOOK, extra: 'dropped' });
  expect(out.status).toBe(200);
  expect(JSON.parse(out.body)).toEqual({ code: 'AB12CD', link: 'https://quiz.example.org/q/AB12CD', class_message: 'A story for you' });
  expect(JSON.parse(b.calls[0].opts.body)).toEqual({ th: TH, story_id: BOOK });
});

test('the tap: the page\'s form post goes to the bot as {th, story_id}; its 302 to wa.me is passed through', async () => {
  const b = bot();
  srv = await start(build(b.fetchImpl));
  const form = `th=${encodeURIComponent(TH)}&story_id=${BOOK}&x=1`;
  const out = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'POST', path: '/api/teacher/story/send',
      headers: { host: 'quiz.example.org', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(form) } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject); r.write(form); r.end();
  });
  expect(out.status).toBe(302);
  expect(out.headers.location).toBe('https://wa.me/?text=A%20story%20for%20you');
  expect(b.calls[0].url).toBe(`${BOT}/api/internal/ts/send`);
  expect(JSON.parse(b.calls[0].opts.body)).toEqual({ th: TH, story_id: BOOK });
});

test('the page is the bot\'s HTML, forwarded with grade, language and book only', async () => {
  const b = bot();
  srv = await start(build(b.fetchImpl));
  const out = await req(srv, 'GET', `/quiz/teacher/${TH}/stories?grade=3&lang=ur&book=${BOOK}&x=1`);
  expect(out.status).toBe(200);
  expect(out.body).toBe(PAGE);
  expect(b.calls[0].url).toBe(`${BOT}/api/internal/ts/page/${TH}?grade=3&lang=ur&book=${BOOK}`);
  expect(out.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(out.headers['cache-control']).toBe('no-store');
});

test('switch off at the edge: the bot is never asked; the API and the page answer exactly as the bot\'s 404 does (golden)', async () => {
  const viaBot = bot(false);
  srv = await start(build(viaBot.fetchImpl));
  const want = [await req(srv, 'GET', `/api/teacher/stories?th=${TH}`), await req(srv, 'POST', '/api/teacher/story/share', { th: TH, story_id: BOOK }),
    await req(srv, 'GET', `/quiz/teacher/${TH}/stories`)];
  await new Promise((r) => srv.close(r));
  for (const off of [async () => false, async () => { throw new Error('down'); }]) {
    const b = bot(true);
    srv = await start(build(b.fetchImpl, { teacherOn: off }));
    const got = [await req(srv, 'GET', `/api/teacher/stories?th=${TH}`), await req(srv, 'POST', '/api/teacher/story/share', { th: TH, story_id: BOOK }),
      await req(srv, 'GET', `/quiz/teacher/${TH}/stories`)];
    expect(b.calls).toHaveLength(0);
    got.forEach((g, i) => { expect(g.status).toBe(want[i].status); expect(g.body).toBe(want[i].body); });
    expect(got[2].body).toBe('fell through');
    await new Promise((r) => srv.close(r));
  }
  srv = null;
});
test('the edge reads web_quiz_stories_teacher at most every 30 s, through the portal\'s flag rule', async () => {
  const { teacherFlagReader } = require('../routes/teacher-stories.routes');
  let t = 0;
  const reads = [];
  const fakeDb = { from: () => ({ select: () => ({ eq: (k, v) => { reads.push(v); return { maybeSingle: async () => ({ data: { value: true }, error: null }) }; } }) }) };
  const on = teacherFlagReader({ now: () => t, db: () => fakeDb });
  expect(await on()).toBe(true);
  t = 29999;
  expect(await on()).toBe(true);
  expect(reads).toEqual(['web_quiz_stories_teacher']);
  t = 30000;
  await on();
  expect(reads).toHaveLength(2);
  const broken = teacherFlagReader({ now: () => 0, db: () => { throw new Error('no client'); } });
  expect(await broken()).toBe(false);
});

test('switch off (the bot\'s 404): the API says so and the page falls through untouched (golden)', async () => {
  const b = bot(false);
  srv = await start(build(b.fetchImpl));
  const api = await req(srv, 'GET', `/api/teacher/stories?th=${TH}`);
  expect(api.status).toBe(404);
  expect(JSON.parse(api.body)).toEqual({ error: 'stories_off' });
  const page = await req(srv, 'GET', `/quiz/teacher/${TH}/stories`);
  expect(page.status).toBe(418);
  expect(page.body).toBe('fell through');
});


describe('the class link of a story send, as WhatsApp previews it', () => {
  const { renderQuizPage } = require('../routes/web-quiz.routes');
  const { ogFacts } = require('../routes/web-quiz-preview');
  const STORY = { quiz: { id: 'q-1', code: 'AB12CD', topic: 'Book 1 Testwala', lang: 'en', dir: 'ltr', n: 0, questions: [] },
    cls: { label: 'Class 2', teacher: 'Teacher', chips: [] }, live: {}, video: null, preview: false,
    story: { id: BOOK, from_teacher: true, code: 'AB12CD' } };
  test('a story, never "0 questions"', () => {
    const html = renderQuizPage({ payload: STORY, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    expect(html).toContain('Book 1 Testwala · a story for Class 2');
    expect(html).toContain('Listen and read along with Jugnu');
    expect(html).not.toContain('0 questions');
  });
  test('the remembered preview facts carry it; a quiz\'s facts are as before (golden: no story key)', () => {
    expect(ogFacts(STORY).story).toBe(true);
    const { story, ...quizOnly } = STORY;
    expect(Object.keys(ogFacts(quizOnly))).toEqual(['quiz', 'cls', 'challenge', 'art', 'brand', 'invited']);
  });
  // WhatsApp's preview fetch is answered from the bot's kept facts (GET /og/:code), not from a page render.
  const { renderPreviewPage } = require('../routes/web-quiz.routes');
  const BotOg = require('../../bot/shared/services/quiz/web-quiz-og');
  const ogMeta = (html, prop) => ((html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`)) || [])[1] || '').replace(/&amp;/g, '&');
  test('the preview fetch, answered from the bot\'s kept facts, reads as a story too (never "Class quiz", never "0 questions")', () => {
    const html = renderPreviewPage({ facts: BotOg.facts(STORY), code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(html, 'og:title')).toBe('Book 1 Testwala · a story for Class 2');
    expect(ogMeta(html, 'og:description')).toBe('Listen and read along with Jugnu');
  });
  const TEACH = 't.MzMzMzMzMzNDM0MzMzMzMw.abcdefghijkl';
  const ART = { class: 'l.AB12CD.v1bw_tRX32tq', teach: TEACH, teach_v: '0a1b2c3d' };
  test('a story\'s reminder link (?v=<n>) keeps the story picture, never the quiz scoreboard (played / class average / top score)', () => {
    const html = renderQuizPage({ payload: { ...STORY, art: ART }, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1', v: '5' });
    expect(ogMeta(html, 'og:image')).toBe(`https://x/q/AB12CD/art/teach.png?a=${encodeURIComponent(TEACH)}&v=0a1b2c3d`);
  });
  test('a quiz\'s reminder link keeps its live class picture, as before', () => {
    const { story, ...quiz } = STORY;
    const html = renderQuizPage({ payload: { ...quiz, art: ART }, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1', v: '5' });
    expect(ogMeta(html, 'og:image')).toBe('https://x/q/AB12CD/art/class.jpg?a=l.AB12CD.v1bw_tRX32tq&v=5');
  });
  test('a story with no class label reads "a story for your class" in English (the Urdu line is unchanged)', () => {
    const noLabel = { ...STORY, cls: { ...STORY.cls, label: null } };
    expect(renderQuizPage({ payload: noLabel, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' })).toContain('Book 1 Testwala · a story for your class');
    const ur = { ...noLabel, quiz: { ...noLabel.quiz, lang: 'ur', dir: 'rtl' } };
    expect(renderQuizPage({ payload: ur, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' })).toContain('Book 1 Testwala · جماعت کے لیے کہانی');
  });
  // A story code opened on its class view (/q/<code>/class): a story has no league table and no scoreboard.
  test('a story\'s /class link previews as the story (title, words, picture), never a "league table" or the scoreboard picture', () => {
    const html = renderQuizPage({ payload: { ...STORY, art: ART }, code: 'AB12CD', view: 'class', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(html, 'og:title')).toBe('Book 1 Testwala · a story for Class 2');
    expect(ogMeta(html, 'og:description')).toBe('Listen and read along with Jugnu');
    expect(ogMeta(html, 'og:image')).toBe(`https://x/q/AB12CD/art/teach.png?a=${encodeURIComponent(TEACH)}&v=0a1b2c3d`);
    expect(html).not.toMatch(/league table|art\/class\.jpg/);
    const pre = renderPreviewPage({ facts: BotOg.facts({ ...STORY, art: ART }), code: 'AB12CD', view: 'class', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(pre, 'og:title')).toBe('Book 1 Testwala · a story for Class 2');
    expect(pre).not.toMatch(/league table|art\/class\.jpg/);
    // no class link picture (its switch off): the brand's picture, still never the scoreboard
    const bare = renderQuizPage({ payload: { ...STORY, art: { class: ART.class } }, code: 'AB12CD', view: 'class', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(bare, 'og:image')).not.toMatch(/art\/class\.jpg/);
  });
  test('a story\'s /class link in Urdu (the finish card\'s Urdu digits on): the story\'s own line, never the class table\'s', () => {
    const ur = { ...STORY, quiz: { ...STORY.quiz, lang: 'ur', dir: 'rtl' }, card_v3: true, art: ART };
    const html = renderQuizPage({ payload: ur, code: 'AB12CD', view: 'class', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(html, 'og:title')).toBe('Book ۱ Testwala · Class ۲ کے لیے کہانی');
    expect(ogMeta(html, 'og:description')).toBe('جگنو کے ساتھ سنیں اور پڑھیں');
    expect(html).not.toMatch(/لیگ ٹیبل|کھیلنا باقی ہے/);
  });
  test('a quiz\'s /class link is as before: the league table and its class picture', () => {
    const { story, ...quiz } = STORY;
    const html = renderQuizPage({ payload: { ...quiz, art: ART }, code: 'AB12CD', view: 'class', origin: 'https://x', assetV: 'v1' });
    expect(ogMeta(html, 'og:title')).toBe('Book 1 Testwala · Class 2 league table');
    expect(ogMeta(html, 'og:image')).toBe('https://x/q/AB12CD/art/class.jpg?a=l.AB12CD.v1bw_tRX32tq');
  });
});
