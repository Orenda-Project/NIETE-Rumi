'use strict';
/**
 * Child test (bd-s1oo0.5) — SpeechAce scripted scoring for English.
 *
 * The plan caps audio at 30 s per call, so a 60-s story is two calls, each with
 * the reference cut to the words the child reached in that half
 * (HARNESS_RESULTS §7). A word with quality_score < 40 is wrong — the cut the
 * study measured (09b sweep).
 */

const fs = require('fs');

const WRONG_BELOW = 40;
const USD_PER_15S = 0.008;

function configured() {
  return !!(process.env.SPEECHACE_API_KEY && process.env.CHILD_TEST_SPEECHACE !== 'off');
}

/** @returns {{ words: [{word, quality, wrong}], cost, seconds, error }} */
async function scoreText(wavPath, text, { seconds: audioSeconds = 30 } = {}) {
  const started = Date.now();
  if (!configured()) return { words: [], cost: 0, seconds: 0, error: 'not_configured' };
  try {
    const axios = require('axios');
    const FormData = require('form-data');
    const ep = (process.env.SPEECHACE_ENDPOINT || 'https://api5.speechace.com').replace(/\/$/, '');
    const form = new FormData();
    form.append('text', text);
    form.append('user_audio_file', fs.createReadStream(wavPath));
    const url = `${ep}/api/scoring/text/v9/json?key=${encodeURIComponent(process.env.SPEECHACE_API_KEY)}&dialect=en-us&user_id=child-test`;
    const r = await axios.post(url, form, { headers: form.getHeaders(), timeout: 60000 });
    const j = (r && r.data) || {};
    const list = (j.text_score && j.text_score.word_score_list) || [];
    if (j.status && j.status !== 'success') return { words: [], cost: 0, seconds: (Date.now() - started) / 1000, error: String(j.short_message || j.status).slice(0, 120) };
    return {
      words: list.map((w) => ({ word: w.word, quality: Number(w.quality_score) || 0, wrong: (Number(w.quality_score) || 0) < WRONG_BELOW })),
      cost: Math.ceil(audioSeconds / 15) * USD_PER_15S,
      seconds: (Date.now() - started) / 1000,
      error: null,
    };
  } catch (e) {
    return { words: [], cost: 0, seconds: (Date.now() - started) / 1000, error: String(e && e.message || e).slice(0, 160) };
  }
}

module.exports = { scoreText, configured, WRONG_BELOW, USD_PER_15S };
