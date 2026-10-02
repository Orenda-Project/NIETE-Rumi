'use strict';
/**
 * Child test (bd-s1oo0.5) — first sounds and made-up words.
 *
 * First sounds are marked by the coach; the AI verdict is a hint only (the
 * assembler caps its confidence). Made-up words: Gemini on the clip, its
 * confidence capped at 0.6 until a second scorer agrees. On English SpeechAce
 * scores the list (quality < 40 = wrong); agreement raises the confidence,
 * disagreement lowers it. On Urdu the second hearer is the Soniox transcript of
 * the same window (the one the story chips vote with): where it heard the same
 * word Gemini reports (letter for letter after folding: one changed letter is the
 * very error being marked), and Gemini itself was sure, the mark clears the bar.
 * L16 (bd-s1oo0.21), 12 synthetic children, 2 Gemini runs: both hearers agree
 * 98% right (n 40) vs 91% when they do not (n 80); Gemini < 0.9: 57% (n 7).
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { cutClip, cleanup } = require('./media');
const speechace = require('./speechace');
const { align, refWords, clean } = require('./text-norm');
const { wordsIn } = require('./windows');

const V = new Set(['correct', 'wrong', 'none']);
const CAP_ONE_SCORER = 0.6;
const URDU_SELF_SURE = 0.9;
const URDU_TWO_HEARERS = 0.85;

/**
 * Urdu made-up words: does the transcript, aligned to the card, hear at each item the word Gemini
 * says it heard? Agreement (and Gemini sure of itself) → URDU_TWO_HEARERS; otherwise the one-scorer cap.
 * A 'none' (no attempt heard) has nothing to agree on, so it keeps the cap.
 */
function urduSecondHearer(nw, nonwords, words, window) {
  if (!window || !Array.isArray(words) || !words.length) return nw;
  const hyp = wordsIn(words, window).map((h) => h.w);
  if (!hyp.length) return nw;
  const aligned = align(refWords(nonwords.map((n) => n.text)), hyp);
  return nw.map((x) => {
    const i = nonwords.findIndex((n) => n.id === x.id);
    if (i < 0 || x.verdict === 'none' || x.raw < URDU_SELF_SURE) return x;
    const sttWord = aligned.hypIdx[i] >= 0 ? hyp[aligned.hypIdx[i]] : '';
    return sttWord && clean(x.heard) === sttWord ? { ...x, confidence: URDU_TWO_HEARERS } : x;
  });
}

async function scorePhonics({ lang, spec, file, windows, words, calls }) {
  const firstSounds = lang === 'urdu' ? (spec.first_sounds || []) : [];
  const nonwords = spec.nonwords || [];
  const start = (windows.first_sounds || windows.nonwords || {}).start;
  const end = (windows.nonwords || windows.first_sounds || {}).end;
  if (start == null || end == null) return { ok: false, error: 'no_window' };
  const model = modelFor('phonics');
  const files = [];
  try {
    const clip = await cutClip(file, start - 0.5, end + 0.5, 'mp3'); files.push(clip.path);
    const r = await chatJSON({ model, job: 'child_test.phonics', prompt: prompts.PHONICS({ lang, firstSounds, nonwords }), audio: { data: clip.base64, format: 'mp3' } });
    calls.push({ job: 'phonics', model, cost: r.cost, seconds: r.seconds, error: r.error });
    if (!r.json) return { ok: false, error: r.error || 'no_json' };
    const rows = (list) => (list || []).filter((x) => x && x.id && V.has(x.verdict))
      .map((x) => ({ id: x.id, verdict: x.verdict, heard: String(x.heard || ''), confidence: Number(x.confidence) || 0.5 }));
    const fs = rows(r.json.first_sounds);
    let nw = rows(r.json.nonwords).map((x) => ({ ...x, raw: x.confidence, confidence: Math.min(x.confidence, CAP_ONE_SCORER) }));
    if (lang === 'urdu' && nonwords.length) nw = urduSecondHearer(nw, nonwords, words, windows.nonwords);

    if (lang === 'english' && nonwords.length && windows.nonwords && speechace.configured()) {
      const w = windows.nonwords;
      const wav = await cutClip(file, w.start, Math.min(w.end, w.start + 30), 'wav'); files.push(wav.path);
      const sa = await speechace.scoreText(wav.path, nonwords.map((n) => n.text).join(' '), { seconds: Math.min(30, w.end - w.start) });
      calls.push({ job: 'speechace_nonwords', model: 'speechace:text/v9', cost: sa.cost, seconds: sa.seconds, error: sa.error });
      if (!sa.error && sa.words.length) {
        nw = nw.map((x) => {
          const i = nonwords.findIndex((n) => n.id === x.id);
          const s = sa.words[i];
          if (!s || x.verdict === 'none') return x;
          const saVerdict = s.wrong ? 'wrong' : 'correct';
          return { ...x, confidence: saVerdict === x.verdict ? 0.75 : 0.35 };
        });
      }
    }
    nw = nw.map(({ raw, ...x }) => x);
    return { ok: true, part: { first_sounds: fs, nonwords: nw }, modelVersion: model };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  } finally { cleanup(files); }
}

module.exports = { scorePhonics };
