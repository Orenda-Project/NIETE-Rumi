/**
 * The mp3 clip route is mounted on the web quiz router (createWebQuizRouter), ahead of the portal's catch-all: a real
 * Express app over real HTTP, storage faked at its boundary; one case runs the real bundled ffmpeg end to end.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const KEY = 'quiz-audio/sandbox/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/ur/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/why-reyna-1a2b3c4d';
const SPA = '<!doctype html><title>portal</title>';

function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, path, method: 'GET', headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

let srv;
async function start(o) {
  const app = express();
  app.set('trust proxy', true);
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', logEvent: () => {}, fetchImpl: async () => { throw new Error('the bot is never asked'); }, ...o }));
  app.get('*', (q, res) => res.type('html').send(SPA));
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
}
afterEach(async () => { if (srv) await new Promise((r) => srv.close(r)); srv = null; });

test('on: /wq/clip/<key>.mp3 is answered by the clip route, as audio/mpeg', async () => {
  const asked = [];
  await start({ clipMp3On: async () => true, clipObject: async (k) => { asked.push(k); return { bytes: Buffer.from('OggS') }; }, clipTranscode: async () => Buffer.from('ID3 mp3') });
  const r = await get(srv, `/wq/clip/${KEY}.mp3`);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/audio\/mpeg/);
  expect(r.body.toString()).toBe('ID3 mp3');
  expect(asked).toEqual([`${KEY}.ogg`]);
});

test('off: the path is not ours — the router answers it exactly as today (its /wq/* "not found") and storage is never asked', async () => {
  await start({});
  const today = await get(srv, `/wq/clip/${KEY}.mp3`);
  await new Promise((r) => srv.close(r));
  const asked = [];
  await start({ clipMp3On: async () => false, clipObject: async (k) => { asked.push(k); return null; } });
  const r = await get(srv, `/wq/clip/${KEY}.mp3`);
  expect([r.status, r.body.toString()]).toEqual([today.status, today.body.toString()]);
  expect(asked).toEqual([]);
});

test('the real transcode through the route: a stored Ogg Opus clip comes back as an MP3 stream, and by range', async () => {
  const { execFileSync } = require('child_process');
  const { ffmpegBinary } = require('../../services/coach-disagreement-clip');
  let bin = ffmpegBinary();
  if (bin === 'ffmpeg') { try { bin = require(require.resolve('@ffmpeg-installer/ffmpeg', { paths: [require('path').join(__dirname, '..', '..', '..', 'bot')] })).path; } catch (_) { /* PATH */ } }
  const ogg = execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
  await start({ clipMp3On: async () => true, clipObject: async () => ({ bytes: ogg }) });
  const r = await get(srv, `/wq/clip/${KEY}.mp3`);
  expect(r.status).toBe(200);
  expect(r.body.length).toBeGreaterThan(1000);
  expect(r.body.slice(0, 3).toString() === 'ID3' || (r.body[0] === 0xff && (r.body[1] & 0xe0) === 0xe0)).toBe(true);
  const part = await get(srv, `/wq/clip/${KEY}.mp3`, { range: 'bytes=0-99' });
  expect(part.status).toBe(206);
  expect(part.body.length).toBe(100);
});
