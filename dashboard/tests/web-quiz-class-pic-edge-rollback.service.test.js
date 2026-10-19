/**
 * The class link's picture at the edge, switched ON then OFF: how long the edge keeps naming and serving it.
 *
 * The bot stops naming the class picture (art.teach) the moment its switch goes off; the edge must not keep handing
 * out the old picture, or a preview head naming it, for longer than it keeps the live class picture (120 s). And the
 * edge's picture memo is per class code: two classes never share a kept picture. The clock is injected (opts.now);
 * the bot is the network boundary (a fake fetch).
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const WA = 'WhatsApp/2.24.20.89 A';
const TEACH = 't.MzMzMzMzMzNDM0MzMzMzMw.abcdefghijkl';

function jsonRes(status, body) {
  return { status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
const pngOf = (b) => Buffer.from([0x89, 0x50, 0x4e, 0x47, b]);
function pngRes(bytes) {
  return { status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => bytes, text: async () => '' };
}
const base = (code = 'AB12CD') => ({
  quiz: { id: 'q', code, topic: 'Parts of a plant', lang: 'en', dir: 'ltr', n: 2, questions: [] },
  cls: { label: null, teacher: 'Teacher', chips: [] }, live: {}, video: null, preview: false, brand: 'niete',
  art: { class: `l.${code}.v1bw_tRX32tq`, schools: `s.${code}.WmWs-ZvGRyS-`, invite: null },
});
const withTeach = (p) => ({ ...p, art: { ...p.art, teach: TEACH, teach_v: '0a1b2c3d' } });

function req(srv, p, { ua = WA, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers: { host: 'portal.example', 'user-agent': ua, 'x-forwarded-proto': 'https' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}
const meta = (html, p) => ((new RegExp(`<meta property="og:${p}" content="([^"]*)"`).exec(String(html)) || [])[1] || '').replace(/&amp;/g, '&') || undefined;

let srv; let answer; let calls; let clock;
async function boot(on) {
  calls = [];
  clock = 1800000000000;
  answer = on;
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: KEY, logEvent: () => {}, now: () => clock, fetchImpl: async (url) => { calls.push(url); return answer(url); }, canonicalBase: '' }));
  await new Promise((r) => { srv = app.listen(0, r); });
}
afterEach(() => (srv ? new Promise((r) => srv.close(r)) : null));

const ON = (url) => (url.indexOf('/art/') >= 0 ? pngRes(pngOf(1)) : jsonRes(200, withTeach(base())));
// the switch off: the bot names no class picture and refuses to draw one
const OFF = (url) => (url.indexOf('/art/') >= 0 ? jsonRes(404, { error: 'not_found' }) : jsonRes(200, base()));
const PIC = `/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`;

describe('the class picture switched on, then off: the edge lets go within the class picture\'s 120 s', () => {
  test('after 120 s+ off, the picture is no longer served from the edge\'s keep, and the preview head no longer names it', async () => {
    await boot(ON);
    // on: a preview fetch names the class picture, and its fetch warms the edge's keep
    expect(meta((await req(srv, '/q/AB12CD')).body, 'image')).toMatch(/\/art\/teach\.png\?a=t\./);
    expect((await req(srv, PIC)).status).toBe(200);
    // the switch goes off
    answer = OFF;
    clock += 60000;
    // within the class picture's keep the edge may still hand it out (as it does the live class picture)
    expect((await req(srv, PIC)).status).toBe(200);
    clock += 61000; // 121 s after it was kept
    const n = calls.length;
    const after = await req(srv, PIC);
    expect(after.status).toBe(404);
    expect(calls.length).toBe(n + 1);
    expect(calls[n]).toBe(`${BOT}/api/internal/wq/art/${TEACH}?c=AB12CD`);
    // the preview head: the edge's memo of the code's facts named the class picture; it is asked again
    expect(meta((await req(srv, '/q/AB12CD')).body, 'image')).not.toMatch(/teach/);
  });

  test('facts naming no class picture keep today\'s hour at the edge (a preview fetch at 121 s never asks the bot)', async () => {
    await boot(OFF);
    await req(srv, '/q/AB12CD', { ua: 'Mozilla/5.0 (Linux; Android 13) Chrome/129.0 Mobile Safari/537.36' });
    const n = calls.length;
    clock += 121000;
    expect(meta((await req(srv, '/q/AB12CD')).body, 'image')).not.toMatch(/teach/);
    expect(calls.length).toBe(n);
    clock += 3600000;
    await req(srv, '/q/AB12CD');
    expect(calls.length).toBe(n + 1);
  });
});

describe('the edge\'s class picture keep is per class code', () => {
  test('two class codes with the same picture id and version never share a kept picture (GET or HEAD)', async () => {
    await boot((url) => (url.indexOf('/art/') >= 0 ? pngRes(pngOf(/c=EF34GH/.test(url) ? 2 : 1)) : jsonRes(200, withTeach(base()))));
    const a = await req(srv, `/q/AB12CD/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
    const headB = await req(srv, `/q/EF34GH/art/teach.png?a=${TEACH}&v=0a1b2c3d`, { method: 'HEAD' });
    const b = await req(srv, `/q/EF34GH/art/teach.png?a=${TEACH}&v=0a1b2c3d`);
    expect(a.status).toBe(200);
    expect(headB.status).toBe(200);
    expect(Buffer.compare(a.body, pngOf(1))).toBe(0);
    expect(Buffer.compare(b.body, pngOf(2))).toBe(0);
    // each code was asked of the bot under its own code; the second code's GET came from its own keep
    expect(calls).toEqual([`${BOT}/api/internal/wq/art/${TEACH}?c=AB12CD`, `${BOT}/api/internal/wq/art/${TEACH}?c=EF34GH`]);
    // a lower-case code is the same code (the bot's codes are upper case)
    expect(Buffer.compare((await req(srv, `/q/ef34gh/art/teach.png?a=${TEACH}&v=0a1b2c3d`)).body, pngOf(2))).toBe(0);
    expect(calls).toHaveLength(2);
  });
});
