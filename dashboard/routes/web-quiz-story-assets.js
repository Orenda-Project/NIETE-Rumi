/**
 * GET /s/:bookId/:file — a storybook's page pictures, covers, word bands and page voices, from our own origin.
 *
 * Every file is content-addressed (story-store.js: story/<env>/<book id>/<stem>-<hash8>.<ext>), so it never changes
 * under its name and the phone keeps it for a year (immutable); a re-voice is a new name. Streamed from storage by
 * the portal itself, never through the bot, and kept in a 64 MB memory so a class opening the same book asks
 * storage once. Phones fetch audio by byte range: a Range gets a 206.
 *
 * Switch app_settings web_quiz_stories (default OFF, read at most every 30 s, fail closed): OFF, the edge does not own
 * the path at all — the request goes on to whatever answers it today, byte for byte, and storage is never asked.
 *
 * A phone that cannot play Ogg Opus (Safari and WhatsApp's browser on iOS before 18.4): with app_settings
 * web_quiz_story_mp3 (JSON true only; default OFF) a voice asked for as `<stem>-<hash8>.mp3` that storage does not hold
 * is made from its stored `<stem>-<hash8>.ogg` (ffmpeg, mono 48 kb/s, a few hundred ms), kept in the same memory and
 * served immutable under the same hash: the same voice, the same timings. The reader asks for the .mp3 only on such a
 * phone (wq-stories.js, the book's `mp3: 1`). Off: an .mp3 storage does not hold is 404, as today.
 */
const StoryStore = require('../../bot/shared/services/quiz/story-store');

const FLAG_KEY = 'web_quiz_stories';
const FLAG_TTL_MS = 30000;
const LRU_BYTES = 64 * 1024 * 1024;
const TYPES = { webp: 'image/webp', ogg: 'audio/ogg', mp3: 'audio/mpeg' };
const NO_STORE = { 'Cache-Control': 'no-store' };

/** A memory of {bytes, contentType} by key, at most maxBytes in total; least recently used out first. */
function createByteLru(maxBytes = LRU_BYTES) {
  const m = new Map();
  let total = 0;
  return {
    get(k) {
      const v = m.get(k);
      if (v) { m.delete(k); m.set(k, v); }
      return v;
    },
    set(k, v) {
      const n = v.bytes.length;
      if (n > maxBytes) return;
      if (m.has(k)) { total -= m.get(k).bytes.length; m.delete(k); }
      while (total + n > maxBytes && m.size) {
        const [oldK, oldV] = m.entries().next().value;
        m.delete(oldK);
        total -= oldV.bytes.length;
      }
      m.set(k, v);
      total += n;
    },
    size: () => total,
  };
}

/** app_settings web_quiz_stories (or `key`), read through the portal's own client, remembered for 30 s; any failure = off. */
function flagReader({ now = Date.now, key = FLAG_KEY } = {}) {
  let at = -Infinity;
  let val = false;
  return async () => {
    if (now() - at < FLAG_TTL_MS) return val;
    try {
      const supabase = require('../config/supabase');
      val = supabase ? await require('../lib/feature-flags').isFlagEnabled(supabase, key) : false;
    } catch (_) { val = false; }
    at = now();
    return val;
  };
}

const MP3_KEY = 'web_quiz_story_mp3';
const TRANSCODE_MS = 20000;
const TRANSCODE_MAX = 2;          // ffmpeg runs at once on this box; more wait their turn

/** The ffmpeg binary: FFMPEG_PATH, else the bundled one (a portal dependency), else ffmpeg on PATH. */
function ffmpegBin() {
  try { return require('../services/coach-disagreement-clip').ffmpegBinary(); } catch (_) { return 'ffmpeg'; }
}

/** An Ogg Opus voice as MP3 bytes (mono, 48 kb/s). Rejects on a spawn error, a non-zero exit, no output or a timeout. */
function oggToMp3(bytes, { bin = ffmpegBin(), spawn = require('child_process').spawn, timeoutMs = TRANSCODE_MS } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const out = [];
    const proc = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0', '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const end = (err, val) => { if (done) return; done = true; clearTimeout(timer); if (err) { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } reject(err); } else resolve(val); };
    const timer = setTimeout(() => end(new Error('transcode timed out')), timeoutMs);
    proc.on('error', (e) => end(e));
    proc.stdout.on('data', (c) => out.push(c));
    if (proc.stderr) proc.stderr.resume();
    proc.on('close', (code) => { const b = Buffer.concat(out); if (code === 0 && b.length) end(null, b); else end(new Error(`ffmpeg exited ${code}`)); });
    proc.stdin.on('error', () => { /* the exit code says it */ });
    proc.stdin.end(bytes);
  });
}

/** At most `max` at once; the rest queue (never refused). */
function limiter(max) {
  let running = 0;
  const queue = [];
  const next = () => { if (running >= max || !queue.length) return; running += 1; const { fn, res, rej } = queue.shift(); fn().then(res, rej).finally(() => { running -= 1; next(); }); };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

/** The object at key in the quiz-audio bucket, or null when storage has no such object. */
async function r2Object(key) {
  return require('../services/r2.service').getObjectBytes(key, { bucket: StoryStore.storyBucket() || undefined });
}

function rangeOf(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start; let end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start <= end && start < size ? { start, end } : { bad: true };
}

/**
 * The route's handler. opts: storiesOn() → boolean, storyObject(key) → {bytes, contentType} | null, storyEnv (the
 * storage env name; default the Railway environment's), limiter (express middleware, run only while on), now.
 */
function createStoryAssetHandler(opts = {}) {
  const storiesOn = opts.storiesOn || flagReader({ now: opts.now });
  const storyObject = opts.storyObject || r2Object;
  const env = opts.storyEnv || StoryStore.deployEnv();
  const lru = createByteLru(opts.lruBytes || LRU_BYTES);
  // web_quiz_story_mp3: read only when an .mp3 storage does not hold is asked for (never on another request)
  const mp3On = opts.mp3On || flagReader({ now: opts.now, key: MP3_KEY, jsonTrue: true });
  const transcode = opts.transcode || ((bytes) => oggToMp3(bytes));
  const queue = limiter(opts.transcodeMax || TRANSCODE_MAX);
  const making = new Map();   // mp3 key → the one transcode in flight (a class asking at once makes it once)
  // the .mp3 of a stored .ogg: null when the switch is off or there is no .ogg; throws when the transcode fails
  async function mp3Of(key) {
    let on = false;
    try { on = (await mp3On()) === true; } catch (_) { on = false; }
    if (!on) return null;
    if (making.has(key)) return making.get(key);
    const p = (async () => {
      const oggKey = key.replace(/\.mp3$/, '.ogg');
      const ogg = lru.get(oggKey) || await storyObject(oggKey);
      if (!ogg || !ogg.bytes) return null;
      const bytes = await queue(() => transcode(ogg.bytes));
      return { bytes, contentType: 'audio/mpeg' };
    })();
    making.set(key, p);
    try { return await p; } finally { making.delete(key); }
  }
  return async function storyAsset(req, res, next) {
    let on = false;
    try { on = (await storiesOn()) === true; } catch (_) { on = false; }
    if (!on) return next();
    if (opts.limiter) {
      let passed = false;
      await new Promise((resolve) => { Promise.resolve(opts.limiter(req, res, () => { passed = true; resolve(); })).then(() => resolve(), () => resolve()); });
      if (!passed) return undefined;
    }
    const bookId = String(req.params.bookId || '');
    const file = String(req.params.file || '');
    if (!StoryStore.BOOK_RX.test(bookId) || !StoryStore.FILE_RX.test(file)) return res.status(400).set(NO_STORE).json({ error: 'bad_name' });
    const key = StoryStore.storyKey({ env, bookId, file });
    const h8 = /-([0-9a-f]{8})\.[a-z0-9]+$/.exec(file);
    const etag = h8 ? `"${h8[1]}"` : null;
    const fixed = { 'Cache-Control': StoryStore.IMMUTABLE, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...(etag ? { ETag: etag } : {}) };
    if (etag && req.headers['if-none-match'] === etag) return res.status(304).set(fixed).end();
    let obj = lru.get(key);
    if (!obj) {
      try { obj = await storyObject(key); } catch (_) { return res.status(502).set(NO_STORE).json({ error: 'upstream_error' }); }
      if ((!obj || !obj.bytes) && /\.mp3$/.test(file)) {
        try { obj = await mp3Of(key); } catch (_) { return res.status(502).set(NO_STORE).json({ error: 'upstream_error' }); }
      }
      if (!obj || !obj.bytes) return res.status(404).set(NO_STORE).json({ error: 'not_found' });
      lru.set(key, obj);
    }
    const type = TYPES[file.split('.').pop()] || obj.contentType || 'application/octet-stream';
    const size = obj.bytes.length;
    const range = req.headers.range ? rangeOf(req.headers.range, size) : null;
    if (range && range.bad) return res.status(416).set({ ...NO_STORE, 'Content-Range': `bytes */${size}` }).end();
    if (range) {
      return res.status(206).set({ ...fixed, 'Content-Type': type, 'Content-Range': `bytes ${range.start}-${range.end}/${size}` })
        .end(obj.bytes.subarray(range.start, range.end + 1));
    }
    return res.status(200).set({ ...fixed, 'Content-Type': type, 'Content-Length': String(size) }).end(obj.bytes);
  };
}

module.exports = { createStoryAssetHandler, createByteLru, flagReader, r2Object, oggToMp3, FLAG_KEY, MP3_KEY };
