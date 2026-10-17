/**
 * The Videos door's picture shelves at the edge and on the lesson page (app_settings web_quiz_video_shelf):
 *   - /wq/vt/<lesson id>.webp: the lesson's small thumbnail, asked of the bot once and kept at the edge; a bad id never
 *     reaches the bot; the bot's 404 (switch off, unknown lesson) is a 404 that no cache keeps;
 *   - the lesson page opened from a card's Quiz button (?to=q) starts at its questions, only when the payload says
 *     video_shelf; without it (switch off) the page plays the video first, as today.
 * The bot is the network boundary.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');
const { page } = require('./wq-page-harness');

const BOT = 'http://bot.test';
const VID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WEBP = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 tiny', 'binary');
const jsonRes = (status, body) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });
const webpRes = () => ({ status: 200, ok: true, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'image/webp' : null) }, arrayBuffer: async () => WEBP, text: async () => '' });

function req(srv, path) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', headers: { host: 'portal.example', 'x-forwarded-proto': 'https' }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv; let calls; let answer;
beforeEach(async () => {
  calls = [];
  answer = (url) => (/\/api\/internal\/wq\/vt\/[0-9a-f-]{36}\.webp$/.test(url) ? webpRes() : jsonRes(404, { error: 'not_found' }));
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', logEvent: () => {}, fetchImpl: async (url, init) => { calls.push({ url, init }); return answer(url); } }));
  await new Promise((r) => { srv = app.listen(0, r); });
});
afterEach(() => new Promise((r) => srv.close(r)));

describe('the thumbnail: /wq/vt/<lesson id>.webp', () => {
  test('WebP bytes with a year\'s immutable cache (the URL carries its version), asked of the bot once (the second phone is answered at the edge)', async () => {
    const a = await req(srv, `/wq/vt/${VID}.webp`);
    expect(a.status).toBe(200);
    expect(a.headers['content-type']).toBe('image/webp');
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.body.equals(WEBP)).toBe(true);
    const b = await req(srv, `/wq/vt/${VID}.webp`);
    expect(b.body.equals(WEBP)).toBe(true);
    expect(calls.filter((c) => c.url === `${BOT}/api/internal/wq/vt/${VID}.webp`)).toHaveLength(1);
  });
  test('the bot says no (switch off, unknown lesson): 404, never cached, asked again next time', async () => {
    answer = () => jsonRes(404, { error: 'not_found' });
    const a = await req(srv, `/wq/vt/${VID}.webp`);
    expect(a.status).toBe(404);
    expect(a.headers['cache-control']).toBe('no-store');
    await req(srv, `/wq/vt/${VID}.webp`);
    expect(calls).toHaveLength(2);
  });
  test('the bot fails or is slow (5xx): never kept, so a kept picture is never pushed out by it and the next phone asks again', async () => {
    answer = () => jsonRes(500, { error: 'server_error' });
    const a = await req(srv, `/wq/vt/${VID}.webp`);
    expect(a.status).toBe(502);
    expect(a.headers['cache-control']).toBe('no-store');
    await req(srv, `/wq/vt/${VID}.webp`);
    expect(calls).toHaveLength(2);
  });
  test('the bot says the lesson has no picture: a 404 kept 10 minutes at the edge (the bot is asked once) and by the phone', async () => {
    answer = () => jsonRes(404, { error: 'no_picture' });
    const a = await req(srv, `/wq/vt/${VID}.webp`);
    expect(a.status).toBe(404);
    expect(a.headers['cache-control']).toBe('public, max-age=600');
    const b = await req(srv, `/wq/vt/${VID}.webp`);
    expect(b.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
  test.each(['not-a-lesson', '../../etc', 'AAAAAAA1-aaaa-4aaa-8aaa-aaaaaaaaaaaa%2F..'])('a bad id (%s) never reaches the bot', async (bad) => {
    const a = await req(srv, `/wq/vt/${bad}.webp`);
    expect([403, 404]).toContain(a.status);
    expect(calls).toHaveLength(0);
  });
});

describe('the lesson page opened at its questions (?to=q)', () => {
  const video = { url: 'https://r2.example/v.mp4', poster: 'https://r2.example/p.jpg' };
  test.each(['en', 'ur'])('%s: with video_shelf the video is not played first', (lang) => {
    expect(page({ lang, video, search: '?k=kk&to=q', bootExtra: { video_shelf: true } }).wq.wantsVideo()).toBe(false);
  });
  test('switch off (no video_shelf), or no ?to=q: the video first, as today', () => {
    expect(page({ lang: 'en', video, search: '?k=kk&to=q' }).wq.wantsVideo()).toBe(true);
    expect(page({ lang: 'en', video, search: '?k=kk&via=videos', bootExtra: { video_shelf: true } }).wq.wantsVideo()).toBe(true);
    expect(page({ lang: 'en', video, search: '?k=kk&to=q', bootExtra: { video_shelf: 'true' } }).wq.wantsVideo()).toBe(true);
  });
});
