'use strict';
/**
 * Child test (bd-s1oo0.47, CONTRACT §20) — which comprehension questions the child reached.
 *
 * EGRA asks only about text the child actually read (Toolkit p.51). One definition, used by the scorer,
 * the step message, the coach card and the review:
 *
 *   A question with needs_line = k is REACHED iff words_attempted >= lines[k-1].to + 1.
 *   A child who finished early reached every question. A fallback (non-reader) block has no questions.
 *
 *   reachedQuestions(spec, part) -> Set<qid>   spec: the block ({ story, questions }); part: ai_marks (or
 *                                               the scorer's parts) with { story, fallback }, or a story part
 *   anchorFor(spec, q, lang)     -> string     the last 2–3 printed words of line k, punctuation trimmed, so
 *                                               the coach can see where the question's text ends
 *
 * Questions are N, not 3 (v3 may carry 5 or 6). A bank question without needs_line is gated on line 1
 * and logged at warn. When the story was not scored there is no words_attempted to gate on, so nothing is
 * dropped: every question counts as reached.
 */

const { logToFile } = require('../../../utils/logger');

// An anchor of 3 words longer than this (code points) is cut to its last 2: it has to sit on one line.
const ANCHOR_MAX = 24;
const PUNCT = /^[\s.,;:!?'"“”‘’()«»\-–—۔،؟؛]+|[\s.,;:!?'"“”‘’()«»\-–—۔،؟؛]+$/g;

const warned = new WeakSet();

/** Accept a block spec, or a whole form plus its block name. */
function blockOf(spec, lang) {
  if (spec && (spec.story || spec.questions)) return spec;
  return (spec && lang && spec[lang]) || spec || {};
}

function needsLine(q) {
  const k = Number(q && q.needs_line);
  return Number.isInteger(k) && k >= 1 ? k : null;
}

/** Words the child must have attempted to have read line k (its last index + 1); null if the bank has no such line. */
function lineEndFor(spec, k) {
  const lines = (spec && spec.story && spec.story.lines) || [];
  const line = lines.find((l) => Number(l.n) === Number(k)) || lines[Number(k) - 1];
  return line && Number.isInteger(Number(line.to)) ? Number(line.to) + 1 : null;
}

function warnMissing(spec) {
  const missing = (spec.questions || []).filter((q) => needsLine(q) == null).map((q) => q.id);
  if (!missing.length || warned.has(spec)) return;
  warned.add(spec);
  logToFile('child_test.reach.no_needs_line', { questions: missing }, 'warn');
}

function storyOf(part) {
  if (!part) return null;
  if (part.story !== undefined) return part.story;
  return part.words_attempted !== undefined || part.finished_early !== undefined ? part : null;
}

/** The ids of the questions the child reached (CONTRACT §20). */
function reachedQuestions(spec, part) {
  const s = blockOf(spec);
  const qs = s.questions || [];
  const out = new Set();
  if (part && part.fallback) return out;
  warnMissing(s);
  const story = storyOf(part);
  const attempted = story ? Number(story.words_attempted) : NaN;
  const unknown = !story || !Number.isFinite(attempted);
  for (const q of qs) {
    if (unknown || story.finished_early) { out.add(q.id); continue; }
    const need = lineEndFor(s, needsLine(q) || 1);
    if (need == null || attempted >= need) out.add(q.id);
  }
  return out;
}

/** The last 2–3 printed words of the question's line, for "only if the child read past «…»". */
function anchorFor(spec, q, lang) {
  const s = blockOf(spec, lang);
  const story = s.story || {};
  const lines = story.lines || [];
  const k = needsLine(q) || 1;
  const line = lines.find((l) => Number(l.n) === k) || lines[k - 1];
  if (!line) return '';
  const words = (story.tokens || []).slice(Number(line.from), Number(line.to) + 1)
    .map((w) => String(w).replace(PUNCT, '')).filter(Boolean);
  let tail = words.slice(-3);
  if (tail.length === 3 && [...tail.join(' ')].length > ANCHOR_MAX) tail = tail.slice(-2);
  return tail.join(' ');
}

module.exports = { reachedQuestions, anchorFor, lineEndFor };
