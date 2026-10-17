'use strict';
/**
 * Jugnu's read-along on a quiz QUESTION, for a quiz with one voice (web-quiz-one-voice-flag.js).
 *
 * Recorded: under a one-voice plan the question's clip is asked of the voice WITH the time of every character, in the
 * same generation (ElevenLabs /with-timestamps: no second call, no extra characters). When the words spoken are the
 * words printed (punctuation and case aside), the question has word times (timings()), kept on its clip map entry
 * (meta.web_one.audio[qid].q_ra = { ms, w: [[s_ms, e_ms], ...] }, one pair per printed word) and as a READALONG v1
 * file beside the clip (<clip>.json, timingFile(); the shape wq-readalong.js reads). Otherwise the question has none
 * and the page reads it as before.
 *
 * Served: behind app_settings `web_quiz_question_readalong` (default off), and only for a quiz with one voice, the
 * page payload carries `question_readalong: true` and each timed question `audio.ra` (raFor()), which wq.js hands to
 * the shared player on the question's stem.
 *
 * Off: an absent row, `false`, a string (the JSON string "true" too), any other value and a failed read. 30 s cache.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { printedWords } = require('./web-quiz-readalong');

const KEY = 'web_quiz_question_readalong';
const TTL_MS = 30 * 1000;
let cache = null; // { at, on }

/** → true only when the switch's value is JSON true. `db`: a Supabase client (defaults to the bot's). Never throws. */
async function on({ db, now = Date.now() } = {}) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const client = db || require('../../config/supabase');
    const { data, error } = await client.from('app_settings').select('key, value').eq('key', KEY).maybeSingle();
    if (error) throw new Error(error.message || 'app_settings read failed');
    cache = { at: now, on: Boolean(data) && data.value === true };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web-quiz: question read-along setting unreadable — off', { error: err && err.message });
    return false;
  }
}

// Letters and digits only, lower case (as the passages' read-along compares words: web-quiz-readalong-timing.js norm).
const norm = (w) => String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The words the voice said, from its alignment: [{ t, s, e }] in ms (a word: from its first character's start to its last's end). */
function spokenWords(alignment) {
  const a = alignment && typeof alignment === 'object' ? alignment : null;
  const chars = a && Array.isArray(a.characters) ? a.characters : null;
  const st = a && a.character_start_times_seconds;
  const en = a && a.character_end_times_seconds;
  if (!chars || !Array.isArray(st) || !Array.isArray(en) || st.length !== chars.length || en.length !== chars.length) return null;
  const out = [];
  let cur = null;
  chars.forEach((c, k) => {
    if (/^\s*$/.test(String(c))) { cur = null; return; }
    const s = Math.round(Number(st[k]) * 1000);
    const e = Math.round(Number(en[k]) * 1000);
    if (!cur) { cur = { t: '', s, e }; out.push(cur); }
    cur.t += c;
    cur.e = e;
  });
  return out;
}

/**
 * The printed question's word times from the voice's alignment, or null: the spoken words must be the printed words
 * (punctuation and case aside), every word inside the clip, in order. A stem with maths in it ($…$) has none: the page
 * draws its maths, which has no printed word to light. → { ms, w: [[s_ms, e_ms], ...] }. Pure.
 */
function timings({ printed, alignment, ms }) {
  if (String(printed || '').includes('$')) return null;   // maths ($…$) is drawn, not printed as words: nothing to light
  const shown = printedWords(printed);
  const said = spokenWords(alignment);
  const end = Math.round(Number(ms) || 0);
  if (!shown.length || !said || said.length !== shown.length || !(end > 0)) return null;
  if (shown.some((w, k) => norm(w) !== norm(said[k].t))) return null;
  const w = [];
  let prev = 0;
  for (const x of said) {
    const s = x.s;
    const e = Math.min(x.e, end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < prev || !(s < e)) return null;
    w.push([s, e]);
    prev = s;
  }
  return { ms: end, w };
}

const dirOf = (lang) => (lang === 'ur' ? 'rtl' : 'ltr');

/** The READALONG v1 file of a question's clip (stored beside it as <clip>.json). Pure. */
function timingFile({ qid, lang, printed, clipKey, ra, voice }) {
  const words = printedWords(printed);
  return {
    v: 1, id: `q/${qid}`, lang, dir: dirOf(lang),
    audio: { url: String(clipKey).split('/').pop(), ms: ra.ms, mime: 'audio/ogg; codecs=opus' },
    words: words.map((t, i) => ({ i, t, s_ms: ra.w[i][0], e_ms: ra.w[i][1] })),
    voice: { provider: voice.provider, voice: voice.voice, model: voice.model || null },
    timing_src: 'tts_align',
    text_hash: `sha256:${crypto.createHash('sha256').update(words.join(' ')).digest('hex').slice(0, 8)}`,
  };
}

/** A clip's timing file key: the clip's own key, .json for .ogg. */
const fileKey = (clipKey) => String(clipKey).replace(/\.ogg$/, '.json');

/**
 * What the page is given for a question (audio.ra), or null: the stored times of THIS clip (the served link is the
 * entry's key) for exactly the words printed now (a question edited since gets none). Pure.
 */
function raFor({ entry, url, printed, lang }) {
  const ra = entry && entry.q_ra;
  if (String(printed || '').includes('$')) return null;   // maths: drawn as today, never lit word by word
  if (!ra || !Array.isArray(ra.w) || !entry.q || typeof url !== 'string' || url.indexOf(String(entry.q).split('/').pop()) < 0) return null;
  const words = printedWords(printed);
  if (!words.length || words.length !== ra.w.length) return null;
  return { v: 1, lang, dir: dirOf(lang), ms: ra.ms, words: words.map((t, i) => ({ i, t, s_ms: ra.w[i][0], e_ms: ra.w[i][1] })) };
}

/** Tests only: forget the cached reading. */
function reset() { cache = null; }

module.exports = { on, timings, spokenWords, timingFile, fileKey, raFor, reset, KEY, TTL_MS };
