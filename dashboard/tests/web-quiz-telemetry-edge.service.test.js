/**
 * Web quiz edge, page-session telemetry (wq-tel.js; app_settings web_quiz_rich_telemetry, read by the bot).
 *
 * - every web quiz page (quiz, hub, library, challenge) loads /wq/wq-tel.js before its own script, and its boot
 *   JSON says whether to send (rt): the bot's payload for quiz/hub/challenge; the library page, which the edge
 *   draws without asking the bot, uses the last value the bot gave.
 * - /api/wq/e: 600 POSTs a minute per IP (a school behind one NAT), 30 a minute per page session (ps); a refused
 *   batch is logged (web_quiz.events_limited), never silent.
 * The real router runs on an ephemeral port; the bot is a fake fetch.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter, renderQuizPage, renderHubPage, renderLibPage, renderChallengePage } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.internal';
const KEY = 'k';
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const QUIZ = {
  quiz: { id: 'q-1', code: 'AB12CD', topic: 'Plants', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1, questions: [{ qid: 'x1', i: 1, text: 'Q?', options: [{ slot: 'A', text: 'a' }], correct_slot: 'A' }] },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] }, live: { class_today: 0 }, video: null, preview: false,
};
const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function req(srv, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function build(fetchImpl, extra = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, fetchImpl, ...extra }));
  return app;
}
const LIB = `/lib/abcdefghijklmnop.${'s'.repeat(22)}`;
const bootOf = (html) => JSON.parse(/<script id="boot" type="application\/json">([^]*?)<\/script>/.exec(html)[1]);
const scripts = (html) => [...html.matchAll(/<script src="\/wq\/([a-z-]+\.js)\?/g)].map((m) => m[1]);

describe('wq-tel.js is on every web quiz page, first', () => {
  test('quiz, hub, library and challenge pages load wq-tel.js before their own scripts', () => {
    const quiz = renderQuizPage({ payload: QUIZ, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' });
    const hub = renderHubPage({ payload: { kids: [], lang: 'en' }, token: 't', origin: 'https://x', assetV: 'v1' });
    const lib = renderLibPage({ hub: 't', kid: null, lang: 'en', origin: 'https://x', assetV: 'v1' });
    const ch = renderChallengePage({ menu: { lang: 'en', exercises: [] }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c1' });
    for (const html of [quiz, hub, lib, ch]) expect(scripts(html)[0]).toBe('wq-tel.js');
  });

  test("rt: the bot's value on quiz and hub boots; the menu's on the challenge boot; the library takes the flag it is given", () => {
    expect(bootOf(renderQuizPage({ payload: { ...QUIZ, rt: true }, code: 'AB12CD', view: 'quiz', origin: 'https://x', assetV: 'v1' })).rt).toBe(true);
    expect(bootOf(renderHubPage({ payload: { kids: [], lang: 'en', rt: true }, token: 't', origin: 'https://x', assetV: 'v1' })).rt).toBe(true);
    expect(bootOf(renderChallengePage({ menu: { lang: 'en', exercises: [], rt: true }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c1' })).rt).toBe(true);
    expect(bootOf(renderChallengePage({ menu: { lang: 'en', exercises: [] }, token: 't', kid: null, origin: 'https://x', assetV: 'v1', chV: 'c1' })).rt).toBe(false);
    expect(bootOf(renderLibPage({ hub: 't', kid: null, lang: 'en', origin: 'https://x', assetV: 'v1', rt: true })).rt).toBe(true);
    expect(bootOf(renderLibPage({ hub: 't', kid: null, lang: 'en', origin: 'https://x', assetV: 'v1' })).rt).toBe(false);
  });

  test('the library page, drawn without the bot, carries the rt the bot last gave on a quiz page', async () => {
    let rt = true;
    const srv = await start(build(async (url) => (url.indexOf('/quiz/') >= 0 ? jsonRes(200, { ...QUIZ, rt }) : jsonRes(404, {}))));
    const lib0 = await req(srv, 'GET', LIB);
    await req(srv, 'GET', '/q/AB12CD');
    const lib1 = await req(srv, 'GET', LIB);
    rt = false;
    await req(srv, 'GET', '/q/AB12CD');
    const lib2 = await req(srv, 'GET', LIB);
    await new Promise((r) => srv.close(r));
    expect([lib0, lib1, lib2].map((r) => bootOf(r.body).rt)).toEqual([false, true, false]);
  });
});

describe('/api/wq/e limits', () => {
  test('600 a minute per IP (a school behind one NAT): the 121st passes, the 601st is refused and logged', async () => {
    const logged = [];
    const srv = await start(build(async () => jsonRes(204, {}), { logEvent: (e, p) => logged.push([e, p]) }));
    const codes = [];
    for (let i = 0; i < 601; i += 1) codes.push((await req(srv, 'POST', '/api/wq/e', { events: [{ n: 'hb' }] })).status);
    await new Promise((r) => srv.close(r));
    expect(codes[120]).not.toBe(429);
    expect(codes.slice(0, 600).every((c) => c !== 429)).toBe(true);
    expect(codes[600]).toBe(429);
    expect(logged).toEqual([['web_quiz.events_limited', { n: 1, ip: 1, ps: 0 }]]);
  });

  test('30 a minute per page session: the 31st from one ps is refused and logged, another ps still passes', async () => {
    const logged = [];
    const srv = await start(build(async () => jsonRes(204, {}), { logEvent: (e, p) => logged.push([e, p]) }));
    const codes = [];
    for (let i = 0; i < 31; i += 1) codes.push((await req(srv, 'POST', '/api/wq/e', { ps: 'k2m9x0aa7bq1', events: [{ n: 'hb' }] })).status);
    const other = await req(srv, 'POST', '/api/wq/e', { ps: 'zz9x0aa7bq12', events: [{ n: 'hb' }] });
    await new Promise((r) => srv.close(r));
    expect(codes.slice(0, 30).every((c) => c !== 429)).toBe(true);
    expect(codes[30]).toBe(429);
    expect(other.status).not.toBe(429);
    expect(logged).toEqual([['web_quiz.events_limited', { n: 1, ip: 0, ps: 1 }]]);
  });
});
