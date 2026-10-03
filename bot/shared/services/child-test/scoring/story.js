'use strict';
/**
 * Child test (bd-s1oo0.5) — the 60-second story: words correct / attempted and
 * per-word chips.
 *
 * Counts come from Gemini 3.8 Flash hearing the cut clip with the printed text
 * (best MAE of everything the study tried, §3b). Two cross-checks give the
 * chips and the confidence: the Soniox transcript aligned to the text (the
 * study's baseline), and on English SpeechAce (best per-word F1 on English, §7).
 * A chip is pre-ticked only where two scorers agree (§8).
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { cutClip, cleanup } = require('./media');
const { align, refWords, same, clean } = require('./text-norm');
const { wordsIn } = require('./windows');
const speechace = require('./speechace');
const th = require('./thresholds');

const FINISHED_EARLY_BEFORE = 58;

function verdictsFrom(json, n) {
  const out = new Array(n).fill('skipped');
  for (const w of (json && json.words) || []) {
    const i = Number(w.i) - 1;
    if (i >= 0 && i < n && ['correct', 'wrong', 'skipped'].includes(w.v)) out[i] = w.v;
  }
  return out;
}

/**
 * Gemini sometimes marks words the child never reached as WRONG rather than SKIPPED, so a
 * child who said five words "attempted" the whole passage. Nobody attempts more words than
 * they spoke: cap at the words Soniox heard from the child in the window, plus a little slack
 * for words it merged or missed.
 */
const ATTEMPT_SLACK = 2;
function capAttempted(verdicts, spokenCount) {
  if (!Number.isFinite(spokenCount)) return verdicts;
  const cap = spokenCount + ATTEMPT_SLACK;
  return verdicts.map((v, i) => (i >= cap ? 'skipped' : v));
}

function attemptedOf(verdicts) {
  for (let i = verdicts.length - 1; i >= 0; i -= 1) if (verdicts[i] !== 'skipped') return i + 1;
  return 0;
}

/** SpeechAce on two ≤30-s halves, the reference cut to the words reached in each half. */
async function speechAceWrong({ file, window, tokens, aligned, hyp, calls }) {
  if (!speechace.configured()) return null;
  const t0 = window.start; const mid = Math.min(window.end, t0 + 30);
  const timeOf = (i) => (aligned.hypIdx[i] >= 0 ? hyp[aligned.hypIdx[i]].start : null);
  let k1 = 0; let k2 = 0;
  tokens.forEach((_, i) => { const t = timeOf(i); if (t != null && t < mid) k1 = i + 1; if (t != null && t < window.end) k2 = i + 1; });
  const halves = [[0, k1, t0, mid], [k1, k2, mid, window.end]].filter(([a, b, s, e]) => b > a && e - s > 2);
  const wrong = new Array(tokens.length).fill(null);
  const files = [];
  try {
    for (const [a, b, s, e] of halves) {
      const clip = await cutClip(file, s, e, 'wav'); files.push(clip.path);
      const r = await speechace.scoreText(clip.path, tokens.slice(a, b).join(' '), { seconds: e - s });
      calls.push({ job: 'speechace', model: 'speechace:text/v9', cost: r.cost, seconds: r.seconds, error: r.error });
      if (r.error) return null;
      r.words.forEach((w, j) => { if (a + j < b) wrong[a + j] = w.wrong; });
    }
    return { wrong, correct: wrong.filter((x, i) => x === false && i < k2).length };
  } finally { cleanup(files); }
}

/**
 * @returns {{ ok, part, modelVersion, error? }}
 */
async function scoreStory({ lang, spec, file, window, words, coachSpeaker, flags, calls }) {
  const tokens = (spec.tokens && spec.tokens.length) ? spec.tokens : String(spec.text || '').split(/\s+/).filter(Boolean);
  const ref = refWords(tokens);
  const model = modelFor('counts');
  let clip = null;
  try {
    // the study's baseline on the same window: STT words (child only when diarised) aligned to the text
    const hyp = wordsIn(words, window, { excludeSpeaker: coachSpeaker });
    const aligned = align(ref, hyp.map((h) => h.w));
    const alignAtt = (() => { for (let i = aligned.status.length - 1; i >= 0; i -= 1) if (aligned.status[i] !== 'omit') return i + 1; return 0; })();
    const alignCorrect = aligned.status.slice(0, alignAtt).filter((s) => s === 'correct').length;

    // Gemini and SpeechAce are independent: run them side by side (latency budget < 60 s per block)
    clip = await cutClip(file, window.start - 0.5, window.end + 1, 'mp3');
    const [r, sa] = await Promise.all([
      chatJSON({ model, prompt: prompts.STORY({ lang, tokens }), schema: prompts.STORY_SCHEMA, audio: { data: clip.base64, format: 'mp3' }, job: 'child_test.story' }),
      lang === 'english' ? speechAceWrong({ file, window, tokens, aligned, hyp, calls }) : Promise.resolve(null),
    ]);
    calls.push({ job: 'story', model, cost: r.cost, seconds: r.seconds, error: r.error, ...(r.detail ? { detail: r.detail } : {}) });
    if (!r.json) return { ok: false, error: r.error || 'no_json', ...(r.detail ? { detail: r.detail } : {}) };

    const verdicts = capAttempted(verdictsFrom(r.json, tokens.length), hyp.length);
    const attempted = attemptedOf(verdicts);
    const correct = verdicts.slice(0, attempted).filter((v) => v === 'correct').length;

    const flagged = [];
    for (let i = 0; i < attempted; i += 1) {
      if (verdicts[i] === 'correct') continue;
      flagged.push({
        idx: i, word: tokens[i], verdict: verdicts[i] === 'skipped' ? 'skipped' : 'wrong',
        confidence: th.chipConfidence({ gemini: true, alignment: aligned.status[i] !== 'correct', speechace: sa ? sa.wrong[i] === true : null }),
      });
    }

    // finished early: the child reached the last word before the minute was up
    let seconds = Math.min(60, window.end - window.start);
    let finishedEarly = false;
    if (attempted >= tokens.length) {
      const last = clean(tokens[tokens.length - 1]);
      const hit = [...hyp].reverse().find((h) => same(h.w, last));
      const endAt = hit ? hit.end : (hyp.length ? hyp[hyp.length - 1].end : window.end);
      const used = Math.max(1, endAt - window.start);
      if (used < FINISHED_EARLY_BEFORE) { seconds = Math.round(used * 10) / 10; finishedEarly = true; }
    }

    const confidence = th.storyConfidence({ lang, geminiCorrect: correct, alignCorrect, flags, speechaceCorrect: sa ? sa.correct : null });
    return {
      ok: true,
      modelVersion: model,
      part: { words_correct: correct, words_attempted: attempted, seconds, finished_early: finishedEarly, flagged, confidence },
      evidence: { align_correct: alignCorrect, speechace_correct: sa ? sa.correct : null, notes: r.json.notes || null },
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  } finally {
    if (clip) cleanup(clip.path);
  }
}

/**
 * EGRA's stop rule (CONTRACT §9.2): fewer than 5 words right in the first line of the story
 * means the child could not read it, so the coach switched to the 10 letters + 10 words card.
 * Without `story.lines`, a total of 2 or fewer correct stands in for it.
 *
 * A child whose own count is at least twice line 1's length read on past line 1, so nobody stopped
 * them: the model marking line 1 `skipped` is not the stop rule (L24, CR-2: 12 real readers, 20–53
 * words right, were sent to letters + words and their story count hidden).
 */
const FIRST_LINE_MIN_CORRECT = 5;
const NO_LINES_AT_OR_BELOW = 2;
const READ_ON_LINES = 2;
function needsFallback(part, storySpec) {
  const line = storySpec && storySpec.lines && storySpec.lines[0];
  if (!line) return part.words_correct <= NO_LINES_AT_OR_BELOW;
  if (part.words_correct >= READ_ON_LINES * (line.to - line.from + 1)) return false;
  const wrong = new Set((part.flagged || []).map((f) => f.idx));
  let right = 0;
  for (let i = line.from; i <= line.to && i < part.words_attempted; i += 1) if (!wrong.has(i)) right += 1;
  return right < FIRST_LINE_MIN_CORRECT;
}

/** Letters + words for a child who could not read the first line. */
async function scoreFallback({ lang, spec, file, window, calls }) {
  const fb = spec.fallback;
  if (!fb || !(fb.letters || []).length) return { ok: false, error: 'no_fallback_items' };
  const model = modelFor('counts');
  let clip = null;
  try {
    clip = await cutClip(file, window.start - 0.5, window.end + 1, 'mp3');
    const r = await chatJSON({ model, prompt: prompts.FALLBACK({ lang, letters: fb.letters, words: fb.words || [] }), audio: { data: clip.base64, format: 'mp3' }, job: 'child_test.fallback' });
    calls.push({ job: 'fallback', model, cost: r.cost, seconds: r.seconds, error: r.error });
    if (!r.json) return { ok: false, error: r.error || 'no_json' };
    const count = (list) => (list || []).filter((x) => x && x.v === 'correct').length;
    return { ok: true, part: { letters: { correct: count(r.json.letters) }, words: { correct: count(r.json.words) }, confidence: 0.5 } };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  } finally { if (clip) cleanup(clip.path); }
}

module.exports = { scoreStory, scoreFallback, verdictsFrom, attemptedOf, capAttempted, needsFallback };
