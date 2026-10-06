'use strict';
/**
 * v3 `<lang>.story` — the 60-s reading and its comprehension questions in one note (CONTRACT §21.2).
 * The reading is story.js unchanged (Gemini 3.8 Flash with the printed text, Soniox alignment and, in
 * English, SpeechAce as cross-checks); the questions are comprehension.js with the §20 reach rule (reach.js):
 * only questions about text the child reached count. Wrapped here in the v3 shape: per-word items, the clock
 * from the begin line, EGRA's first-line stop, time remaining and the rate.
 * Review (R8 §4): comprehension at bar 0.90 (reached and asked only); Urdu → the coach confirms every count;
 * English → the count when the story confidence is below 0.70.
 */
const { scoreStory } = require('../story');
const { scoreQuestions } = require('../comprehension');
const { reachedQuestions } = require('../reach');
const C = require('./common');

const LANG_NAME = { ur: 'urdu', en: 'english' };
const COMP_BAR = 0.9;
const EN_COUNT_BAR = 0.7;

async function score(ctx) {
  const { task, spec, media, lang, calls } = ctx;
  const story = spec.story || {};
  const tokens = (story.tokens && story.tokens.length) ? story.tokens : String(story.text || '').split(/\s+/).filter(Boolean);
  const words = await C.wordsFor(media, lang, calls);
  const clock = C.findClock({ words, spec, firstItems: tokens.slice(0, 2), beginAtS: media.beginAtS });
  const end = Number.isFinite(media.durationSec) ? media.durationSec : clock.begin_at_s + C.SECONDS + 30;
  const window = { start: clock.begin_at_s, end: Math.min(end, clock.begin_at_s + C.SECONDS) };
  const r = await scoreStory({ lang: LANG_NAME[lang], spec: { ...story, tokens }, file: media.file, window, words, coachSpeaker: clock.coachSpeaker, flags: [], calls });
  if (!r.ok) throw new C.TaskError('story_failed', r.error);
  const part = r.part;

  const wrong = new Set(part.flagged.map((f) => f.idx));
  const items = tokens.map((w, k) => {
    const verdict = k >= part.words_attempted ? 'not_reached' : (wrong.has(k) ? 'wrong' : 'correct');
    return { i: k + 1, ref: w, verdict, heard: '', conf: null, settled: true };
  });
  const line1 = (story.lines || [])[0];
  const stopRes = (spec.stop || {}).type === 'first_line' ? C.applyFirstRowStop(items, line1 ? line1.to - line1.from + 1 : 0) : false;
  const stopped = stopRes === true;
  const remaining = !stopped && part.finished_early ? Math.max(0, Math.round((C.SECONDS - part.seconds) * 10) / 10) : 0;
  const attempted = stopped ? Math.min(part.words_attempted, line1.to + 1) : part.words_attempted;
  const correct = stopped ? 0 : part.words_correct;
  const timed = {
    seconds_given: C.SECONDS, begin_at_s: Math.round(clock.begin_at_s * 10) / 10, end_at_s: Math.round(window.end * 10) / 10, clock: clock.clock,
    time_remaining: remaining, attempted, correct, rate: C.rate(correct, remaining),
  };

  // comprehension (§20): only what the child reached; nothing is asked of a child who was stopped
  const qs = spec.questions || [];
  const reached = stopped ? new Set() : reachedQuestions(spec, { story: { words_attempted: part.words_attempted, finished_early: part.finished_early } });
  let comp = qs.map((q) => ({ id: q.id, verdict: 'none', heard: '', confidence: 0, reached: false, asked: false }));
  let compModel = null;
  if (reached.size) {
    const qWindow = { start: clock.begin_at_s + (part.finished_early ? part.seconds : C.SECONDS), end };
    const got = await scoreQuestions({ lang: LANG_NAME[lang], spec: { questions: qs, story: { text: tokens.join(' ') } }, words, window: qWindow, calls });
    if (!got.ok) throw new C.TaskError('comprehension_failed', got.error);
    compModel = got.modelVersion;
    comp = got.part.map((row) => {
      const isReached = reached.has(row.id);
      return { ...row, reached: isReached, ...(!isReached && row.asked ? { beyond_reach: true } : {}) };
    });
  }
  const counted = comp.filter((q) => q.reached && q.asked);
  const score = { correct: counted.filter((q) => q.verdict === 'correct').length, of: qs.length, asked: counted.length };

  const m = C.marks({ task, spec, timed, score, stopped, items, extra: { comprehension: comp, story_confidence: part.confidence },
    modelVersions: { counts: r.modelVersion, ...(compModel ? { comprehension: compModel } : {}), ...(media.sttModel ? { stt: media.sttModel } : {}) } });
  if (clock.clock !== 'cue') m.flags.push(clock.clock === 'inferred' ? 'no_begin_line' : 'clock_given');
  if (stopRes === 'unclear') m.flags.push('first_row_unclear');
  if (m.quality === 'ai_review') {
    m.review = counted.filter((q) => q.verdict === 'none' || !(q.confidence >= COMP_BAR)).map((q) => `q:${q.id}`);
    if (lang === 'ur' || part.confidence < EN_COUNT_BAR || stopRes === 'unclear') m.count_flag = { reason: stopRes === 'unclear' ? 'first_row_unclear' : 'confirm_count' };
  }
  return m;
}

module.exports = { score };
