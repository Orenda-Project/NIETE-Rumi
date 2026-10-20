'use strict';
/**
 * bd-gzfdu9 (VIDREC): the tracked player behind the "watch this clip" link (SPEC §4.6, r-ab ab/EVENTS_SCHEMA.md §2).
 *   GET  /v/:token            the clip page; a `click` row (server side, ua_class, surface from the token, device);
 *                             crawlers get the page with no presigned media; bad → 404 page, expired → sign-in.
 *   POST /v/:token/e          the player's beacons: allow-listed events only, ≤ 50 per post, 204.
 *   GET  /v/thumb/:id.jpg     the module thumbnail.
 * Real Express over HTTP; the loader, presigner and event writer are injected.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const ENV = { ...process.env };
const REC = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';
const SESSION = '1a2b3c4d-1111-4222-8333-444455556666';
const ROW = {
  id: REC, user_id: USER, coaching_session_id: SESSION, status: 'shown', module_id: 63, seg_id: '63-s2', start_s: 95, end_s: 229,
  reason_en: 'At 12:40 you asked "What is a noun?" and moved on.', reason_ur: 'آپ نے 12:40 پر پوچھا۔',
};
const CLIP = {
  row: ROW,
  module: { module_id: 63, title: 'Questioning', language: 'ur', cpd_level: 1, video_url: 'https://acc.r2.cloudflarestorage.com/digital-coach-audio/v/63.mp4' },
  segment: { seg_id: '63-s2', title_en: 'Asking why-questions', title_ur: 'کیوں والے سوال', start_s: 95, end_s: 229 },
  language: 'en',
};

let emitted; let inserted; let presigned; let servers = [];
beforeEach(() => {
  jest.resetModules();
  emitted = []; inserted = []; presigned = [];
  jest.doMock('express-rate-limit', () => jest.fn(() => (_req, _res, next) => next()), { virtual: true });
  jest.doMock('../../dashboard/services/telemetry.service', () => ({ logEvent: (e, d) => emitted.push({ e, d }), flush() {}, isEnabled: () => true }));
  process.env = { ...ENV, INTERNAL_API_KEY: 'k1', SUPABASE_URL: 'https://abc.supabase.co', PORTAL_URL: 'https://portal.example.pk' };
});
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
afterAll(() => { process.env = ENV; });

async function app({ clip = CLIP, insertError = null, thumbsDir } = {}) {
  const a = express();
  a.use(require('../../dashboard/routes/video-reco.routes').createVideoRecoRouter({
    loadClip: async (r, u) => (r === REC && u === USER ? (typeof clip === 'function' ? clip() : clip) : null),
    presign: async (url) => { presigned.push(url); return `${url}?X-Amz-Signature=abc`; },
    insertEvent: async (row) => { inserted.push(row); return { error: typeof insertError === 'function' ? insertError(row) : insertError }; },
    thumbsDir,
  }));
  a.use((_q, res) => res.status(418).send('fell through'));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return srv;
}

function req(srv, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, method, headers }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}
const token = (surface = 'wa', ids = { recommendationId: REC, userId: USER }) => require('../../bot/shared/services/coaching/video-reco/link-token').signVideoLink({ ...ids, surface });
const IAB = 'Mozilla/5.0 (Linux; Android 13; SM-A135F; wv) AppleWebKit/537.36 Chrome/118 Mobile Safari/537.36 WhatsApp/2.24';
const BOT = 'WhatsApp/2.23.20.0 A';
const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

describe('GET /v/:token', () => {
  test('in-app tap: the player at the clip start, presigned media, a click row (in_app, wa, device), private headers', async () => {
    const srv = await app();
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Asking why-questions');
    expect(res.body).toMatch(/<video[^>]*id="v"[^>]*playsinline/);
    expect(res.body).toContain('X-Amz-Signature=abc#t=95');
    expect(res.body.replace(/[\u2066-\u2069]/g, '')).toContain('1:35 – 3:49');
    expect(res.body).toContain('At 12:40 you asked');
    expect(presigned).toEqual([CLIP.module.video_url]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ recommendation_id: REC, event: 'click', ua_class: 'in_app', surface: 'wa' });
    expect(inserted[0].device).toMatch(/^[0-9a-f]{16}$/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    expect(res.headers['set-cookie'].join(';')).toMatch(/vr_d=[0-9a-f]{32}; Max-Age=\d+; Path=\/v; .*HttpOnly.*SameSite=Lax/i);
  });

  // qa-e2e FAIL 20261020T200126: the catalogue's urls name bucket digital-coach-audio, sandbox's R2_BUCKET_NAME is
  // rumi-sandbox (same keys copied across), so the presigner could not find a key and the player got no video.
  test('a url in another bucket is presigned in R2_BUCKET_NAME at the same key', async () => {
    process.env.R2_BUCKET_NAME = 'rumi-sandbox';
    const srv = await app();
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(200);
    expect(presigned).toEqual(['https://acc.r2.cloudflarestorage.com/rumi-sandbox/v/63.mp4']);
  });

  test('a url already in R2_BUCKET_NAME (prod), or no bucket configured, is presigned byte-identical', async () => {
    for (const bucket of ['digital-coach-audio', undefined]) {
      presigned = [];
      if (bucket) process.env.R2_BUCKET_NAME = bucket; else delete process.env.R2_BUCKET_NAME;
      const srv = await app();
      const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
      expect(res.status).toBe(200);
      expect(presigned).toEqual([CLIP.module.video_url]);
    }
  });

  test('only an R2 path-style url\'s first segment is rewritten; other hosts pass through unchanged', async () => {
    process.env.R2_BUCKET_NAME = 'rumi-sandbox';
    const urls = ['https://pub-abc.r2.dev/digital-coach-audio/v/63.mp4', 'https://cdn.example.pk/digital-coach-audio/v/63.mp4'];
    for (const video_url of urls) {
      const srv = await app({ clip: { ...CLIP, module: { ...CLIP.module, video_url } } });
      await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    }
    expect(presigned).toEqual(urls);
  });

  test('the same device cookie gives the same device id; another browser a different one', async () => {
    const srv = await app();
    await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB, cookie: 'vr_d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB, cookie: 'vr_d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
    await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB, cookie: 'vr_d=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } });
    expect(inserted[0].device).toBe(inserted[1].device);
    expect(inserted[2].device).not.toBe(inserted[0].device);
  });

  test.each([[BOT], [FB], ['TelegramBot (like TwitterBot)'], ['Slackbot-LinkExpanding 1.0']])('crawler %p: the page with no presigned media, a click row marked crawler', async (ua) => {
    const srv = await app();
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': ua } });
    expect(res.status).toBe(200);
    expect(presigned).toEqual([]);
    expect(res.body).not.toContain('X-Amz-Signature');
    expect(inserted[0]).toMatchObject({ event: 'click', ua_class: 'crawler' });
  });

  test('a desktop browser is browser; the token\'s surface rides through (cr)', async () => {
    const srv = await app();
    await req(srv, 'GET', `/v/${token('cr')}`, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari/605' } });
    expect(inserted[0]).toMatchObject({ ua_class: 'browser', surface: 'cr' });
  });

  test('a repeat click (unique index) still serves the page', async () => {
    const srv = await app({ insertError: { code: '23505' } });
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(200);
  });

  test('the event store failing never blocks the page', async () => {
    const srv = await app({ insertError: () => { throw new Error('pool'); } });
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(200);
  });

  test('Urdu: right to left, the Urdu title and reason, Urdu words', async () => {
    const srv = await app({ clip: { ...CLIP, language: 'ur' } });
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.body).toMatch(/<html lang="ur" dir="rtl">/);
    expect(res.body).toContain('کیوں والے سوال');
    expect(res.body).toContain('یہ کلپ کیوں');
    expect(res.body).toContain('آپ نے 12:40 پر پوچھا۔');
    expect(res.body).toContain('\u20661:35 – 3:49\u2069'); // the clip range stays left to right inside Urdu
  });

  test('the back link opens the session\'s report (/cr) for the same teacher', async () => {
    const srv = await app();
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    const href = /href="(\/cr\/[^"]+)"/.exec(res.body)[1];
    const { verifyReportLink } = require('../../bot/shared/services/coaching/report-link-token');
    expect(verifyReportLink(href.slice(4))).toEqual({ ok: true, sessionId: SESSION, userId: USER });
  });

  test('WebView-safe: no navigator.share, no speechSynthesis; sendBeacon with a fetch fallback', async () => {
    const srv = await app();
    const { body } = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(body).not.toMatch(/navigator\.share|speechSynthesis/);
    expect(body).toContain('navigator.sendBeacon');
    expect(body).toMatch(/fetch\([^)]*keepalive/);
  });

  test('a bad token → 404 page, nothing loaded or written; a /cr token is a bad token here', async () => {
    const srv = await app();
    const cr = require('../../bot/shared/services/coaching/report-link-token').signReportLink({ sessionId: SESSION, userId: USER });
    for (const t of ['nope', cr]) {
      const res = await req(srv, 'GET', `/v/${t}`, { headers: { 'user-agent': IAB } });
      expect(res.status).toBe(404);
    }
    expect(inserted).toEqual([]);
  });

  test('expired → the portal sign-in', async () => {
    const srv = await app();
    const t = token();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'setTimeout', 'nextTick'] }).setSystemTime(Date.now() + 121 * 86400000);
    try {
      const res = await req(srv, 'GET', `/v/${t}`, { headers: { 'user-agent': IAB } });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/portal/login');
    } finally { jest.useRealTimers(); }
  });

  test('a row that is not this teacher\'s or not shown → 404', async () => {
    const srv = await app({ clip: null });
    const res = await req(srv, 'GET', `/v/${token()}`, { headers: { 'user-agent': IAB } });
    expect(res.status).toBe(404);
  });
});

describe('POST /v/:token/e', () => {
  const post = (srv, body, t = token()) => req(srv, 'POST', `/v/${t}/e`, { headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': IAB, cookie: 'vr_d=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, body: JSON.stringify(body) });

  test('allow-listed player events are stored with at_s, client_ts, surface, ua_class, device; 204', async () => {
    const srv = await app();
    const res = await post(srv, { events: [
      { event: 'open', at_s: null, client_ts: '2026-10-20T19:00:00.000Z' },
      { event: 'play', at_s: 95.2 }, { event: 't30', at_s: 126 }, { event: 'segment_start', at_s: 95.4 },
      { event: 'p50', at_s: 162 }, { event: 'p90', at_s: 216 }, { event: 'segment_end', at_s: 229 }, { event: 'ended', at_s: 300 }, { event: 'error', at_s: null },
    ] });
    expect(res.status).toBe(204);
    expect(inserted.map((r) => r.event)).toEqual(['open', 'play', 't30', 'segment_start', 'p50', 'p90', 'segment_end', 'ended', 'error']);
    expect(inserted[0]).toMatchObject({ recommendation_id: REC, surface: 'wa', ua_class: 'in_app', client_ts: '2026-10-20T19:00:00.000Z' });
    expect(inserted[1].at_s).toBe(95.2);
    expect(inserted[0].device).toMatch(/^[0-9a-f]{16}$/);
  });

  test('server-side and unknown names are dropped (click, delivered, read, send_failed, junk)', async () => {
    const srv = await app();
    await post(srv, { events: [{ event: 'click' }, { event: 'delivered' }, { event: 'read' }, { event: 'send_failed' }, { event: 'DROP TABLE' }, { event: 'play', at_s: 'x' }] });
    expect(inserted.map((r) => r.event)).toEqual(['play']);
    expect(inserted[0].at_s).toBeNull();
  });

  test('more than 50 events → only the first 50', async () => {
    const srv = await app();
    await post(srv, { events: Array.from({ length: 80 }, () => ({ event: 'error' })) });
    expect(inserted).toHaveLength(50);
  });

  test('junk body → 400; bad token → 404, nothing written', async () => {
    const srv = await app();
    expect((await req(srv, 'POST', `/v/${token()}/e`, { headers: { 'content-type': 'text/plain' }, body: '{nope' })).status).toBe(400);
    expect((await post(srv, { events: [{ event: 'play' }] }, 'bad')).status).toBe(404);
    expect(inserted).toEqual([]);
  });

  test('a duplicate first-only event (23505) is still 204', async () => {
    const srv = await app({ insertError: { code: '23505' } });
    expect((await post(srv, { events: [{ event: 'play' }] })).status).toBe(204);
  });
});

describe('GET /v/thumb/:id.jpg', () => {
  test('serves the module thumbnail with a 7-day cache; anything not a number is 404', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-thumbs-'));
    fs.writeFileSync(path.join(dir, '63.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const srv = await app({ thumbsDir: dir });
    const ok = await req(srv, 'GET', '/v/thumb/63.jpg');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/image\/jpeg/);
    expect(ok.headers['cache-control']).toMatch(/max-age=604800/);
    expect((await req(srv, 'GET', '/v/thumb/..%2F..%2Fsecret.jpg')).status).toBe(404);
    expect((await req(srv, 'GET', '/v/thumb/99.jpg')).status).toBe(404);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
