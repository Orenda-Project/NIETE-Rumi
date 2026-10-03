'use strict';
/**
 * Child test v2 (bd-s1oo0.46.3, lane L27) — oral maths from ONE voice note (CHILD_TEST_MATHS_MODE=oral,
 * CONTRACT §19). No photo is awaited.
 *
 * The note, as the coach's script runs it (item bank maths.oral.script):
 *   «اب سوال شروع کریں» → compare A–D («ان دونوں میں سے بڑا نمبر کون سا ہے؟»; the child says the bigger
 *   number) → sums 1–4 («اس کا جواب بتائیں»; the child reads the sum off the card and says the answer)
 *   → «اب کہانی والے دو سوال غور سے سنیں» → the coach reads word problem 1, the child answers, word
 *   problem 2, the child answers → «بس، شکریہ». «اگلا» from the coach = the item was not answered.
 *
 * The clock is Soniox's (as for every block). The card part is deterministic: the numbers the child says
 * (number-grammar) are aligned to the eight card items in order. Each word problem's answer window opens
 * after the problem's question sentence; a text grader reads the final answer, cross-checked with the
 * grammar's last number.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { renderTurns } = require('./stt');
const { findPhrase, wordsIn } = require('./windows');
const { clean, same } = require('./text-norm');
const { wordsToNumbers, URDU_1_TO_100 } = require('./number-grammar');

// ------------------------------------------------------------------------------------------- windows

const UR_DIGIT = /[۰-۹]+|\d+/g;
const toWestern = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** A prompt as the coach SAYS it: digits become Urdu number words (Soniox writes what it hears). */
function spoken(text) {
  return String(text || '').replace(UR_DIGIT, (d) => {
    const n = Number(toWestern(d));
    return n >= 1 && n <= 99 ? URDU_1_TO_100[n - 1] : d;
  });
}

function sentencesOf(text) {
  return spoken(text).split(/[۔؟?!]/).map((s) => s.trim()).filter(Boolean);
}

function firstWords(s, n) { return String(s || '').split(/\s+/).slice(0, n).join(' '); }

function firstAnchor(words, phrases, opts) {
  for (const p of phrases.filter(Boolean)) {
    const hit = findPhrase(words, p, opts);
    if (hit) return hit;
  }
  return null;
}

function distinctSpeakers(words) {
  return new Set(words.map((w) => w.speaker).filter((s) => s != null)).size;
}

const PROMPT_MIN_SCORE = 0.6;
const QUESTION_MIN_SCORE = 0.8;

/**
 * Cut the maths note: { windows: { card, word_problems: [w1, w2] }, coachSpeaker, flags, missing, anchors }.
 * card = start cue → word-problem intro (or the first problem, the stop cue, the end of the note).
 * word problem i = the end of its question sentence → the next problem (or the stop cue, the end).
 */
function findOralWindows({ words, cue = {}, oral, durationSec }) {
  const end = Number.isFinite(durationSec) ? durationSec : (words.length ? words[words.length - 1].end + 1 : 0);
  const flags = []; const missing = [];
  const start = firstAnchor(words, [cue.start, ...(cue.alt_start || [])], {});
  if (!start) flags.push('no_cue_phrase');
  const begin = start ? start.end : 0;
  const intro = firstAnchor(words, [cue.word_problems], { after: begin });

  const wps = (oral && oral.word_problems) || [];
  const found = [];
  let after = intro ? intro.end : begin;
  for (const wp of wps) {
    const sents = sentencesOf(wp.prompt_ur);
    const head = sents.length ? findPhrase(words, firstWords(sents[0], 5), { after, minScore: PROMPT_MIN_SCORE }) : null;
    // the question sentence shares most words with the problem's first sentence («آپ کے پاس … بسکٹ ہیں»),
    // so it must match closely; failing that, its last three words («کتنے بسکٹ ہیں») exactly
    const q = sents.length ? sents[sents.length - 1] : '';
    const qAfter = head ? head.end : after;
    const question = q
      ? (findPhrase(words, q, { after: qAfter, minScore: QUESTION_MIN_SCORE })
        || findPhrase(words, q.split(/\s+/).slice(-3).join(' '), { after: qAfter, minScore: 1 }))
      : null;
    found.push({ head, question });
    if (question) after = question.end; else if (head) after = head.end;
  }

  const stops = [cue.stop, ...(cue.alt_stop || [])];
  const lastAt = found.reduce((t, f) => Math.max(t, f.question ? f.question.end : (f.head ? f.head.end : t)), intro ? intro.end : begin);
  const stop = firstAnchor(words, stops, { after: lastAt });
  const tail = stop ? stop.start : end;

  const firstHead = found.map((f) => f.head || f.question).find(Boolean);
  const cardEnd = intro ? intro.start : (firstHead ? firstHead.start : tail);
  const windows = { card: { start: begin, end: Math.max(begin, cardEnd) }, word_problems: [] };
  found.forEach((f, i) => {
    const opened = f.question ? f.question.end : null;
    if (opened == null) { windows.word_problems.push(null); missing.push(`word_problems[${i}]`); return; }
    const next = found.slice(i + 1).map((n) => n.head || n.question).find(Boolean);
    windows.word_problems.push({ start: opened, end: Math.max(opened, next ? next.start : tail) });
  });

  const anchorSpeaker = (start || intro || (firstHead || {})).speaker;
  const coachSpeaker = anchorSpeaker != null && distinctSpeakers(words) > 1 ? anchorSpeaker : null;
  return { windows, coachSpeaker, flags, missing, anchors: { start, intro, word_problems: found, stop } };
}

// ------------------------------------------------------------------------------------------- the card

const NEXT_WORD = clean('اگلا');
const LABEL_WORD = clean('نمبر');
const isNext = (w) => same(w.w, NEXT_WORD);

/**
 * Alignment scores. An answer that fits its item beats every alternative; a wrong number given to the
 * item in front of it (0) beats skipping that item (-0.6) and dropping the number (-0.4), so a wrong
 * answer stays a wrong answer. «اگلا» on an unanswered item is the coach's own "no answer" (+0.3).
 */
const S = { extraNumber: -0.4, extraNext: -0.05, nextNone: 0.3, skip: -0.6 };

// Confidence by how the verdict was reached (calibrated on synthetic notes: golive/lanes/L27/REPORT.md).
const CONF = {
  compareOnly: 0.9,        // only the bigger number said
  compareBoth: 0.7,        // the child read both numbers; the bigger one was said
  compareSmaller: 0.8,     // only the smaller number said
  compareOther: 0.45,      // a number that is neither: a mishearing is as likely as a wrong answer
  sumRight: 0.9,
  sumRightReadAloud: 0.85,
  sumWrong: 0.65,
  noneNext: 0.85,          // the coach moved on
  noneSilent: 0.6,         // nothing heard for this item, the coach did not say «اگلا»
  noneEmpty: 0.3,          // the note has no words at all
};

function operands(prompt) {
  return (String(prompt || '').match(/\d+/g) || []).map(Number);
}

/** Card events in time order: numbers the child said, and the coach's «اگلا». */
function cardEvents(words, window, coachSpeaker) {
  const inCard = wordsIn(words, window);
  const child = inCard.filter((w) => !coachSpeaker || w.speaker !== coachSpeaker);
  const nums = wordsToNumbers(child.map((w) => w.raw || w.w))
    .filter((n) => !(n.from > 0 && same(child[n.from - 1].w, LABEL_WORD)))      // «نمبر ایک»: a label, not an answer
    .map((n) => ({ type: 'num', value: n.value, t: child[n.from].start }));
  const nexts = inCard.filter(isNext).map((w) => ({ type: 'next', t: w.start }));
  return [...nums, ...nexts].sort((a, b) => a.t - b.t);
}

/** Score one run of numbers given to one item; null when the run cannot be this item's answer. */
function answerRun(item, vals) {
  if (item.kind === 'compare') {
    const pair = [Number(item.a), Number(item.b)];
    const big = Math.max(...pair);
    const inPair = vals.every((v) => pair.includes(v));
    if (vals.length === 1 && !inPair) return { score: -0.1, verdict: 'wrong', heard: vals[0], confidence: CONF.compareOther };
    if (!inPair || vals.length > 3) return null;
    if (vals.includes(big)) {
      const only = vals.every((v) => v === big);
      return { score: 1 - 0.1 * (vals.length - 1), verdict: 'correct', heard: big, confidence: only ? CONF.compareOnly : CONF.compareBoth };
    }
    return { score: 0.3, verdict: 'wrong', heard: vals[vals.length - 1], confidence: CONF.compareSmaller };
  }
  const ans = Number(item.answer);
  const last = vals[vals.length - 1];
  const right = last === ans;
  // a wrong answer near the right one is a child's slip; one far from it more likely belongs to another item
  const wrongScore = Math.abs(last - ans) <= Math.max(10, ans / 2) ? 0 : -0.3;
  if (vals.length === 1) return { score: right ? 1 : wrongScore, verdict: right ? 'correct' : 'wrong', heard: last, confidence: right ? CONF.sumRight : CONF.sumWrong };
  if (vals.length > 3) return null;
  const ops = operands(item.prompt);
  const prefix = vals.slice(0, -1);
  if (!prefix.some((v, k) => v === ops[k] || ops.includes(v))) return null;    // read aloud: the prefix is the sum's own numbers
  return { score: (right ? 1 : wrongScore) + 0.05 * prefix.length, verdict: right ? 'correct' : 'wrong', heard: last, confidence: right ? CONF.sumRightReadAloud : CONF.sumWrong };
}

/**
 * Compare A–D then sums 1–4, in card order → { compare: rows, sums: rows } with rows
 * { id, verdict: correct|wrong|none, heard, confidence }.
 */
function scoreOralCard({ words, cut, oral, coachSpeaker = cut && cut.coachSpeaker }) {
  const items = [
    ...((oral && oral.compare) || []).map((c) => ({ ...c, kind: 'compare' })),
    ...((oral && oral.sums) || []).map((s) => ({ ...s, kind: 'sum' })),
  ];
  const ev = cut && cut.windows && cut.windows.card ? cardEvents(words || [], cut.windows.card, coachSpeaker) : [];
  const n = items.length; const m = ev.length;
  const NEG = -Infinity;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(NEG));
  const back = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(null));
  dp[0][0] = 0;
  const relax = (i, j, s, step) => { if (s > dp[i][j]) { dp[i][j] = s; back[i][j] = step; } };
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const s = dp[i][j];
      if (s === NEG) continue;
      if (j < m) relax(i, j + 1, s + (ev[j].type === 'num' ? S.extraNumber : S.extraNext), { from: [i, j], t: 'extra' });
      if (i === n) continue;
      relax(i + 1, j, s + S.skip, { from: [i, j], t: 'skip' });
      if (j < m && ev[j].type === 'next') relax(i + 1, j + 1, s + S.nextNone, { from: [i, j], t: 'next' });
      const vals = [];
      for (let k = j; k < Math.min(m, j + 3) && ev[k].type === 'num'; k += 1) {
        vals.push(ev[k].value);
        const r = answerRun(items[i], vals);
        if (r) relax(i + 1, k + 1, s + r.score, { from: [i, j], t: 'answer', r });
      }
    }
  }
  const rows = new Array(n).fill(null);
  for (let i = n, j = m; back[i][j];) {
    const st = back[i][j]; const [pi] = st.from;
    if (pi < i) {
      const it = items[pi];
      if (st.t === 'answer') rows[pi] = { id: it.id, verdict: st.r.verdict, heard: String(st.r.heard), confidence: st.r.confidence };
      else if (st.t === 'next') rows[pi] = { id: it.id, verdict: 'none', heard: '', confidence: CONF.noneNext };
      else rows[pi] = { id: it.id, verdict: 'none', heard: '', confidence: (words || []).length ? CONF.noneSilent : CONF.noneEmpty };
    }
    [i, j] = st.from;
  }
  const out = rows.map((r, k) => r || { id: items[k].id, verdict: 'none', heard: '', confidence: CONF.noneEmpty });
  const nc = ((oral && oral.compare) || []).length;
  return { compare: out.slice(0, nc), sums: out.slice(nc) };
}

// ------------------------------------------------------------------------------------ word problems

/** The child's final spoken number in a word list (counting aloud before it is not the answer). */
function lastNumber(childWords) {
  const nums = wordsToNumbers(childWords.map((w) => w.raw || w.w));
  return nums.length ? nums[nums.length - 1].value : null;
}

/** Both word problems → rows { id, verdict, heard, confidence }; one text-grader call per answered problem. */
async function scoreOralWordProblems({ words, cut, oral, calls }) {
  const wps = (oral && oral.word_problems) || [];
  const coach = cut.coachSpeaker;
  const model = modelFor('word_problem');
  let modelUsed = null;
  const rows = await Promise.all(wps.map(async (wp, i) => {
    const w = cut.windows.word_problems[i];
    if (!w) return { id: wp.id, verdict: 'none', heard: '', confidence: 0 };   // the problem was not found: the coach decides
    const inside = wordsIn(words, w);
    const child = inside.filter((x) => !coach || x.speaker !== coach);
    const grammar = lastNumber(child);
    if (grammar == null) {
      const moved = inside.some(isNext);
      return { id: wp.id, verdict: 'none', heard: '', confidence: moved ? CONF.noneNext : (child.length ? 0.7 : CONF.noneSilent) };
    }
    const r = await chatJSON({
      model, job: 'child_test.word_problem', maxTokens: 800,
      prompt: prompts.WORD_PROBLEM({ prompt: wp.prompt_ur || wp.prompt_en, answer: wp.answer, transcript: renderTurns(words, w.start, w.end) }),
    });
    calls.push({ job: 'word_problem', model, cost: r.cost, seconds: r.seconds, error: r.error });
    if (r.json) modelUsed = model;
    const raw = r.json && r.json.answer != null && r.json.answer !== 'null' ? String(r.json.answer).replace(/[^\d۰-۹-]/g, '') : '';
    const llm = raw ? Number(toWestern(raw)) : NaN;
    let ans; let confidence;
    if (Number.isFinite(llm)) { ans = llm; confidence = llm === grammar ? 0.85 : 0.6; }
    else { ans = grammar; confidence = r.json ? 0.5 : 0.55; }
    return { id: wp.id, verdict: ans === Number(wp.answer) ? 'correct' : 'wrong', heard: String(ans), confidence };
  }));
  return { rows, modelVersion: modelUsed };
}

module.exports = { findOralWindows, scoreOralCard, scoreOralWordProblems, cardEvents, spoken, CONF };
