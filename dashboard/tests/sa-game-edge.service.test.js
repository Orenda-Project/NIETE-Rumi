/**
 * The big flight's edge (routes/sa-game.routes.js; switch sa_game, decided by the BOT for the page and by the edge's own
 * 30 s read for the files). Off — the bot's 404, no bot, a junk token or chip, the switch read off — every route calls
 * next() and the portal answers as today. On: the page shell with the boot (token, chip, language, form, the battery
 * URL, the engine's files), its own files from an allow-list, the battery for a well-formed form only. Invented values.
 */
const http = require('http');
const express = require('express');
const { createSaGameRouter, renderGamePage } = require('../routes/sa-game.routes');

const TOKEN = 'eyJpZHMiOlsia2lkLTEiXX0.abcdefghijklmnopqrstuv';
const CHIP = '0123456789abcdef';

function start({ bot, on = () => true, botUrl = 'http://bot.test', apiKey = 'k' }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = bot(url);
    return { status: r.status, headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(r.body || {}) };
  };
  const app = express();
  app.use(createSaGameRouter({ botUrl, apiKey, fetchImpl, on, logEvent: () => {} }));
  app.use((req, res) => res.status(404).send('portal'));
  const server = http.createServer(app);
  return new Promise((r) => server.listen(0, () => r({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}

let s;
afterEach(() => new Promise((r) => (s ? s.server.close(r) : r())));

test('switch off at the bot: the portal answers (falls through)', async () => {
  s = await start({ bot: () => ({ status: 404, body: { off: true } }) });
  const r = await fetch(`${s.base}/sa-game/${TOKEN}?kid=${CHIP}`);
  expect(r.status).toBe(404);
  expect(await r.text()).toBe('portal');
  expect(s.calls[0].url).toBe(`http://bot.test/api/internal/sagame/page/${TOKEN}?kid=${CHIP}`);
});

test('a junk token or chip, or no bot configured: falls through, no bot call', async () => {
  s = await start({ bot: () => ({ status: 200, body: { ok: true } }) });
  expect(await (await fetch(`${s.base}/sa-game/not-a-token?kid=${CHIP}`)).text()).toBe('portal');
  expect(await (await fetch(`${s.base}/sa-game/${TOKEN}?kid=XYZ`)).text()).toBe('portal');
  expect(s.calls).toHaveLength(0);
  s.server.close();
  s = await start({ bot: () => ({ status: 200 }), botUrl: '' });
  expect(await (await fetch(`${s.base}/sa-game/${TOKEN}?kid=${CHIP}`)).text()).toBe('portal');
});

test('on, a child: the shell with the boot; Urdu is rtl', async () => {
  s = await start({ bot: () => ({ status: 200, body: { ok: true, lang: 'ur', grade: '3', form: 'game.G23' } }) });
  const r = await fetch(`${s.base}/sa-game/${TOKEN}?kid=${CHIP}&lang=ur`);
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  const html = await r.text();
  expect(html).toContain('<html lang="ur" dir="rtl">');
  expect(html).toContain('"form":"game.G23"');
  expect(html).toContain('"bank":["/sa/batteries/sa.game.G23.ur.json","/sa-game/b/game.G23/ur"]');
  expect(html).toContain('"engine":["/sa/sa-store.js"]');
  expect(html).toMatch(/\/sa-game\/a\/game\.js\?v=[0-9a-f]{10}/);
  expect(s.calls[0].url).toContain('&lang=ur');
  expect(s.calls[0].init.headers['x-api-key']).toBe('k');
});

test('on, not this phone: the note (403), a bot failure: the error note (502), never a 500', async () => {
  s = await start({ bot: () => ({ status: 401, body: { error: 'not_child' } }) });
  const r = await fetch(`${s.base}/sa-game/${TOKEN}?kid=${CHIP}&lang=en`);
  expect(r.status).toBe(403);
  expect(await r.text()).toContain('Open the big flight from your games');
  s.server.close();
  s = await start({ bot: () => ({ status: 200, body: { ok: true, lang: 'en', form: '../../etc' } }) });
  expect((await fetch(`${s.base}/sa-game/${TOKEN}?kid=${CHIP}`)).status).toBe(502);
});

test('files: the allow-list only, and only while the switch is on', async () => {
  let on = true;
  s = await start({ bot: () => ({ status: 404 }), on: () => on });
  const css = await fetch(`${s.base}/sa-game/a/game.css?v=1`);
  expect(css.status).toBe(200);
  expect(css.headers.get('content-type')).toMatch(/text\/css/);
  expect(await (await fetch(`${s.base}/sa-game/a/..%2Froutes%2Fsa-game.routes.js`)).text()).toBe('portal');
  expect(await (await fetch(`${s.base}/sa-game/a/other.js`)).text()).toBe('portal');
  on = false;
  expect(await (await fetch(`${s.base}/sa-game/a/game.css`)).text()).toBe('portal');
});

test('battery: a well-formed form and language only', async () => {
  s = await start({ bot: () => ({ status: 404 }), on: () => true });
  expect(await (await fetch(`${s.base}/sa-game/b/coach.G3/en`)).text()).toBe('portal');
  expect(await (await fetch(`${s.base}/sa-game/b/game.G23/fr`)).text()).toBe('portal');
});

test('the page holds no name, phone or student id', () => {
  const html = renderGamePage({ token: TOKEN, kid: CHIP, lang: 'en', form: 'game.G1', grade: '1' });
  expect(html).not.toMatch(/student|phone|first_name/i);
  expect(html).toContain('<html lang="en" dir="ltr">');
});
