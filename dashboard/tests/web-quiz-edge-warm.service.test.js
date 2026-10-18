/**
 * The portal's retry on a failed child page (app_settings web_quiz_edge_warm, learned through the one learner's answer:
 * GET /api/internal/wq/edge, lib/edge-learn.js, as `edge_warm: true`).
 *   - On, a streamed page (home or quiz) whose bot answer failed (unreachable, timed out, or a 5xx other than the
 *     switch-off 503) asks again itself, keeping its early frame, twice (r=1, r=2); then today's way (the plain page).
 *     An expired link (401) and a switched-off hub (503) are today's.
 *   - Off (the field absent, or the learner off): today's way.
 *   - One learner: the switch arrives through the learner's one apply(); there is no second route and no second
 *     writer of the learned switches.
 * The bot is stood in.
 */
const http = require('http');
const express = require('express');
const EdgeLearn = require('../lib/edge-learn');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUBANS = { lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Zara Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef', teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, fast: true };
const jsonRes = (status, body) => ({ status, ok: status < 400, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const get = (srv, p) => new Promise((res, rej) => {
  http.get({ port: srv.address().port, path: p, headers: { 'accept-language': 'en' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej);
});
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
// the early page: its head went out before the bot answered, with the hub's scripts preloaded (renderHubFlushTop)
const EARLY = '<link rel="preload" href="/wq/hub.js';
const timers = () => ({ set: () => ({ unref() {} }), clear() {} });

async function serve({ edge, hub = () => jsonRes(200, HUBANS) } = {}, fn) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url).replace(/^http:\/\/bot\.test/, ''));
    if (/\/api\/internal\/wq\/edge$/.test(url)) return jsonRes(200, edge);
    return hub(url);
  };
  const app = express();
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent: () => {}, edgeLearn: { timers: timers() } }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await settle(); return await fn(srv, calls); } finally { await new Promise((r) => srv.close(r)); }
}
const ON = { learn: true, fast: true, brand: 'niete', rt: false, edge_warm: true };
const OFF = { learn: true, fast: true, brand: 'niete', rt: false };

describe('on: a failed bot answer asks again, keeping the early frame', () => {
  const asksAgain = (page) => {
    expect(page.status).toBe(200);
    expect(page.body).toContain(EARLY);
    expect(page.body).toContain(`location.replace("/h/${TOKEN}?kid=0123456789abcdef&r=1"+location.hash)`);
    expect(page.body).not.toContain('nf=1');
    expect(page.body).not.toContain('not open');
  };
  test('unreachable or timed out: again with r=1', async () => {
    await serve({ edge: ON, hub: async () => { throw new Error('timeout'); } }, async (srv) => asksAgain(await get(srv, `/h/${TOKEN}?kid=0123456789abcdef`)));
  });
  test.each([500, 502, 504])('a %s: again with r=1', async (st) => {
    await serve({ edge: ON, hub: async () => jsonRes(st, { error: 'x' }) }, async (srv) => asksAgain(await get(srv, `/h/${TOKEN}?kid=0123456789abcdef`)));
  });
  test('the next try keeps counting (r=1 → r=2)', async () => {
    await serve({ edge: ON, hub: async () => { throw new Error('timeout'); } }, async (srv) => {
      const page = await get(srv, `/h/${TOKEN}?r=1`);
      expect(page.body).toContain(`location.replace("/h/${TOKEN}?r=2"+location.hash)`);
    });
  });
  test('the third try (r=2) that fails again: today\'s way (the plain page asked for)', async () => {
    await serve({ edge: ON, hub: async () => { throw new Error('timeout'); } }, async (srv) => {
      const page = await get(srv, `/h/${TOKEN}?r=2`);
      expect(page.body).toContain('nf=1');
      expect(page.body).not.toContain('r=3');
    });
  });
  test.each([[401, 'an expired link'], [503, 'the hub switched off']])('a %s (%s): today\'s way, never asked again', async (st) => {
    await serve({ edge: ON, hub: async () => jsonRes(st, { error: 'x' }) }, async (srv) => {
      const page = await get(srv, `/h/${TOKEN}`);
      expect(page.body).toContain('nf=1');
      expect(page.body).not.toContain('r=1');
    });
  });
  test('the quiz page too: a timed-out quiz answer asks again with r=1', async () => {
    await serve({ edge: ON, hub: async () => { throw new Error('timeout'); } }, async (srv) => {
      const page = await get(srv, '/q/AB12CD');
      expect(page.body).toContain('location.replace("/q/AB12CD?r=1"+location.hash)');
    });
  });
});

describe('off: today\'s way', () => {
  test.each([['the field absent', OFF], ['the learner off', { learn: false }]])('%s: a failed answer on a streamed page is today\'s again()', async (_n, edge) => {
    let n = 0;
    await serve({ edge, hub: async () => ((n += 1) === 1 ? jsonRes(200, HUBANS) : Promise.reject(new Error('timeout'))) }, async (srv) => {
      await get(srv, `/h/${TOKEN}`); // a payload teaches the fast page, as today
      const page = await get(srv, `/h/${TOKEN}`);
      expect(page.body).toContain('nf=1');
      expect(page.body).not.toContain('r=1');
    });
  });
});

describe('one learner', () => {
  test('both on: one route asked (the learner\'s), one apply() per answer', async () => {
    const real = EdgeLearn.startEdgeLearn;
    let applies = 0;
    const spy = jest.spyOn(EdgeLearn, 'startEdgeLearn').mockImplementation((o) => real({ ...o, apply: (b) => { applies += 1; o.apply(b); } }));
    try {
      await serve({ edge: ON }, async (srv, calls) => {
        expect(spy).toHaveBeenCalledTimes(1);
        expect(applies).toBe(1);
        expect(calls).toEqual(['/api/internal/wq/edge']);
        expect((await get(srv, `/h/${TOKEN}`)).body).toContain(EARLY); // lastFast written by that one apply()
      });
    } finally { spy.mockRestore(); }
  });
});
