/**
 * GET /wq/clip/<stored quiz clip key as .mp3> — a per-quiz voice clip as mp3 for a phone that cannot play Ogg Opus
 * (an iPhone: 18.3% of iPhone page sessions lost clips in Nov 2026, almost all "unsupported").
 *
 * The handler is driven with storage and ffmpeg faked at the boundary (object(key, bucket), transcode(bytes)); the
 * real route code runs: the key check, the switch, the bucket choice, the memory, the headers.
 */
const { createClipMp3Handler, KEY_RX } = require('../../routes/web-quiz-clip-mp3');

const KEY = 'quiz-audio/production/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/en/7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f/q-reyna-1a2b3c4d';
const OGG = Buffer.from('OggS fake opus');
const MP3 = Buffer.from('ID3 fake mp3');

function res() {
  const r = { statusCode: 200, headers: {}, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.set = (k, v) => { if (typeof k === 'object') Object.assign(r.headers, k); else r.headers[k] = v; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = (b) => { r.body = b || null; return r; };
  return r;
}

function setup({ on = true, stored = { [`${KEY}.ogg`]: OGG } } = {}) {
  const asked = [];
  const transcoded = [];
  const h = createClipMp3Handler({
    on: async () => on,
    object: async (key, bucket) => { asked.push([key, bucket]); return stored[key] ? { bytes: stored[key], contentType: 'audio/ogg' } : null; },
    transcode: async (b) => { transcoded.push(b); return MP3; },
    env: { WEB_QUIZ_AUDIO_BUCKET: 'quiz-bucket', R2_BUCKET_NAME: 'main-bucket' },
  });
  const get = async (p, headers = {}) => { const r = res(); let nexted = false; await h({ params: [p], path: `/wq/clip/${p}`, headers }, r, () => { nexted = true; }); return { r, nexted }; };
  return { get, asked, transcoded };
}

test('a stored quiz clip asked for as .mp3 is made from its .ogg, served as audio/mpeg, immutable, under the same name', async () => {
  const s = setup();
  const { r } = await s.get(`${KEY}.mp3`);
  expect(r.statusCode).toBe(200);
  expect(r.headers['Content-Type']).toBe('audio/mpeg');
  expect(r.headers['Cache-Control']).toMatch(/immutable/);
  expect(r.body).toEqual(MP3);
  expect(s.asked).toEqual([[`${KEY}.ogg`, 'quiz-bucket']]);
});

test('a class asking for the same clip asks storage and ffmpeg once (kept in memory)', async () => {
  const s = setup();
  await s.get(`${KEY}.mp3`);
  const { r } = await s.get(`${KEY}.mp3`);
  expect(r.body).toEqual(MP3);
  expect(s.transcoded).toHaveLength(1);
  expect(s.asked).toHaveLength(1);
});

test('a legacy clip (web-quiz/audio/…) is read from the main bucket', async () => {
  const legacy = 'web-quiz/audio/0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c/q1-why-abc12345';
  const s = setup({ stored: { [`${legacy}.ogg`]: OGG } });
  const { r } = await s.get(`${legacy}.mp3`);
  expect(r.statusCode).toBe(200);
  expect(s.asked).toEqual([[`${legacy}.ogg`, 'main-bucket']]);
});

test.each([
  ['a path outside the quiz clips', 'story/production/x/page-1a2b3c4d.mp3'],
  ['a path that climbs', 'quiz-audio/../secrets/q-reyna-1a2b3c4d.mp3'],
  ['not an mp3 ask', `${KEY}.ogg`],
])('%s is refused (404) without asking storage', async (_, p) => {
  const s = setup();
  const { r } = await s.get(p);
  expect(r.statusCode).toBe(404);
  expect(s.asked).toEqual([]);
});

test('a clip storage does not hold is 404', async () => {
  const s = setup({ stored: {} });
  const { r } = await s.get(`${KEY}.mp3`);
  expect(r.statusCode).toBe(404);
});

test('switch off (web_quiz_voice_v2): the path is not ours, the request goes on, storage is never asked', async () => {
  const s = setup({ on: false });
  const { nexted } = await s.get(`${KEY}.mp3`);
  expect(nexted).toBe(true);
  expect(s.asked).toEqual([]);
});

test('the key shape is the clip store\'s own (web-quiz-audio-store clipKey) and the challenge clips\'', () => {
  const { clipKey } = require('../../../bot/shared/services/quiz/web-quiz-audio-store');
  const k = clipKey({ env: 'production', quizId: '0b8f0c39-5d3c-4a7e-9a55-2d1f9e0a1b2c', lang: 'ur', qid: '7d1e2c3b-4a5f-4e6d-8c7b-9a8b7c6d5e4f', part: 'xa', voice: 'Reyna', text: 'نہیں', format: 'opus32' });
  expect(KEY_RX.test(k.replace(/\.ogg$/, ''))).toBe(true);
  expect(KEY_RX.test('quiz-audio/production/challenge/ur/ex-12/why-Reyna-1a2b3c4d')).toBe(true);
});

test('Safari asks for audio by byte range: a Range gets a 206 with the part asked for (Safari will not play without it)', async () => {
  const s = setup();
  const { r } = await s.get(`${KEY}.mp3`, { range: 'bytes=0-1' });
  expect(r.statusCode).toBe(206);
  expect(r.headers['Content-Range']).toBe(`bytes 0-1/${MP3.length}`);
  expect(r.headers['Accept-Ranges']).toBe('bytes');
  expect(Buffer.from(r.body)).toEqual(MP3.subarray(0, 2));
});

test('the phone keeps it: an If-None-Match on the clip\'s hash is a 304', async () => {
  const s = setup();
  const { r } = await s.get(`${KEY}.mp3`, { 'if-none-match': '"1a2b3c4d"' });
  expect(r.statusCode).toBe(304);
});
