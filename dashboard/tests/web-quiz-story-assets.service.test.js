/**
 * GET /s/<book id>/<file>: a storybook's pictures and voices, from our own origin, kept for a year.
 *
 * Switch app_settings web_quiz_stories OFF (the default): the edge does not own the path at all — the request goes
 * on to whatever answers it today (the portal's catch-all), byte for byte, and storage is never asked.
 * ON: a file name outside ^[a-z0-9-]+\.(webp|ogg|mp3)$ or a book id that is not a uuid → 400; a file storage does not
 * have → 404 no-store; a hit → the bytes with Content-Type, Content-Length, an ETag (the name's hash),
 * Cache-Control public, max-age=31536000, immutable; If-None-Match → 304; a Range → 206; the second fetch of the
 * same file is answered from memory (storage asked once). Storage is the faked network boundary.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../routes/web-quiz.routes');

const BOOK = 'b0000000-0000-4000-8000-0000000000b1';
const FILE = 'p01-0a1b2c3d.webp';
const BYTES = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 asad-testwala-page-one');
const SPA = '<!doctype html><title>portal</title>';

function req(srv, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv; let on; let asked; let store;
async function start({ withRouter = true } = {}) {
  const app = express();
  app.set('trust proxy', true);
  if (withRouter) {
    app.use(createWebQuizRouter({
      botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async () => { throw new Error('the bot is never asked'); },
      storiesOn: async () => on,
      storyObject: async (key) => { asked.push(key); return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      storyEnv: 'sandbox',
    }));
  }
  // Today's portal after the web quiz router: the SPA catch-all (index.js), then the 404 page.
  app.get('*', (q, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(SPA); });
  await new Promise((r) => { srv = app.listen(0, r); });
}
beforeEach(() => { on = false; asked = []; store = { [`story/sandbox/${BOOK}/${FILE}`]: { bytes: BYTES, contentType: 'image/webp' } }; });
afterEach(() => new Promise((r) => srv.close(r)));

const strip = (h) => { const o = { ...h }; delete o.date; return o; };

describe('switch off', () => {
  test('a story path is answered exactly as today (the catch-all), and storage is never asked', async () => {
    await start({ withRouter: false });
    const today = await Promise.all([`/s/${BOOK}/${FILE}`, '/s/x/../../etc', `/s/${BOOK}/P01.PNG`].map((p) => req(srv, p)));
    await new Promise((r) => srv.close(r));
    await start();
    const now = await Promise.all([`/s/${BOOK}/${FILE}`, '/s/x/../../etc', `/s/${BOOK}/P01.PNG`].map((p) => req(srv, p)));
    now.forEach((n, i) => {
      expect(n.status).toBe(today[i].status);
      expect(n.body.equals(today[i].body)).toBe(true);
      expect(strip(n.headers)).toEqual(strip(today[i].headers));
    });
    expect(asked).toEqual([]);
  });
});

describe('switch off, every way the switch can read off', () => {
  test('a literal false, a throwing read and a non-boolean all fall through untouched', async () => {
    for (const read of [async () => false, async () => { throw new Error('db down'); }, async () => 'true']) {
      srv && srv.listening && await new Promise((r) => srv.close(r));
      const app = express();
      app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, storiesOn: read, storyEnv: 'sandbox',
        storyObject: async (key) => { asked.push(key); return null; } }));
      app.get('*', (q, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(SPA); });
      await new Promise((r) => { srv = app.listen(0, r); });
      const r = await req(srv, `/s/${BOOK}/${FILE}`);
      expect([r.status, r.body.toString(), r.headers['ratelimit-limit']]).toEqual([200, SPA, undefined]);
    }
    expect(asked).toEqual([]);
  });
});

describe('switch on', () => {
  beforeEach(async () => { on = true; await start(); });

  test('a hit: the bytes, their type and length, an ETag and a year of immutable cache', async () => {
    const r = await req(srv, `/s/${BOOK}/${FILE}`);
    expect(r.status).toBe(200);
    expect(r.body.equals(BYTES)).toBe(true);
    expect(r.headers['content-type']).toBe('image/webp');
    expect(r.headers['content-length']).toBe(String(BYTES.length));
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers.etag).toBe('"0a1b2c3d"');
    expect(r.headers['accept-ranges']).toBe('bytes');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(asked).toEqual([`story/sandbox/${BOOK}/${FILE}`]);
  });

  test('the second fetch is answered from memory; If-None-Match → 304 with no body', async () => {
    await req(srv, `/s/${BOOK}/${FILE}`);
    const again = await req(srv, `/s/${BOOK}/${FILE}`);
    expect(again.status).toBe(200);
    expect(again.body.equals(BYTES)).toBe(true);
    const cond = await req(srv, `/s/${BOOK}/${FILE}`, { headers: { 'if-none-match': '"0a1b2c3d"' } });
    expect(cond.status).toBe(304);
    expect(cond.body.length).toBe(0);
    expect(cond.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asked).toHaveLength(1);
  });

  test('a Range (how phones fetch audio) → 206 with that slice', async () => {
    store[`story/sandbox/${BOOK}/a01-0a1b2c3d.ogg`] = { bytes: Buffer.from('OggS0123456789'), contentType: 'audio/ogg' };
    const r = await req(srv, `/s/${BOOK}/a01-0a1b2c3d.ogg`, { headers: { range: 'bytes=4-7' } });
    expect(r.status).toBe(206);
    expect(r.body.toString()).toBe('0123');
    expect(r.headers['content-range']).toBe('bytes 4-7/14');
    expect(r.headers['content-type']).toBe('audio/ogg');
    const bad = await req(srv, `/s/${BOOK}/a01-0a1b2c3d.ogg`, { headers: { range: 'bytes=40-50' } });
    expect(bad.status).toBe(416);
    expect(bad.headers['content-range']).toBe('bytes */14');
  });

  test('a bad file name or book id → 400 no-store, storage never asked', async () => {
    for (const p of [`/s/${BOOK}/p01.png`, `/s/${BOOK}/P01-0A1B2C3D.webp`, `/s/${BOOK}/..%2Fsecret.webp`, `/s/${BOOK}/.webp`, `/s/not-a-uuid/${FILE}`, `/s/${BOOK.toUpperCase()}/${FILE}`]) {
      const r = await req(srv, p);
      expect([p, r.status]).toEqual([p, 400]);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(r.body)).toEqual({ error: 'bad_name' });
    }
    expect(asked).toEqual([]);
  });

  test('a file storage does not have → 404 no-store (never the catch-all page)', async () => {
    const r = await req(srv, `/s/${BOOK}/p02-0a1b2c3d.webp`);
    expect(r.status).toBe(404);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.body)).toEqual({ error: 'not_found' });
  });

  test('storage failing → 502 no-store, and the next fetch asks again', async () => {
    let fail = true;
    srv.close();
    const app = express();
    app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, storiesOn: async () => true, storyEnv: 'sandbox',
      storyObject: async () => { if (fail) throw new Error('r2 down'); return { bytes: BYTES, contentType: 'image/webp' }; } }));
    await new Promise((r) => { srv = app.listen(0, r); });
    const r1 = await req(srv, `/s/${BOOK}/${FILE}`);
    expect([r1.status, r1.headers['cache-control']]).toEqual([502, 'no-store']);
    fail = false;
    const r2 = await req(srv, `/s/${BOOK}/${FILE}`);
    expect(r2.status).toBe(200);
  });
});

describe('the memory keeps at most its byte budget, least recently used out first', () => {
  test('evicts the oldest when over budget; a get refreshes', () => {
    const { createByteLru } = require('../routes/web-quiz-story-assets');
    const lru = createByteLru(10);
    lru.set('a', { bytes: Buffer.alloc(4) });
    lru.set('b', { bytes: Buffer.alloc(4) });
    expect(lru.get('a')).toBeTruthy();
    lru.set('c', { bytes: Buffer.alloc(4) });
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBeTruthy();
    expect(lru.get('c')).toBeTruthy();
    expect(lru.size()).toBe(8);
    lru.set('big', { bytes: Buffer.alloc(11) });
    expect(lru.get('big')).toBeUndefined();
  });
});

describe('a phone that cannot play Ogg Opus (iOS before 18.4): the page voice as mp3 (app_settings web_quiz_story_mp3)', () => {
  const OGG = 'a01-0a1b2c3d.ogg';
  const MP3 = 'a01-0a1b2c3d.mp3';
  const OGG_BYTES = Buffer.from('OggS-fake-opus-page-voice');
  let mp3; let made;
  async function startMp3(transcode) {
    const app = express();
    app.use(createWebQuizRouter({
      botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async () => { throw new Error('the bot is never asked'); },
      storiesOn: async () => true, storyMp3On: async () => mp3, storyEnv: 'sandbox',
      storyObject: async (key) => { asked.push(key); return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      ...(transcode ? { storyTranscode: transcode } : {}),
    }));
    await new Promise((r) => { srv = app.listen(0, r); });
  }
  beforeEach(() => { mp3 = true; made = 0; store[`story/sandbox/${BOOK}/${OGG}`] = { bytes: OGG_BYTES, contentType: 'audio/ogg' }; });
  const fakeTranscode = async (bytes) => { made += 1; return Buffer.concat([Buffer.from('ID3'), bytes]); };

  test('on: the .mp3 of a stored .ogg is made from it once, served as audio/mpeg, immutable, by range too', async () => {
    await startMp3(fakeTranscode);
    const r = await req(srv, `/s/${BOOK}/${MP3}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('audio/mpeg');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers.etag).toBe('"0a1b2c3d"');
    expect(r.body.equals(Buffer.concat([Buffer.from('ID3'), OGG_BYTES]))).toBe(true);
    const part = await req(srv, `/s/${BOOK}/${MP3}`, { headers: { range: 'bytes=0-2' } });
    expect([part.status, part.body.toString()]).toEqual([206, 'ID3']);
    expect(made).toBe(1);
    expect(asked).toEqual([`story/sandbox/${BOOK}/${MP3}`, `story/sandbox/${BOOK}/${OGG}`]);
  });
  test('on: a stored .mp3 is served as it is (never made again); no .ogg either → 404', async () => {
    store[`story/sandbox/${BOOK}/${MP3}`] = { bytes: Buffer.from('ID3-stored'), contentType: 'audio/mpeg' };
    await startMp3(fakeTranscode);
    expect((await req(srv, `/s/${BOOK}/${MP3}`)).body.toString()).toBe('ID3-stored');
    expect(made).toBe(0);
    const none = await req(srv, `/s/${BOOK}/a02-99999999.mp3`);
    expect([none.status, none.headers['cache-control']]).toEqual([404, 'no-store']);
  });
  test('a transcode that fails: 502 no-store, never a broken file kept', async () => {
    await startMp3(async () => { throw new Error('ffmpeg missing'); });
    const r = await req(srv, `/s/${BOOK}/${MP3}`);
    expect([r.status, r.headers['cache-control']]).toEqual([502, 'no-store']);
  });
  test('GOLDEN: off (or absent) → the .mp3 that storage does not have is 404, as today, and nothing is made', async () => {
    mp3 = false;
    await startMp3(fakeTranscode);
    const r = await req(srv, `/s/${BOOK}/${MP3}`);
    expect([r.status, r.headers['cache-control']]).toEqual([404, 'no-store']);
    expect(made).toBe(0);
    expect(asked).toEqual([`story/sandbox/${BOOK}/${MP3}`]);
  });
  test('the real transcode (the bundled ffmpeg): an Ogg Opus voice comes back as an MP3 stream', async () => {
    const { execFileSync } = require('child_process');
    const { ffmpegBinary } = require('../services/coach-disagreement-clip');
    let bin = ffmpegBinary();
    if (bin === 'ffmpeg') { try { bin = require(require.resolve('@ffmpeg-installer/ffmpeg', { paths: [require('path').join(__dirname, '..', '..', 'bot')] })).path; } catch (_) { /* PATH */ } }
    const ogg = execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', 'pipe:1']);
    const { oggToMp3 } = require('../routes/web-quiz-story-assets');
    const out = await oggToMp3(ogg, { bin });
    // an MP3 stream: an ID3 tag or an MPEG audio frame sync (0xFFE…) at the start
    expect(out.length).toBeGreaterThan(1000);
    expect(out.slice(0, 3).toString() === 'ID3' || (out[0] === 0xff && (out[1] & 0xe0) === 0xe0)).toBe(true);
  });
});
