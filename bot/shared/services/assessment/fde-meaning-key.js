'use strict';
/**
 * bd-5jmnfj.33 v33 BLOCKER — a "what does X mean?" item whose key is not the meaning. G3 General Knowledge
 * ch3 Q4 v asked what «چنیں» means and keyed a sentence quoted from the book's steps, with a 2-mark point
 * paying the NEXT step (tell an elder). A child who writes the meaning scored 0-1.
 *
 * Flags a meaning question (stem shapes below) when (a) the answer or a point text carries a run of
 * HELD_SHINGLE+ characters the book prints, (b) it has several points on 3 marks or fewer (a definition is one
 * idea), or (c) a point repeats the asked word. Grade 3-4 only (`P.g5_rules === false`).
 * Pure: exam JSON in; `{slot, reason:'meaning_key', why, line, text}` flags out.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const SHINGLE = 24;
const Q = '"“”«»\'‘’';
const X = `[${Q}]?([^${Q}\\s]+(?:\\s[^${Q}\\s]+)?)[${Q}]?`;
const SHAPES = [
  new RegExp(`${X}\\s+کا\\s+(?:کیا\\s+)?مطلب`),
  new RegExp(`${X}\\s+سے\\s+کیا\\s+مراد`),
  new RegExp(`${X}\\s+کے\\s+معنی`),
  /what\s+does\s+["“']?(.+?)["”']?\s+mean/i,
  /meaning\s+of\s+["“']?([^"”'.?!]+?)["”']?\s*[.?!]?\s*$/i,
];
const WHY_TEXT = {
  quotes_book: 'quotes the book instead of giving the meaning',
  split_marks: (n) => `pays ${n} steps for a one-idea meaning`,
  repeats_word: 'repeats the word',
};

const flat = (s) => String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim();
const marksOf = (q, points) => (Number.isFinite(Number(q.marks)) && q.marks !== '' && q.marks != null
  ? Number(q.marks) : points.reduce((n, p) => n + (Number(p && p.marks) || 0), 0));

// The word asked about, or null when the stem is not a meaning question.
function askedWord(stem) {
  const s = flat(stem);
  for (const re of SHAPES) {
    const m = s.match(re);
    if (m) return flat(m[1]).replace(new RegExp(`[${Q}]`, 'g'), '');
  }
  return null;
}

function quotes(text, book) {
  const t = flat(text);
  if (!book || t.length < SHINGLE) return false;
  for (let i = 0; i + SHINGLE <= t.length; i += 1) if (book.includes(t.slice(i, i + SHINGLE))) return true;
  return false;
}

const hasWord = (text, word) => {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${esc}($|[^\\p{L}\\p{M}\\p{N}])`, 'iu').test(flat(text));
};

/** Flags for each meaning question in a Grade 3-4 paper whose key is not the meaning. */
function meaningKeyShortfall(examJson, P, bookText) {
  if (!examJson || !P || P.g5_rules !== false) return [];
  const book = flat(bookText);
  const out = [];
  itemsInOrder(examJson).forEach((q) => {
    const word = askedWord(q.question);
    if (!word) return;
    const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []).filter(Boolean);
    const texts = [q.answer, ...points.map((p) => p.text)];
    const why = [];
    if (texts.some((t) => quotes(t, book))) why.push('quotes_book');
    if (points.length > 1 && marksOf(q, points) <= 3) why.push('split_marks');
    if (points.some((p) => hasWord(p.text, word))) why.push('repeats_word');
    if (!why.length) return;
    const say = why.map((w) => (typeof WHY_TEXT[w] === 'function' ? WHY_TEXT[w](points.length) : WHY_TEXT[w])).join(' / ');
    out.push({ slot: q.slot, reason: 'meaning_key', word, why, text: [flat(q.question)], line: `${flat(q.question)} → ${flat(q.answer)} (${say})` });
  });
  return out;
}

/** The re-ask note for the meaning_key flags in `shortfall`, or null. */
function meaningKeyNote(shortfall) {
  const flags = (Array.isArray(shortfall) ? shortfall : []).filter((f) => f && f.reason === 'meaning_key');
  if (!flags.length) return null;
  return `These questions ask what a word means, but the key is not the meaning:\n${flags.map((f) => `- ${f.line}`).join('\n')}\n`
    + 'Rewrite each key so that you give the meaning in the child\'s words as one point for the full marks.';
}

module.exports = { meaningKeyShortfall, meaningKeyNote };
