'use strict';
/**
 * Child test (bd-s1oo0.5) — Soniox async transcription through the bot's own
 * AudioService, with diarization on and the language forced per block
 * ('ur' for Urdu and maths, 'en' for English).
 */

const { wordsFromTokens } = require('./text-norm');

// Soniox async list price (USD per audio hour). The study paid ≈ $8.50 for ≈ 62 h.
const SONIOX_ASYNC_USD_PER_HOUR = Number(process.env.SONIOX_ASYNC_USD_PER_HOUR) || 0.135;

async function transcribe(file, language, durationSec) {
  const AudioService = require('../../audio.service');
  const started = Date.now();
  const res = await AudioService.transcribe(file, true, language);
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

/** Diarised turns as the study rendered them for text graders: "[12s] spk1: …". */
function renderTurns(words, from = -Infinity, to = Infinity) {
  const turns = [];
  for (const w of words) {
    if (w.start < from - 1 || w.end > to + 1) continue;
    const last = turns[turns.length - 1];
    if (last && last.spk === w.speaker && w.start - last.e < 1.5) { last.text += ` ${w.raw}`; last.e = w.end; } else turns.push({ spk: w.speaker, s: w.start, e: w.end, text: w.raw });
  }
  return turns.map((t) => `[${t.s.toFixed(0)}s] spk${t.spk == null ? '?' : t.spk}: ${t.text.slice(0, 500)}`).join('\n');
}

module.exports = { transcribe, renderTurns, SONIOX_ASYNC_USD_PER_HOUR };
