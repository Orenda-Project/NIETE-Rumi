'use strict';
/**
 * The read-along timing arithmetic (pure: no I/O), used by scripts/web-quiz/readalong-build.js:
 *
 *   sttWords(tokens)          Soniox async STT tokens → spoken words with times (a token starting with a space starts a word)
 *   match(printed, spoken)    each printed word → the spoken word it is, in order (a small look-ahead skips extra words)
 *   finalize(printed, pairs)  every printed word timed: matched words keep the speech times; a run of missed words is
 *                             spread between its neighbours by character length (never absent, never out of order)
 *   pacePlan(printed, timed)  where to add silence: the middle of the gap after a sentence end / after a clause comma
 *   tempoFor(...)             the pitch-kept slow-down that brings the clip to the wanted words a minute (floor 0.70)
 *   planPace(...)             all of it: pauses + tempo + (short pages) even word gaps, silence given in final-clip ms
 *   timingFile(...)           the stored timing file, with the hash of the words it was made for
 *
 * Why the final clip is aligned rather than the provider's own timestamps carried through the pacing: on the two test
 * passages the carried timestamps sat 100–230 ms early against the acoustic onsets; speech recognition on the final
 * clip sat within about ±60 ms.
 */

const { printedWords, textHash } = require('./web-quiz-readalong');

const SENTENCE_END = /[.!?۔؟]["'”’)]?$/;
const CLAUSE_END = /[,،;:]["'”’)]?$/;

/** Letters and digits only, lower case (Urdu keeps its letters; punctuation and quotes go). */
function norm(w) {
  return String(w || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function sttWords(tokens) {
  const out = [];
  for (const tok of tokens || []) {
    const text = String(tok.text || '');
    if (!out.length || /^\s/.test(text)) {
      if (text.trim()) out.push({ t: text.trim(), s_ms: tok.start_ms, e_ms: tok.end_ms });
    } else {
      out[out.length - 1].t += text;
      out[out.length - 1].e_ms = tok.end_ms;
    }
  }
  return out;
}

/** Edits (insert, delete, change) between two short strings. */
function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let row = Array.from({ length: y.length + 1 }, (_, k) => k);
  for (let i = 1; i <= x.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= y.length; j += 1) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return row[y.length];
}

/** The same word, allowing a recogniser's spelling of a name ("Asad" / "Assad"): 1 edit from 4 letters, 2 from 7. */
function sameWord(a, b) {
  if (a === b) return true;
  const n = Math.min([...a].length, [...b].length);
  if (n < 4) return false;
  return editDistance(a, b) <= (n >= 7 ? 2 : 1);
}

/** [[i, spokenWord|null]] for every printed word; a spoken word is used once, in order, at most `ahead` words on. */
function match(printed, spoken, ahead = 4) {
  const out = [];
  let j = 0;
  printed.forEach((w, i) => {
    const n = norm(w);
    let hit = -1;
    for (let k = j; k < Math.min(j + ahead, spoken.length) && hit < 0; k += 1) if (norm(spoken[k].t) === n) hit = k;
    for (let k = j; k < Math.min(j + 2, spoken.length) && hit < 0; k += 1) if (sameWord(norm(spoken[k].t), n)) hit = k;
    if (hit >= 0) { out.push([i, spoken[hit]]); j = hit + 1; } else out.push([i, null]);
  });
  return out;
}

const GAP_MS = 60;   // between two words of a missed run at the clip's start or end

/**
 * Every printed word with s_ms/e_ms; `src` says 'stt' or 'interp'. A missed run between two heard words shares their
 * gap by character length; a run at the start (or end) is given the speaking rate of the heard words, ending just
 * before the first heard word (starting just after the last), never stretched from 0 or to the clip's end.
 */
function finalize(printed, pairs, endMs) {
  const out = pairs.map(([i, h]) => ({ i, t: printed[i], s_ms: h ? h.s_ms : null, e_ms: h ? h.e_ms : null, src: h ? 'stt' : 'interp' }));
  const rates = out.filter((w) => w.s_ms != null && w.e_ms > w.s_ms).map((w) => (w.e_ms - w.s_ms) / Math.max(1, [...w.t].length)).sort((a, b) => a - b);
  const msPerChar = rates.length ? Math.max(40, rates[rates.length >> 1]) : 80;
  let i = 0;
  while (i < out.length) {
    if (out[i].s_ms != null) { i += 1; continue; }
    let j = i;
    while (j < out.length && out[j].s_ms == null) j += 1;
    const chars = out.slice(i, j).reduce((n, w) => n + [...w.t].length, 0) || 1;
    const est = chars * msPerChar + (j - i) * GAP_MS;
    let a;
    let b;
    if (i > 0 && j < out.length) { a = out[i - 1].e_ms; b = out[j].s_ms; } else if (j < out.length) { b = out[j].s_ms - GAP_MS; a = Math.max(0, b - est); } else {
      a = i > 0 ? out[i - 1].e_ms + GAP_MS : 0;
      b = endMs > a ? Math.min(endMs, a + est) : a + est;
    }
    if (b < a) b = a;
    let t = a;
    for (let k = i; k < j; k += 1) {
      const d = ((b - a) * [...out[k].t].length) / chars;
      out[k].s_ms = Math.round(t);
      out[k].e_ms = Math.round(t + d);
      t += d;
    }
    i = j;
  }
  // monotonic and well-formed whatever the recogniser said
  let prev = 0;
  for (const w of out) {
    if (w.s_ms < prev) w.s_ms = prev;
    if (w.e_ms < w.s_ms) w.e_ms = w.s_ms;
    prev = w.s_ms;
  }
  return out;
}

/** Silence to add: [{ at_ms, add_ms }] at the middle of the gap after each sentence end (and clause comma). */
function pacePlan(printed, timed, { sentenceMs = 700, clauseMs = 250 } = {}) {
  const cuts = [];
  for (let i = 0; i < timed.length - 1; i += 1) {
    const w = printed[i];
    const add = SENTENCE_END.test(w) ? sentenceMs : CLAUSE_END.test(w) ? clauseMs : 0;
    if (add) cuts.push({ i, at_ms: Math.round((timed[i].e_ms + timed[i + 1].s_ms) / 2), add_ms: add });
  }
  return cuts;
}

/** Words a minute from the first word's start to the last word's end. */
function wpmOf(timed) {
  if (!timed.length) return null;
  const ms = timed[timed.length - 1].e_ms - timed[0].s_ms;
  return ms > 0 ? Math.round((timed.length / (ms / 60000)) * 10) / 10 : null;
}

/** The atempo factor (≤ 1 slows) that, with `addedMs` of silence, brings `timed` to `targetWpm`; clamped to [floor, 1]. */
function tempoFor(timed, targetWpm, addedMs, floor = 0.7) {
  const speech = timed[timed.length - 1].e_ms - timed[0].s_ms;
  const want = (timed.length / targetWpm) * 60000;
  const f = speech / Math.max(want - addedMs, 1);
  return Math.max(floor, Math.min(1, f));
}

/**
 * The whole pacing decision: sentence and clause pauses, the tempo, and — when those cannot reach the pace (a short
 * page of one sentence) — an even gap between words (≤ wordMaxMs each). Every `add_ms` is silence in the FINAL clip;
 * the builder inserts add_ms × tempo before slowing, so the slow-down brings it to exactly add_ms.
 */
function planPace(printed, timed, targetWpm, { floor = 0.7, sentenceMs = 700, clauseMs = 250, wordMaxMs = 250 } = {}) {
  const cuts = pacePlan(printed, timed, { sentenceMs, clauseMs });
  const added = cuts.reduce((n, c) => n + c.add_ms, 0);
  const tempo = tempoFor(timed, targetWpm, added, floor);
  const speech = timed[timed.length - 1].e_ms - timed[0].s_ms;
  const want = (timed.length / targetWpm) * 60000;
  const short = want - speech / tempo - added;
  const open = [];
  for (let i = 0; i < timed.length - 1; i += 1) if (!cuts.some((c) => c.i === i)) open.push(i);
  if (short > 0 && open.length) {
    const gap = Math.min(wordMaxMs, Math.round(short / open.length));
    if (gap >= 20) for (const i of open) cuts.push({ i, at_ms: Math.round((timed[i].e_ms + timed[i + 1].s_ms) / 2), add_ms: gap });
    cuts.sort((a, b) => a.at_ms - b.at_ms);
  }
  return { cuts, tempo };
}

/** The words a minute a band is read at. */
const PACE_WPM = Object.freeze({ 1: 90, 2: 100, 3: 110 });

function timingFile({ id, lang, text, audioName, audioMs, words, voice, timingSrc = 'stt_final' }) {
  return {
    v: 1, id, lang, dir: lang === 'ur' ? 'rtl' : 'ltr',
    audio: { url: audioName, ms: Math.round(audioMs), mime: 'audio/ogg; codecs=opus' },
    words: words.map((w) => ({ i: w.i, t: w.t, s_ms: w.s_ms, e_ms: w.e_ms })),
    pace_wpm: wpmOf(words), voice, timing_src: timingSrc, text_hash: textHash(text),
  };
}

module.exports = { norm, editDistance, sameWord, sttWords, match, finalize, pacePlan, planPace, wpmOf, tempoFor, timingFile, PACE_WPM, printedWords, SENTENCE_END, CLAUSE_END };
