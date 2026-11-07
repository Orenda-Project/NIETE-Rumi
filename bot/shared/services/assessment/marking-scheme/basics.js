'use strict';
// Part of marking-scheme.js (see its header); split for the 300-line limit, bd-5jmnfj.37.

const BLOOMS = Object.freeze({
  remember: 'Remember', r: 'Remember',
  understand: 'Understand', u: 'Understand',
  apply: 'Apply', a: 'Apply',
});
const KINDS = new Set(['M', 'A', 'U', 'K', 'L']);

// A cut marking line is a wrong instruction, so the caps only stop a runaway:
// recorded scheme lines run to ~210 code points (accept), ~175 (point, error).
const POINT_TEXT_MAX = 240;
const ACCEPT_MAX = 6;
const ACCEPT_TEXT_MAX = 240;
const COMMON_ERROR_MAX = 240;
const SUM_TOLERANCE = 1e-9;

const TREES = ['unseen', 'seen'];
const CATEGORIES = ['objective', 'subjective'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A value for a log line; never throws (BigInt, cycles).
function show(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch (err) {
    return typeof v;
  }
}

function clone(v) {
  try {
    return structuredClone(v);
  } catch (err) {
    return JSON.parse(JSON.stringify(v));
  }
}

/** A string cut to `n` code points, ending with "…" when cut. Astral characters count once. */
function capCodePoints(str, n) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  const cps = [...s];
  if (cps.length <= n) return s;
  if (n <= 0) return '';
  return `${cps.slice(0, n - 1).join('').trimEnd()}…`;
}

/** 'Remember' | 'Understand' | 'Apply' for R/U/A in any case, else null. */
function canonicalBlooms(value) {
  if (typeof value !== 'string') return null;
  const k = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BLOOMS, k) ? BLOOMS[k] : null;
}

// A number, or a numeric string; anything else is NaN (so the sum check fails).
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

// Halves, or quarters when the item itself is worth a quarter (Urdu Q4 is 1.25 a part).
function roundMarks(v, itemMarks) {
  const steps = Number.isInteger(Number(itemMarks) * 2) ? 2 : 4;
  return Math.round(toNumber(v) * steps) / steps;
}

function kindOf(k) {
  const kind = typeof k === 'string' ? k.trim().toUpperCase() : '';
  return KINDS.has(kind) ? kind : 'K';
}

function textOf(t) {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return String(t);
  return '';
}

// "327,750" + "Rs." → "327,750 (Rs.)": the unit reads as part of the answer.
function joinText(a, b) {
  if (!a) return b || '';
  return b ? `${a} (${b})` : a;
}

// A length written with its unit in the stem: "a base of 12 cm", "15 m long", "in metres".
const UNIT_IN_STEM = /\b\d[\d,.]*\s*(?:mm|cm|m|km)\b|\b(?:millimet|centimet|met|kilomet)(?:re|er)s?\b/i;

/**
 * Units the child does not choose are part of the answer: every U merges into
 * the last A (marks added, text joined). With no A, the first U becomes it.
 */
function foldUnits(points) {
  let target = -1;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].kind === 'A') { target = i; break; }
  }
  if (target === -1) {
    target = points.findIndex((p) => p.kind === 'U');
    if (target === -1) return points;
    points[target].kind = 'A';
  }
  const out = [];
  points.forEach((p, i) => {
    if (p.kind !== 'U' || i === target) { out.push(p); return; }
    points[target].text = joinText(points[target].text, p.text);
    points[target].marks += p.marks;
  });
  return out;
}

/**
 * A slot whose items are answered in parts (Science Q2(b): two of three, 2.5
 * each): { n, marks } for the parts one item is marked on, else null.
 */
function partMarks(slot, itemMarks) {
  const ip = slot && isObject(slot.item_parts) ? slot.item_parts : null;
  const each = ip ? toNumber(ip.marks_each) : NaN;
  if (!(each > 0) || !Number.isFinite(itemMarks)) return null;
  const n = Math.round(itemMarks / each);
  return n >= 1 && Math.abs(n * each - itemMarks) <= SUM_TOLERANCE ? { n, marks: each } : null;
}

// Whether `values` can be shared out into `n` groups that each add to `target`.
function splitsInto(values, n, target) {
  const sorted = [...values].sort((a, b) => b - a);
  const groups = new Array(n).fill(0);
  const place = (i) => {
    if (i === sorted.length) return groups.every((g) => Math.abs(g - target) <= SUM_TOLERANCE);
    const tried = new Set();
    for (let g = 0; g < n; g += 1) {
      if (tried.has(groups[g]) || groups[g] + sorted[i] > target + SUM_TOLERANCE) continue;
      tried.add(groups[g]);
      groups[g] += sorted[i];
      if (place(i + 1)) return true;
      groups[g] -= sorted[i];
    }
    return false;
  };
  return sorted.every((v) => v > 0) && place(0);
}

// An answer a row can print: a non-empty string or a number, else null.
function answerOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/*
 * The text after letter k («a) …», «(b) …») in a situation's own answer, up to the
 * next letter; null when it carries no such letter. The same split the renderer
 * makes (assessment-paper-fde.renderer.js partOfAnswer), so the filled point and
 * the printed answer are the same words.
 */
function partOfAnswer(answer, k) {
  const text = String(answer ?? '');
  const re = /(^|[\s;.])\(?([a-cA-C])\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ letter: m[2].toLowerCase(), start: m.index + m[1].length, body: m.index + m[0].length });
  const at = marks.findIndex((x) => x.letter === String.fromCharCode(97 + k));
  if (at < 0) return null;
  const end = at + 1 < marks.length ? marks[at + 1].start : text.length;
  return text.slice(marks[at].body, end).trim() || null;
}

const hasPoints = (holder) => isObject(holder.scheme) && Array.isArray(holder.scheme.points) && holder.scheme.points.length > 0;

// One Accuracy point worth the row's marks, on the row's answer. What else the model wrote is kept.
function fillPoints(holder, marks, answer) {
  if (!isObject(holder.scheme)) holder.scheme = { checked: null };
  holder.scheme.points = [{ kind: 'A', marks, text: capCodePoints(answer, POINT_TEXT_MAX) }];
}

// A meaning written over several lines of verse marks one idea per sentence: one A point of the
// row's whole marks would let a teacher give all or nothing. The answer is cut at each sentence
// end, sentences past one per mark are joined to the last point, and the marks are shared out in
// halves (the first points take the odd half). One sentence is one point, as before. Urdu Q6 (ب)
// only: the live subjects' rows keep their one point.
const SENTENCE_FILL = new Set(['urdu.C.Q6']);
function fillSentences(holder, marks, answer) {
  const sentences = answer.split(/(?<=[۔؟!?])\s+/u).map((s) => s.trim()).filter(Boolean);
  const n = Math.min(sentences.length, Math.floor(marks), Math.floor(marks * 2));
  if (n < 2) return fillPoints(holder, marks, answer);
  const texts = sentences.slice(0, n - 1).concat(sentences.slice(n - 1).join(' '));
  // The halves left over are fewer than the points (base is marks / n rounded down to a half).
  const base = Math.floor((marks / n) * 2) / 2;
  const odd = Math.round((marks - base * n) * 2);
  if (!isObject(holder.scheme)) holder.scheme = { checked: null };
  holder.scheme.points = texts.map((text, i) => ({ kind: 'A', marks: base + (i < odd ? 0.5 : 0), text: capCodePoints(text, POINT_TEXT_MAX) }));
}

// A meaning point above 2 marks that joins several ideas («… فائدے کا ذکر (صاف پانی سے بچاؤ اور
// خوشی کا ذکر)», A4) lets a teacher give all or nothing for them. It is cut at its brackets and
// commas into one point per idea, at most one per half mark, the marks shared out in halves as
// above. A point with one idea stays as written, except a lone point of the whole row: that is the
// lump again, so it is dropped and the row is written on the answer's sentences (fillSentences).
// Urdu Q6 (ب) only, whoever wrote the points.
const IDEA_SPLIT = new Set(['urdu.C.Q6']);
const IDEA_MAX = 2;
function splitIdeas(points) {
  return points.flatMap((p) => {
    if (!(p.marks > IDEA_MAX)) return [p];
    const ideas = p.text.split(/[()（）،,؛;]+/u).map((t) => t.trim()).filter(Boolean);
    const n = Math.min(ideas.length, Math.floor(p.marks * 2));
    if (n < 2) return [p];
    const texts = ideas.slice(0, n - 1).concat(ideas.slice(n - 1).join('، '));
    const base = Math.floor((p.marks / n) * 2) / 2;
    const odd = Math.round((p.marks - base * n) * 2);
    return texts.map((text, i) => ({ text, marks: base + (i < odd ? 0.5 : 0), kind: p.kind }));
  });
}

// Rows marked by criteria, or by their own sub-rows, never print the bare chip.
function fillsWhole(slot) {
  return !['comprehension', 'situation', 'composition'].includes(slot.shape)
    && !(slot.shape === 'frame' && isObject(slot.frame) && slot.frame.kind === 'picture');
}

module.exports = {
  ACCEPT_MAX, ACCEPT_TEXT_MAX, CATEGORIES, COMMON_ERROR_MAX, IDEA_MAX, IDEA_SPLIT, POINT_TEXT_MAX,
  SENTENCE_FILL, SUM_TOLERANCE, TREES, UNIT_IN_STEM, answerOf, canonicalBlooms, capCodePoints, clone,
  fillPoints, fillSentences, fillsWhole, foldUnits, hasPoints, isObject, kindOf, partMarks, partOfAnswer,
  roundMarks, show, splitIdeas, splitsInto, textOf, toNumber,
};
