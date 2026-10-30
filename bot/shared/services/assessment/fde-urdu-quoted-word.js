'use strict';
/**
 * A quoted word in a "meaning of the word" stem is spelled as the source pages print it (v37r4 g2-urdu Q1 ii
 * printed «بیسرا»; the textbook word is «بسیرا»). A quoted word the source lacks is replaced, in the stem and
 * wherever the item repeats it, by the one source word made of the same letters, or failing that the one source
 * word one edit away. Two candidates or none: the item is left and flagged for a re-ask (never guessed).
 * No source text: nothing changes. Pure.
 */

const { mapAll, eachItem } = require('./fde-urdu-walk-all');

const STEM = /لفظ\s*«([^»]+)»\s*کا\s*(?:مطلب|معنی)/u;
const norm = (s) => String(s || '').replace(/[ً-ٰٟۖ-ۭ]/g, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').normalize('NFC').trim();
const sorted = (s) => [...s].sort().join('');

/** Optimal string alignment distance: an insertion, deletion, substitution or adjacent swap is one edit. */
function osa(a, b) {
  const x = [...a];
  const y = [...b];
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= x.length; i += 1) {
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

function sourceWords(bookText) {
  return new Set(String(bookText || '').split(/[^\p{Script=Arabic}]+/u).map(norm).filter((w) => w.length >= 2));
}

/** {state:'ok'|'fix'|'flag', to} for one quoted word against the source words. */
function judge(word, words) {
  const w = norm(word);
  if (!w || words.has(w)) return { state: 'ok' };
  if ([...w].length < 4) return { state: 'flag' };
  const others = [...words].filter((c) => c !== w);
  const same = others.filter((c) => sorted(c) === sorted(w));
  if (same.length === 1) return { state: 'fix', to: same[0] };
  if (same.length > 1) return { state: 'flag' };
  const near = others.filter((c) => osa(c, w) === 1);
  return near.length === 1 ? { state: 'fix', to: near[0] } : { state: 'flag' };
}

const replaceIn = (v, from, to) => (typeof v === 'string' ? v.split(from).join(to)
  : Array.isArray(v) ? v.map((x) => replaceIn(x, from, to)) : v);

function quotedWordFix(examJson, bookText) {
  const notes = [];
  const words = sourceWords(bookText);
  if (!words.size) return { examJson, notes };
  const out = mapAll(examJson, (q) => {
    const m = STEM.exec(String(q.question || ''));
    if (!m) return undefined;
    const j = judge(m[1], words);
    if (j.state !== 'fix') return undefined;
    const raw = m[1].trim();
    notes.push(`${q.slot}: the quoted word «${raw}» is not in the source pages; «${j.to}» is the book's spelling and replaces it`);
    return { ...q, question: replaceIn(q.question, raw, j.to), options: replaceIn(q.options, raw, j.to), answer: replaceIn(q.answer, raw, j.to) };
  });
  return { examJson: out, notes };
}

/** Quoted words the source lacks and no single source word explains, as answer flags for a re-ask. */
function quotedWordShortfall(examJson, P, bookText) {
  const words = sourceWords(bookText);
  const bySlot = new Map();
  if (!words.size) return [];
  eachItem(examJson, (q) => {
    const m = STEM.exec(String(q.question || ''));
    if (!m || judge(m[1], words).state !== 'flag') return;
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    bySlot.get(q.slot).push(`${String(q.question).trim()} (the word «${m[1].trim()}» is not in the source pages: quote a word exactly as the book prints it)`);
  });
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
}

module.exports = { quotedWordFix, quotedWordShortfall };
