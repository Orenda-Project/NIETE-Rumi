'use strict';
/**
 * Child test (bd-s1oo0.5) — cut one block's voice note into its pieces.
 *
 * The study found that the clock must come from speech-to-text: every audio
 * model's own timestamps drifted 20–75 s, while Soniox's were exact to the
 * second (HARNESS_RESULTS §5). So windows are found on the Soniox word list:
 *
 *   1. the coach's cue phrases from the item bank (`cue.<block>.*`), and
 *   2. the items themselves — the coach reads each comprehension question and
 *      each first-sound word aloud, so their text is an anchor too.
 *
 * Anything this cannot find is returned in `missing`; the caller then asks the
 * fallback labeller (labeller.js) for just those sections.
 *
 * A timed minute starts at the END of the start cue (the coach starts the timer
 * as they say it) and lasts 60 s, cut short by the stop cue or the next section.
 */

const { clean, same } = require('./text-norm');

const TIMED_SECONDS = 60;
const SECTIONS = {
  urdu: ['story', 'questions', 'first_sounds', 'nonwords'],
  english: ['story', 'questions', 'nonwords'],
  maths: ['numbers', 'quick_sums', 'word_problem'],
};
// Words the coach may say inside a timed minute without it counting as prompting
// (the cue itself, "carry on", "louder"). Short and neutral on purpose.
const PROMPTING_MIN_WORDS = 3;
const PROMPT_MIN_SCORE = 0.75;
const OPENING_SECONDS = 5;

/**
 * First place `phrase` is spoken after `after` seconds: the words of the phrase,
 * in order, inside a window a little longer than the phrase. Returns
 * { start, end, speaker, idx, lastIdx, score } or null.
 */
function findPhrase(words, phrase, { after = -1, before = Infinity, minScore } = {}) {
  const target = String(phrase || '').split(/\s+/).map(clean).filter(Boolean);
  if (!target.length || !words || !words.length) return null;
  const need = minScore != null ? minScore : (target.length <= 2 ? 1 : 0.6);
  const span = target.length + 2;
  // a spoken phrase is said in one breath: its words may not straddle a long gap
  const maxSeconds = target.length * 1.2 + 2;
  for (let j = 0; j < words.length; j += 1) {
    if (words[j].start < after || words[j].start > before) continue;
    if (!same(words[j].w, target[0]) && target.length <= 2) continue;
    let k = 0; let first = -1; let last = -1;
    for (let x = j; x < Math.min(words.length, j + span) && k < target.length && words[x].start - words[j].start <= maxSeconds; x += 1) {
      // advance through the target until this word matches one of the next two
      for (let look = k; look < Math.min(target.length, k + 2); look += 1) {
        if (same(words[x].w, target[look])) {
          if (first < 0) first = x;
          last = x; k = look + 1;
          break;
        }
      }
    }
    const matched = last >= 0 ? countMatched(words, first, last, target) : 0;
    if (first === j && matched / target.length >= need) {
      return { start: words[first].start, end: words[last].end, speaker: words[first].speaker, idx: first, lastIdx: last, score: matched / target.length };
    }
  }
  return null;
}

function countMatched(words, first, last, target) {
  // (bounded by the caller's span and time window)
  let k = 0; let n = 0;
  for (let x = first; x <= last; x += 1) {
    for (let look = k; look < Math.min(target.length, k + 2); look += 1) {
      if (same(words[x].w, target[look])) { n += 1; k = look + 1; break; }
    }
  }
  return n;
}

function firstAnchor(words, phrases, opts) {
  for (const p of phrases.filter(Boolean)) {
    const hit = findPhrase(words, p, opts);
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {object} p
 * @param {Array}  p.words       wordsFromTokens(soniox tokens)
 * @param {string} p.block       'urdu' | 'english' | 'maths'
 * @param {object} p.form        FORM from the item bank
 * @param {object} p.cue         item bank cue for this block
 * @param {number} p.durationSec length of the voice note
 * @returns {{ windows, missing, flags, coachSpeaker, anchors }}
 */
function findCueWindows({ words, block, form, cue = {}, durationSec }) {
  const end = Number.isFinite(durationSec) ? durationSec : (words.length ? words[words.length - 1].end + 1 : 0);
  const spec = (form && form[block]) || {};
  const anchors = {};
  const flags = [];

  if (block === 'maths') {
    const numbersCue = firstAnchor(words, [cue.numbers], {});
    anchors.numbers = numbersCue || (words.length ? { start: 0, end: 0, speaker: null, implicit: true } : null);
    const qsCues = [cue.quick_sums, ...starts(cue)];
    let qs = firstAnchor(words, qsCues, { after: numbersCue ? numbersCue.end : -1 });
    // The start cue marks the quick-sums minute (item bank note), but a coach may also say it to
    // open the block. Said in the first seconds, before any numbers cue, it opened the numbers;
    // the minute then starts at a LATER cue, or the labeller finds it.
    if (qs && !numbersCue && qs.start < OPENING_SECONDS && (spec.numbers || []).length) {
      anchors.numbers = qs;
      qs = firstAnchor(words, qsCues, { after: qs.end + 1 });
    }
    anchors.quick_sums = qs;
    const wpAfter = anchors.quick_sums ? anchors.quick_sums.end + 5 : -1;
    anchors.word_problem = firstAnchor(words, [cue.word_problem, firstWords(spec.word_problem && spec.word_problem.prompt_ur, 5)], { after: wpAfter });
  } else {
    anchors.story = firstAnchor(words, starts(cue), {});
    const qAfter = anchors.story ? anchors.story.end + 5 : -1;
    const qs = spec.questions || [];
    // A question shares words with the story it is about, so its prompt must match closely.
    anchors.questions = firstAnchor(words, [cue.questions], { after: qAfter })
      || (qs[0] ? findPhrase(words, qs[0].prompt, { after: qAfter, minScore: PROMPT_MIN_SCORE }) : null);
    const lastQ = lastQuestionAnchor(words, qs, anchors.questions);
    if (block === 'urdu') {
      const fsAfter = lastQ ? lastQ.end : (anchors.questions ? anchors.questions.end : qAfter);
      const fs = spec.first_sounds || [];
      anchors.first_sounds = firstAnchor(words, [cue.first_sounds, fs[0] && fs[0].word], { after: fsAfter });
      const nwAfter = anchors.first_sounds ? anchors.first_sounds.end : fsAfter;
      anchors.nonwords = firstAnchor(words, [cue.nonwords], { after: nwAfter });
    } else {
      const nwAfter = lastQ ? lastQ.end : (anchors.questions ? anchors.questions.end : qAfter);
      anchors.nonwords = firstAnchor(words, [cue.nonwords], { after: nwAfter });
    }
  }

  const order = SECTIONS[block] || [];
  const missing = order.filter((s) => !anchors[s]);
  if (block !== 'maths' && !anchors.story) flags.push('no_cue_phrase');
  if (block === 'maths' && !anchors.quick_sums) flags.push('no_cue_phrase');

  // Section i runs from its anchor to the next found anchor (or the end of the note).
  const windows = {};
  order.forEach((s, i) => {
    const a = anchors[s];
    if (!a) return;
    const nextStart = order.slice(i + 1).map((n) => anchors[n]).filter(Boolean).map((n) => n.start)[0];
    const sectionEnd = nextStart != null ? nextStart : end;
    const timed = s === 'story' || s === 'quick_sums';
    const start = timed ? a.end : (a.implicit ? 0 : a.start);
    windows[s] = { start, end: sectionEnd };
    if (timed) {
      const stop = findStop(words, cue, a.speaker, { after: start, before: start + TIMED_SECONDS + 20 });
      const limit = start + TIMED_SECONDS;
      let tEnd = Math.min(limit, sectionEnd);
      if (stop && stop.start < tEnd) tEnd = stop.start;
      windows[s] = { start, end: tEnd, sectionEnd };
    }
  });

  const coachSpeaker = (anchors.story || anchors.quick_sums || anchors.questions || {}).speaker || null;

  for (const s of ['story', 'quick_sums']) {
    const w = windows[s];
    if (!w) continue;
    const inside = words.filter((x) => x.start >= w.start && x.end <= w.end + 0.2);
    if (coachSpeaker && distinctSpeakers(words) > 1) {
      const coachWords = inside.filter((x) => x.speaker === coachSpeaker);
      if (coachWords.length >= PROMPTING_MIN_WORDS) pushOnce(flags, 'prompting_during_timed_minute');
    }
    // The minute was cut short (stop cue, next section, or the note ended) while the
    // child had not reached the end of the text: the timer did not run its 60 s.
    const length = w.end - w.start;
    const childInside = inside.filter((x) => !coachSpeaker || x.speaker !== coachSpeaker);
    if (length < TIMED_SECONDS - 5 && childInside.length && !reachedEnd(s, childInside, spec)) {
      pushOnce(flags, 'timer_problem');
    }
  }

  return { windows, missing, flags, coachSpeaker, anchors };
}

function starts(cue) { return [cue.start, ...(cue.alt_start || [])].filter(Boolean); }

/**
 * The stop cue, said by the coach. "بس" and "شکریہ" are ordinary words a child can say
 * mid-story, so when the recording is diarised only the cue speaker's words count.
 */
function findStop(words, cue, coachSpeaker, range) {
  const phrases = [cue.stop, ...(cue.alt_stop || [])].filter(Boolean);
  const diarised = coachSpeaker && distinctSpeakers(words) > 1;
  const pool = diarised ? words.filter((w) => w.speaker === coachSpeaker) : words;
  let best = null;
  for (const p of phrases) {
    const hit = findPhrase(pool, p, range);
    if (hit && (!best || hit.start < best.start)) best = hit;
  }
  return best;
}

function reachedEnd(section, childWords, spec) {
  if (section !== 'story' || !spec.story) return false;
  const toks = (spec.story.tokens || []).map(clean);
  const lastTok = toks[toks.length - 1];
  return childWords.slice(-3).some((x) => same(x.w, lastTok));
}

function lastQuestionAnchor(words, qs, first) {
  if (!first) return null;
  let last = first;
  for (const q of qs.slice(1)) {
    const hit = findPhrase(words, q.prompt, { after: last.end, minScore: PROMPT_MIN_SCORE });
    if (hit) last = hit;
  }
  return last;
}

function firstWords(text, n) {
  if (!text) return null;
  return String(text).split(/\s+/).slice(0, n).join(' ');
}

function distinctSpeakers(words) {
  return new Set(words.map((w) => w.speaker).filter((s) => s != null)).size;
}

function pushOnce(arr, v) { if (!arr.includes(v)) arr.push(v); }

/**
 * After the labeller has filled gaps, put the sections back in order: a section never runs
 * past the start of the next one, and an untimed section the labeller found runs to the next
 * section (or the end of the note) rather than stopping at the labeller's guess.
 */
function reconcileWindows(block, windows, durationSec) {
  const order = (SECTIONS[block] || []).filter((s) => windows[s]);
  order.forEach((s, i) => {
    const w = windows[s];
    const later = order.slice(i + 1).map((n) => windows[n].start).filter((t) => t > w.start);
    const next = later.length ? Math.min(...later) : (Number.isFinite(durationSec) ? durationSec : w.end);
    const timed = s === 'story' || s === 'quick_sums';
    if (timed) w.end = Math.min(w.end, next);
    else if (w.source === 'labeller') w.end = next;
    else w.end = Math.min(w.end, next);
    if (timed && w.sectionEnd != null) w.sectionEnd = Math.min(w.sectionEnd, next);
  });
  return windows;
}

/**
 * Last resort when neither a cue nor the labeller placed a timed minute: the note opens with
 * the cue in some form the transcript did not recognise (an Urdu cue in an English-forced
 * transcript comes out as Latin noise), so start after a short opening utterance; a note that
 * opens straight into reading starts at its first word. Always flagged no_cue_phrase upstream.
 */
const OPENING_MAX_WORDS = 5;
function defaultTimedWindow(words, durationSec) {
  if (!words || !words.length) return null;
  let k = 1;
  while (k < words.length && words[k].speaker === words[0].speaker && words[k].start - words[k - 1].end < 0.8) k += 1;
  const opening = words[0].start < OPENING_SECONDS && k <= OPENING_MAX_WORDS && k < words.length;
  const start = opening ? words[k - 1].end : words[0].start;
  const end = Number.isFinite(durationSec) ? Math.min(start + TIMED_SECONDS, durationSec) : start + TIMED_SECONDS;
  return { start, end, source: 'default' };
}

/** Words inside a window, optionally without the coach. */
function wordsIn(words, w, { excludeSpeaker } = {}) {
  if (!w) return [];
  return words.filter((x) => x.start >= w.start - 0.2 && x.start < w.end && (!excludeSpeaker || x.speaker !== excludeSpeaker));
}

module.exports = { findCueWindows, findPhrase, wordsIn, reconcileWindows, defaultTimedWindow, SECTIONS, TIMED_SECONDS };
