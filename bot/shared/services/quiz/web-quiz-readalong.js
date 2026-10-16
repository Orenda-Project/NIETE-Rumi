'use strict';
/**
 * Read-along timings: the word-by-word clock for a passage Jugnu reads on screen.
 *
 * A passage's read-along is two files made offline (scripts/web-quiz/readalong-build.js) in the quiz-audio bucket:
 *
 *   readalong/<env>/passage/<lang>/<passage_id>/current.json   the timing file (shape: wq-readalong.js)
 *   readalong/<env>/passage/<lang>/<passage_id>/<name>.ogg      its child-paced voice (named by the file)
 *
 * The timing file says its audio by a key RELATIVE to its own folder; forPassage() reads the file (cached), checks it
 * against the words the child will see (same count, same text hash: a passage edited after its voice was made is never
 * served out of step), and returns it with the audio as a short-lived signed URL — inlined in the page's payload, so
 * the page makes no second request.
 *
 * Behind app_settings `web_quiz_readalong` (fails closed). Off ⇒ one switch read and nothing else; no payload field.
 * Nothing here records audio or spends money: a passage without its files simply has no read-along.
 */

const crypto = require('crypto');

const SWITCH_KEY = 'web_quiz_readalong';
const PREFIX = 'readalong';
const AUDIO_TTL_S = 6 * 3600;
const HIT_MS = 10 * 60 * 1000;   // a file found is re-read after this (a rebuilt voice reaches children within minutes)
const MISS_MS = 2 * 60 * 1000;   // a file not there is asked again after this

/** The words a child sees: the passage text split on whitespace, punctuation kept on its word. */
function printedWords(text) {
  return String(text == null ? '' : text).split(/\s+/).filter(Boolean);
}

/** sha256 of the printed words joined by one space, first 8 hex — what a timing file says it was made from. */
function textHash(text) {
  return `sha256:${crypto.createHash('sha256').update(printedWords(text).join(' ')).digest('hex').slice(0, 8)}`;
}

const safe = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 96) || 'x';

function deployEnv(env = process.env) {
  const raw = env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'dev';
  return String(raw).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'dev';
}

/** The folder of one item's read-along files. */
function folder({ env, kind = 'passage', lang, id }) {
  return `${PREFIX}/${safe(env)}/${safe(kind)}/${safe(lang)}/${safe(id)}`;
}

/**
 * The timing object checked against the words shown: { ok: true, data } or { ok: false, why }.
 * Same rules as the page's parser (wq-readalong.js parse) plus: as many words as printed, the same text hash.
 */
function check(d, text) {
  if (!d || typeof d !== 'object') return { ok: false, why: 'not_json' };
  if (d.v !== 1) return { ok: false, why: 'version' };
  if (!d.audio || typeof d.audio.url !== 'string' || !d.audio.url || /^[a-z]+:|^\/|\.\./i.test(d.audio.url)) return { ok: false, why: 'audio' };
  const shown = printedWords(text);
  if (!Array.isArray(d.words) || d.words.length !== shown.length || !shown.length) return { ok: false, why: 'word_count' };
  if (d.text_hash !== textHash(text)) return { ok: false, why: 'text_hash' };
  let prev = -1;
  for (let k = 0; k < d.words.length; k += 1) {
    const w = d.words[k];
    const s = Number(w && w.s_ms);
    const e = Number(w && w.e_ms);
    if (!w || w.i !== k || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s || s < prev) return { ok: false, why: `word_${k}` };
    prev = s;
  }
  return { ok: true, data: d };
}

/**
 * @param {object} deps
 * @param {(key: string) => Promise<boolean>} deps.settingOn   the app_settings reader (fails closed)
 * @param {object} deps.r2          { downloadFromR2(key, {bucket}), presignKey(key, ttl, {bucket}) }
 * @param {() => string|null} deps.bucket
 * @param {object} [deps.env]
 * @param {(event: string, data: object) => void} [deps.logError]
 */
function createReadAlong({ settingOn, r2, bucket, env = process.env, now = () => Date.now(), logError = () => {} }) {
  const cache = new Map();   // json key → { at, d } (d null = not there)

  async function load(key) {
    const c = cache.get(key);
    if (c && now() - c.at < (c.d ? HIT_MS : MISS_MS)) return c.d;
    let d = null;
    try {
      const buf = await r2.downloadFromR2(key, { bucket: bucket() });
      d = JSON.parse(Buffer.from(buf).toString('utf8'));
    } catch (e) {
      const missing = e && (e.name === 'NoSuchKey' || (e.$metadata && e.$metadata.httpStatusCode === 404));
      if (!missing) logError('web_quiz.readalong_read_failed', { key, error: String(e && e.message || e).slice(0, 160) });
      d = null;
    }
    cache.set(key, { at: now(), d });
    return d;
  }

  /**
   * The read-along for a passage the child is about to see, or null (switch off, no file, a file out of step).
   * The switch is read first: off, nothing else happens.
   */
  async function forPassage({ lang, passageId, text }) {
    if (!(await settingOn(SWITCH_KEY))) return null;
    if (!passageId || !text) return null;
    const dir = folder({ env: deployEnv(env), kind: 'passage', lang, id: passageId });
    const d = await load(`${dir}/current.json`);
    if (!d) return null;
    const c = check(d, text);
    if (!c.ok) { logError('web_quiz.readalong_out_of_step', { passage_id: passageId, lang, why: c.why }); return null; }
    let url = null;
    try { url = await r2.presignKey(`${dir}/${d.audio.url}`, AUDIO_TTL_S, { bucket: bucket() }); } catch (_) { url = null; }
    if (!url) return null;
    return {
      v: 1, id: d.id || passageId, lang: d.lang || lang, dir: d.dir || (lang === 'ur' ? 'rtl' : 'ltr'),
      audio: { url, ms: Number(d.audio.ms) || 0, mime: d.audio.mime || 'audio/ogg; codecs=opus' },
      words: d.words.map((w) => ({ i: w.i, t: w.t, s_ms: w.s_ms, e_ms: w.e_ms })),
      ...(d.pace_wpm ? { pace_wpm: d.pace_wpm } : {}),
    };
  }

  return { forPassage, _reset: () => cache.clear() };
}

let shared = null;
/** The process's read-along on the quiz-audio bucket; the caller hands in its switch reader (no require cycle). */
function readAlong({ settingOn } = {}) {
  if (!shared) {
    if (typeof settingOn !== 'function') throw new TypeError('readAlong: settingOn is required on first use');
    const AudioStore = require('./web-quiz-audio-store');
    shared = createReadAlong({
      settingOn,
      r2: require('../../storage/r2'),
      bucket: () => AudioStore.quizAudioBucket(),
      logError: (ev, data) => require('../../utils/logger').logError(ev, data),
    });
  }
  return shared;
}

module.exports = { SWITCH_KEY, createReadAlong, readAlong, check, textHash, printedWords, folder, deployEnv };
