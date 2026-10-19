/**
 * The Challenge from a two-child hub link: /c/<hub token>?kid=<chip> opened with no tap this visit (a fresh phone,
 * no cookies) is answered 400 pick_kid by the bot. The note keeps its words and carries the Home link to the hub of
 * the same token, where the child picks: never a dead end, and never a second bot call.
 * The bot is the faked boundary. fixtures/challenge-note-golden.json was rendered by the base's challengePage.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const GOLDEN = require('./fixtures/challenge-note-golden.json');

const BOT = 'http://bot.test';
const TOKEN = `${'a'.repeat(40)}.${'b'.repeat(22)}`;
const KID = '0123456789abcdef';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function server(answer) {
  const calls = [];
  const app = express();
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url, init); } }));
  return new Promise((r) => { const srv = app.listen(0, () => r({ srv, calls })); });
}
// A fresh profile: no cookie header at all.
function get(srv, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
      let out = ''; res.on('data', (c) => { out += c; }); res.on('end', () => resolve({ status: res.statusCode, body: out }));
    }).on('error', reject);
  });
}
// Asset versions are file hashes and the port is the test server's; the golden compares everything else byte for byte.
const norm = (html) => html.replace(/\?v=[0-9a-f]+/g, '?v=V').replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://edge');
const route = (c) => c.url.replace(BOT, '');

test('a two-child token on /c/ with ?kid and no tap (fresh profile): ONE bot call, the note WITH the Home link to the hub', async () => {
  const { srv, calls } = await server(() => jsonRes(400, { error: 'pick_kid' }));
  try {
    const r = await get(srv, `/c/${TOKEN}?kid=${KID}&lang=en`);
    expect(calls.map(route)).toEqual([`/api/internal/wq/ch/${TOKEN}?kid=${KID}&lang=en`]);
    expect(calls[0].init.headers['x-wq-device']).toBeUndefined();
    expect(r.status).toBe(400);
    expect(r.body).toContain('Open the challenge from your quiz page.');
    expect(r.body).toContain(`<a class="wq-home" href="/h/${TOKEN}"><span aria-hidden="true">🏠</span><span class="wq-homet">Home</span></a>`);
  } finally { srv.close(); }
});

test('a pick_kid with no kid in the request, Urdu: ONE bot call, the note WITH the hub link in Urdu', async () => {
  const { srv, calls } = await server(() => jsonRes(400, { error: 'pick_kid' }));
  try {
    const r = await get(srv, `/c/${TOKEN}?lang=ur`);
    expect(calls).toHaveLength(1);
    expect(r.status).toBe(400);
    expect(r.body).toContain('چیلنج اپنے کوئز کے صفحے سے کھولیں۔');
    expect(r.body).toContain(`<a class="wq-home" href="/h/${TOKEN}"><span aria-hidden="true">🏠</span><span class="wq-homet">ہوم</span></a>`);
  } finally { srv.close(); }
});

test('a token that is not a hub token (a quiz session token while testing) gets the note without a link', async () => {
  const short = `${'s'.repeat(10)}.${'b'.repeat(22)}`;
  const { srv } = await server(() => jsonRes(400, { error: 'pick_kid' }));
  try {
    const r = await get(srv, `/c/${short}`);
    expect(r.body).toContain('Open the challenge from your quiz page.');
    expect(r.body).not.toContain('href="/h/');
  } finally { srv.close(); }
});

describe('golden: the untouched paths are byte-identical to the base', () => {
  for (const why of ['not_eligible', 'other_device']) {
    for (const lang of ['en', 'ur']) {
      test(`${why} note (${lang}), one bot call`, async () => {
        const { srv, calls } = await server(() => jsonRes(403, { error: why }));
        try {
          const r = await get(srv, `/c/${TOKEN}?kid=${KID}&lang=${lang}`);
          expect(calls).toHaveLength(1);
          expect(r.status).toBe(403);
          expect(norm(r.body)).toBe(GOLDEN[`${why}_${lang}`]);
        } finally { srv.close(); }
      });
    }
  }
  test('a 200 first answer is today\'s page exactly, one bot call', async () => {
    const MENU = { lang: 'en', form: 'G3', exercises: [{ id: 'bigger', name: 'Which is bigger?', mins: 2, done: false, last: null }] };
    const { srv, calls } = await server(() => jsonRes(200, MENU));
    try {
      const r = await get(srv, `/c/${TOKEN}?kid=${KID}&lang=en`);
      expect(calls).toHaveLength(1);
      expect(r.status).toBe(200);
      expect(norm(r.body)).toBe(GOLDEN.menu_200);
    } finally { srv.close(); }
  });
});
