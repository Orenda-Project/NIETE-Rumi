'use strict';
/**
 * Child test v3 (bd-s1oo0.50.3, lane L37, CONTRACT §21.5) — what every task scorer shares: the clock, the
 * EGRA/EGMA stop rules, the fluency rate, the R8 review rules and the ai-marks-v3 shape.
 *
 * Clock (timed tasks). The 60 s start at the END of the bank's begin line (the coach starts the timer as
 * they say it; the same rule as windows.js), found by the cue matcher on the Soniox words. No begin line:
 * the first item response starts it, flagged `clock: 'inferred'`. Practice before the clock is ignored.
 *
 * Fluency (EGRA Toolkit §10.3, EGMA Toolkit p.46): rate = correct / (60 − time_remaining) × 60, where
 * time_remaining > 0 only for a child who finished every item before the minute was up.
 *
 * Stop rules (Toolkit p.109, EGMA Toolkit p.11):
 *   first_row / first_line   nothing right in the first row (letters 10, words 5) or the story's first line:
 *                            the child is auto-stopped and scores 0; every later item is not_reached.
 *   consecutive_errors (4)   untimed EGMA: after 4 errors in a row (wrong or no answer: EGMA scores a
 *                            5-second silence incorrect), every later item is not_reached.
 *
 * Review (R8 §4): only for `ai_review` tasks; `provisional` and `ai` tasks never go to the coach.
 */

const stt = require('../stt');
const { renderTurns } = require('../stt');
const { findPhrase } = require('../windows');
const { clean, same } = require('../text-norm');

const VERSION = 'ai-marks-v3';
const SECONDS = 60;
const STT_LANGUAGE = { ur: 'ur', en: 'en', ma: 'ur' };
const CONSECUTIVE_DEFAULT = 4;

class TaskError extends Error {
  constructor(reason, detail) { super(reason); this.reason = reason; this.detail = detail; }
}

const round1 = (x) => Math.round(x * 10) / 10;

/** EGRA Toolkit §10.3: correct per minute, from the time the child actually used. */
function rate(correct, timeRemaining = 0) {
  const used = SECONDS - (Number(timeRemaining) || 0);
  if (!(used > 0) || !correct) return 0;
  return round1((correct / used) * SECONDS);
}

// ------------------------------------------------------------------ speech-to-text

async function wordsFor(media, lang, calls) {
  if (Array.isArray(media.words)) return media.words;
  let res;
  try {
    res = await stt.transcribe(media.file, STT_LANGUAGE[lang] || 'ur', media.durationSec);
  } catch (e) {
    throw new TaskError('stt_failed', String(e && e.message || e).slice(0, 200));
  }
  calls.push({ job: 'stt', model: res.model, cost: res.cost, seconds: res.seconds, error: null });
  media.words = res.words;
  media.sttModel = res.model;
  return res.words;
}

// ------------------------------------------------------------------ the clock

/** The begin line(s) in the bank, both languages (the coach may give it in either). */
function beginLines(spec) {
  const sc = (spec && spec.script) || {};
  const keys = Object.keys(sc).filter((k) => /^(begin|start)/i.test(k));
  const out = [];
  for (const k of keys) {
    const v = sc[k];
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') out.push(...[v.ur, v.en].filter(Boolean));
  }
  return out;
}

const distinctSpeakers = (words) => new Set(words.map((w) => w.speaker).filter((s) => s != null)).size;

/**
 * { begin_at_s, clock: 'cue'|'inferred', coachSpeaker }.
 * `firstItems` (cleaned item strings) let an inferred clock prefer the child's first item response.
 */
function findClock({ words, spec, firstItems = [], beginAtS = null }) {
  if (Number.isFinite(beginAtS)) return { begin_at_s: beginAtS, clock: 'given', coachSpeaker: null };
  let hit = null;
  for (const line of beginLines(spec)) {
    const h = findPhrase(words, line, {});
    if (h && (!hit || h.start < hit.start)) hit = h;
  }
  if (hit) {
    const coachSpeaker = hit.speaker != null && distinctSpeakers(words) > 1 ? hit.speaker : null;
    return { begin_at_s: hit.end, clock: 'cue', coachSpeaker };
  }
  // No begin line: the child's first item response. The note opens with the coach, so with two speakers
  // the first word from the OTHER speaker is the child's; an item word heard first wins outright.
  const targets = firstItems.map(clean).filter(Boolean);
  const opener = words.length && distinctSpeakers(words) > 1 ? words[0].speaker : null;
  const first = words.find((w) => targets.some((t) => same(w.w, t)))
    || (opener != null ? words.find((w) => w.speaker !== opener) : null) || words[0];
  return { begin_at_s: first ? first.start : 0, clock: 'inferred', coachSpeaker: null };
}

/** A child who answered every item: the seconds left on the clock after their last word (else 0). */
function timeRemaining({ words, begin, coachSpeaker, finished }) {
  if (!finished) return 0;
  const end = begin + SECONDS;
  const child = words.filter((w) => w.start >= begin && w.start < end && (coachSpeaker == null || w.speaker !== coachSpeaker));
  if (!child.length) return 0;
  const last = Math.min(end, child[child.length - 1].end);
  return Math.max(0, round1(SECONDS - (last - begin)));
}

// ------------------------------------------------------------------ verdicts

const LETTER_VERDICT = { c: 'correct', w: 'wrong', n: 'none', s: 'not_reached', correct: 'correct', wrong: 'wrong', skipped: 'not_reached', none: 'none', no_answer: 'none' };

/**
 * Timed items from model letters → rows. A position the model calls skipped BEFORE the child's last attempt
 * was passed over, which EGRA marks wrong; after it, the item was not reached.
 */
function timedRows(raw, refs) {
  const v = refs.map((_, k) => LETTER_VERDICT[raw[k] && raw[k].v] || 'not_reached');
  let attempted = 0;
  v.forEach((x, k) => { if (x !== 'not_reached') attempted = k + 1; });
  return refs.map((ref, k) => {
    let verdict = v[k];
    if (verdict === 'not_reached' && k < attempted) verdict = 'wrong';
    const r = raw[k] || {};
    return { i: k + 1, ref, verdict, heard: String(r.heard || ''), conf: confOf(r.conf), settled: verdict !== 'none' };
  });
}

function confOf(c) {
  const n = Number(c);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 100) / 100)) : null;
}

/** Untimed items: "s" (never asked) is not_reached; "n" (no audible answer) is none and unsettled. */
function untimedRows(raw, refs) {
  return refs.map((ref, k) => {
    const r = raw[k] || {};
    const verdict = LETTER_VERDICT[r.v] || 'none';
    return { i: k + 1, ref, verdict, heard: String(r.heard || ''), conf: confOf(r.conf), settled: verdict !== 'none' };
  });
}

/** The model's items array indexed by position (its `i` when given). */
function byPosition(list, n) {
  const out = new Array(n).fill(null);
  (list || []).forEach((it, j) => {
    const k = Number.isInteger(Number(it && it.i)) && Number(it.i) >= 1 ? Number(it.i) - 1 : j;
    if (k >= 0 && k < n && !out[k]) out[k] = it;
  });
  return out;
}

// ------------------------------------------------------------------ stop rules

/**
 * EGRA auto-stop: nothing right in the first `n` items → the rest are not_reached. Mutates rows.
 * Returns true (stopped), false, or 'unclear': the model marks row 1 all wrong yet the child got a whole
 * row's worth right after it. The coach applies this rule live, so a child who read on was not stopped:
 * row 1 is the model's error (May re-measure: a G3 reader keyed 83 was zeroed). Nothing is cut; the
 * caller flags the count for the coach (the same reasoning as story.js needsFallback, L24).
 */
function applyFirstRowStop(rows, n) {
  if (!n || !rows.length) return false;
  const head = rows.slice(0, n);
  if (head.some((r) => r.verdict === 'correct')) return false;
  if (!head.some((r) => r.verdict !== 'not_reached')) return false;     // the child never started: nothing to stop
  if (rows.slice(n).filter((r) => r.verdict === 'correct').length >= n) return 'unclear';
  for (const r of rows.slice(n)) if (r.verdict !== 'not_reached') { r.verdict = 'not_reached'; r.after_stop = true; r.settled = true; }
  return true;
}

/** EGMA: `n` errors in a row → every later item not_reached. Mutates rows; returns { stopped, at }. */
function applyConsecutiveStop(rows, n = CONSECUTIVE_DEFAULT) {
  let run = 0;
  for (let k = 0; k < rows.length; k += 1) {
    const v = rows[k].verdict;
    if (v === 'not_reached') break;
    run = (v === 'wrong' || v === 'none') ? run + 1 : 0;
    if (run >= n) {
      for (const r of rows.slice(k + 1)) {
        if (r.verdict !== 'not_reached') { r.after_stop = true; }
        r.verdict = 'not_reached'; r.settled = true;
      }
      return { stopped: k + 1 < rows.length, at: k + 1 };
    }
  }
  return { stopped: false, at: null };
}

// ------------------------------------------------------------------ review (R8 §4)

/** Per kind: which settled-but-doubtful items go to the coach too (beyond every unsettled one). */
const CONF_BAR = { listening: 0.9, number_id: 0.65 };

function reviewItems(kind, quality, rows) {
  if (quality !== 'ai_review') return [];
  const bar = CONF_BAR[kind];
  return rows.filter((r) => r.verdict !== 'not_reached' && (!r.settled || (bar != null && r.conf != null && r.conf < bar))).map((r) => r.i);
}

// ------------------------------------------------------------------ the shape

function marks({ task, spec, timed = null, score = null, stopped = false, items = [], review = [], extra = {}, modelVersions = {} }) {
  return {
    version: VERSION,
    task,
    quality: (spec && spec.quality) || null,
    timed,
    score,
    stopped_by_rule: !!stopped,
    items,
    review,
    count_flag: null,
    flags: [],
    model_versions: modelVersions,
    ...extra,
  };
}

function skipped({ task, spec }) {
  return {
    version: VERSION, task, quality: (spec && spec.quality) || null, skipped_by_coach: true,
    ...(spec && spec.gap ? { gap: true, gap_reason: spec.reason || null } : {}),
    timed: null, score: null, stopped_by_rule: false, items: [], review: [], count_flag: null, flags: [], model_versions: {},
  };
}

/** Untimed score (EGMA Toolkit p.22): correct, out of the form, and out of those administered. */
function untimedScore(rows) {
  return {
    correct: rows.filter((r) => r.verdict === 'correct').length,
    of: rows.length,
    asked: rows.filter((r) => r.verdict !== 'not_reached').length,
  };
}

/** Timed summary from rows + clock. */
function timedSummary({ rows, clock, words, durationSec, stopped }) {
  const begin = clock.begin_at_s;
  let attempted = 0;
  rows.forEach((r) => { if (r.verdict !== 'not_reached') attempted = r.i; });
  const correct = stopped ? 0 : rows.filter((r) => r.verdict === 'correct').length;
  const finished = !stopped && rows.length > 0 && attempted === rows.length;
  const remaining = timeRemaining({ words, begin, coachSpeaker: clock.coachSpeaker, finished });
  const endAt = Number.isFinite(durationSec) ? Math.min(begin + SECONDS, durationSec) : begin + SECONDS;
  return {
    seconds_given: SECONDS,
    begin_at_s: round1(begin),
    end_at_s: round1(endAt),
    clock: clock.clock,
    time_remaining: remaining,
    attempted,
    correct,
    rate: rate(correct, remaining),
  };
}

module.exports = {
  VERSION, SECONDS, TaskError, rate, wordsFor, beginLines, findClock, timeRemaining, timedRows, untimedRows, byPosition,
  applyFirstRowStop, applyConsecutiveStop, reviewItems, marks, skipped, untimedScore, timedSummary, confOf, renderTurns, CONF_BAR,
};
