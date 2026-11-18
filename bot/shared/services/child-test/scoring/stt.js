'use strict';
/**
 * Child test (bd-s1oo0.5) — Soniox async transcription through the bot's own
 * AudioService, with diarization on and the language forced per block
 * ('ur' for Urdu and maths, 'en' for English).
 */

const { wordsFromTokens } = require('./text-norm');

// Soniox async list price (USD per audio hour). The study paid ≈ $8.50 for ≈ 62 h.
const SONIOX_ASYNC_USD_PER_HOUR = Number(process.env.SONIOX_ASYNC_USD_PER_HOUR) || 0.135;

/** `signal` (optional) bounds the wait: on abort it rejects with reason 'timeout' (Soniox's own poll runs for minutes). */
async function transcribe(file, language, durationSec, { signal } = {}) {
  const AudioService = require('../../audio.service');
  const started = Date.now();
  const res = await untilAborted(AudioService.transcribe(file, true, language), signal);
  const tokens = (res && res.tokens) || [];
  const words = wordsFromTokens(tokens);
  return {
    tokens,
    words,
    text: (res && res.text) || '',
    language: (res && res.language) || language,
    model: `soniox:${require('../../../utils/constants').SONIOX_PRIMARY_MODEL}`,
    seconds: (Date.now() - started) / 1000,
    cost: Number.isFinite(durationSec) ? Math.round(durationSec / 3600 * SONIOX_ASYNC_USD_PER_HOUR * 1e5) / 1e5 : null,
  };
}

/**
 * A plain second pass (sa_r26_voice_strict): Soniox with BOTH language hints and language identification, and none of
 * the bot's classroom-observation context or speaker split. The usual call (above) gives one hint and that context; on
 * some real recordings it heard no word where this request heard an adult clearly. Used only to back up an
 * another-voice flag, never for the marks. The transcription and the uploaded file are deleted afterwards.
 * { words, text, model, seconds, cost }; throws on an error status; an aborted `signal` rejects with reason 'timeout'.
 * `diarize` (sa_r28_voice_help): the same request with Soniox's speaker split on, and `turns` beside the words, rendered
 * as renderTurns does ("[12s] spk1: …"), for the help check to read.
 */
async function transcribePlain(file, durationSec, { signal, pollMs = 2000, maxWaitMs = 170 * 1000, diarize = false } = {}) {
  /* eslint-disable global-require */
  const axios = require('axios');
  const FormData = require('form-data');
  const fs = require('fs');
  const { SONIOX_API_KEY, SONIOX_PRIMARY_MODEL } = require('../../../utils/constants');
  /* eslint-enable global-require */
  const headers = { Authorization: `Bearer ${SONIOX_API_KEY}` };
  const base = 'https://api.soniox.com/v1';
  const started = Date.now();
  const aborted = () => { const e = new Error('stt_timeout'); e.reason = 'timeout'; return e; };
  const wait = (ms) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(aborted()); return; }
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', stop); resolve(); }, ms);
    function stop() { clearTimeout(t); reject(aborted()); }
    if (signal) signal.addEventListener('abort', stop, { once: true });
  });
  let fileId = null;
  let trId = null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(file));
    fileId = (await untilAborted(axios.post(`${base}/files`, form, { headers: { ...headers, ...form.getHeaders() } }), signal)).data.id;
    trId = (await untilAborted(axios.post(`${base}/transcriptions`, {
      file_id: fileId, model: SONIOX_PRIMARY_MODEL, language_hints: ['ur', 'en'], enable_language_identification: true,
      ...(diarize ? { enable_speaker_diarization: true } : {}),
    }, { headers }), signal)).data.id;
    for (;;) {
      const st = (await untilAborted(axios.get(`${base}/transcriptions/${trId}`, { headers }), signal)).data || {};
      if (st.status === 'completed') break;
      if (st.status === 'error') throw new Error(`plain_stt_error: ${String(st.error_message || '').slice(0, 80)}`);
      if (Date.now() - started > maxWaitMs) throw aborted();
      await wait(pollMs);
    }
    const tokens = ((await untilAborted(axios.get(`${base}/transcriptions/${trId}/transcript`, { headers }), signal)).data || {}).tokens || [];
    const words = wordsFromTokens(tokens);
    return {
      words: words.length,
      text: words.map((w) => w.raw).join(' '),
      ...(diarize ? { turns: renderTurns(words) } : {}),
      model: `soniox:${SONIOX_PRIMARY_MODEL}:plain${diarize ? ':diarized' : ''}`,
      seconds: (Date.now() - started) / 1000,
      cost: Number.isFinite(durationSec) ? Math.round(durationSec / 3600 * SONIOX_ASYNC_USD_PER_HOUR * 1e5) / 1e5 : null,
    };
  } finally {
    if (trId) await deleteQuietly(`${base}/transcriptions/${trId}`, headers);
    if (fileId) await deleteQuietly(`${base}/files/${fileId}`, headers);
  }
}

async function deleteQuietly(url, headers) {
  try { await require('axios').delete(url, { headers }); } catch (_) { /* best effort: Soniox drops old jobs itself */ } // eslint-disable-line global-require
}

function untilAborted(work, signal) {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const fail = () => { const e = new Error('stt_timeout'); e.reason = 'timeout'; reject(e); };
    if (signal.aborted) { fail(); return; }
    signal.addEventListener('abort', fail, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', fail));
  });
}

/** Diarised turns as the study rendered them for text graders: "[12s] spk1: …". */
// A turn longer than this is split into several lines (each with its own time), never cut: a collapsed
// diarization makes the whole note one turn, and the questions at its end must still reach the grader
// (bd-s1oo0.50.9: a 500-character cut hid every listening question).
const TURN_LINE_CHARS = 500;

function renderTurns(words, from = -Infinity, to = Infinity) {
  const turns = [];
  for (const w of words) {
    if (w.start < from - 1 || w.end > to + 1) continue;
    const last = turns[turns.length - 1];
    if (last && last.spk === w.speaker && w.start - last.e < 1.5) { last.words.push(w); last.e = w.end; } else turns.push({ spk: w.speaker, e: w.end, words: [w] });
  }
  const lines = [];
  for (const t of turns) {
    let cur = null;
    for (const w of t.words) {
      if (cur && cur.text.length + 1 + w.raw.length > TURN_LINE_CHARS) { lines.push(cur); cur = null; }
      if (!cur) cur = { s: w.start, text: w.raw }; else cur.text += ` ${w.raw}`;
    }
    if (cur) lines.push({ ...cur, spk: t.spk });
    lines.forEach((l) => { if (l.spk === undefined) l.spk = t.spk; });
  }
  return lines.map((l) => `[${l.s.toFixed(0)}s] spk${l.spk == null ? '?' : l.spk}: ${l.text}`).join('\n');
}

module.exports = { transcribe, transcribePlain, renderTurns, SONIOX_ASYNC_USD_PER_HOUR };
