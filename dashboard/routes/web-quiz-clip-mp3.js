/**
 * GET /wq/clip/<storage key>.mp3 — a per-quiz voice clip as mp3, for a phone that cannot play Ogg Opus (Safari and
 * WhatsApp's browser on iOS before 18.4). Every per-quiz clip is stored as Ogg Opus only (web-quiz-audio-store.js
 * clipKey, `.ogg`), and the page plays it from a storage link; such a phone could never play one.
 *
 * The page asks for it only on such a phone (wq.js playable(), web_quiz_voice_v2): the clip's own storage key, `.mp3`
 * in place of `.ogg`. The stored `.ogg` is read from storage, made mp3 by the storybook's transcoder
 * (web-quiz-story-assets.js oggToMp3: ffmpeg, mono 48 kb/s, at most 2 at once), kept in a 64 MB memory so a class asks
 * storage once, and served immutable: the key carries its content hash, so the bytes never change under the name.
 *
 * Only the clip store's key shapes are served (KEY_RX); nothing else in storage is reachable from here.
 * Switch app_settings web_quiz_voice_v2 (JSON true only; default OFF, read at most every 30 s, fail closed): OFF, the
 * path is not ours and the request goes on to whatever answers it today; storage is never asked.
 */
const { createByteLru, flagReader, oggToMp3, limiter: makeLimiter, rangeOf } = require('./web-quiz-story-assets');

const FLAG_KEY = 'web_quiz_voice_v2';
const LEGACY_PREFIX = 'web-quiz/audio/';
// quiz-audio/<env>/<quiz id>/<lang>/<question id>/<part>-<voice>-<hash8> (clipKey), the challenge's
// quiz-audio/<env>/challenge/<lang>/<exercise>/<part>-<voice>-<hash8>, and the legacy web-quiz/audio/... keys.
const KEY_RX = /^(?:quiz-audio\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}-[A-Za-z0-9-]{1,64}-[0-9a-f]{8}|web-quiz\/audio\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9_-]{1,128})$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_STORE = { 'Cache-Control': 'no-store' };

/** The bucket a stored clip is in: legacy keys in the main bucket, the rest in the quiz-audio bucket (clip store's rule). */
function bucketFor(key, env = process.env) {
  if (key.startsWith(LEGACY_PREFIX)) return env.R2_BUCKET_NAME || undefined;
  return String(env.WEB_QUIZ_AUDIO_BUCKET || '').trim() || env.R2_BUCKET_NAME || undefined;
}

async function r2Object(key, bucket) {
  return require('../services/r2.service').getObjectBytes(key, { bucket });
}

/**
 * opts: on() → boolean (default: the switch), object(key, bucket) → {bytes} | null (default: storage),
 * transcode(bytes) → mp3 bytes (default: oggToMp3, at most 2 at once), env, lruBytes, now.
 */
function createClipMp3Handler(opts = {}) {
  const on = opts.on || flagReader({ now: opts.now, key: FLAG_KEY, jsonTrue: true });
  const object = opts.object || r2Object;
  const queue = makeLimiter(2);
  const transcode = opts.transcode || ((b) => queue(() => oggToMp3(b)));
  const env = opts.env || process.env;
  const lru = createByteLru(opts.lruBytes);
  return async function clipMp3(req, res, next) {
    if (!(await on())) return next();
    const asked = String((req.params && req.params[0]) || '');
    const stem = asked.endsWith('.mp3') ? asked.slice(0, -4) : null;
    if (!stem || !KEY_RX.test(stem)) return res.status(404).set(NO_STORE).end();
    // The key's content hash is the version: a phone that has it is told so without a read. Safari asks for audio by
    // byte range and will not play from a server that cannot answer 206 (story route's rangeOf).
    const etag = `"${stem.slice(-8)}"`;
    const fixed = { 'Cache-Control': IMMUTABLE, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ETag: etag };
    if (req.headers && req.headers['if-none-match'] === etag) return res.status(304).set(fixed).end();
    let hit = lru.get(stem);
    if (!hit) {
      let ogg;
      try { ogg = await object(`${stem}.ogg`, bucketFor(stem, env)); } catch (_) { return res.status(502).set(NO_STORE).end(); }
      if (!ogg || !ogg.bytes || !ogg.bytes.length) return res.status(404).set(NO_STORE).end();
      try { hit = { bytes: await transcode(ogg.bytes), contentType: 'audio/mpeg' }; } catch (_) { return res.status(502).set(NO_STORE).end(); }
      lru.set(stem, hit);
    }
    const size = hit.bytes.length;
    const range = req.headers && req.headers.range ? rangeOf(req.headers.range, size) : null;
    if (range && range.bad) return res.status(416).set({ ...NO_STORE, 'Content-Range': `bytes */${size}` }).end();
    if (range) {
      return res.status(206).set({ ...fixed, 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${range.start}-${range.end}/${size}` })
        .end(hit.bytes.subarray(range.start, range.end + 1));
    }
    return res.status(200).set({ ...fixed, 'Content-Type': 'audio/mpeg', 'Content-Length': String(size) }).send(hit.bytes);
  };
}

module.exports = { createClipMp3Handler, KEY_RX, FLAG_KEY, bucketFor };
