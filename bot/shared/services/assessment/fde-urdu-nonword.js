'use strict';
/**
 * A non-word in an Urdu key (round 6 blocker, bd-5jmnfj.4.58.9.3). v35 G1 Urdu oral poem printed «روشنی کے ہار بھی
 * دیکے»: the stored book text misreads the printed «دمکے» (G1 Urdu book p87 poem, p85 glossary, textbook
 * 416a0cea-1908-445b-bab9-2f66aeb8b5b2), so the card and its key copied a word that does not exist.
 *   MISREADS         known stored-text misreads → the word the book prints. Each entry is checked against the
 *                    printed page before it is added; nothing here is authored text.
 *   correctText      mends a misread standing as a whole word (دیکھے, which holds the same letters, is left alone).
 *   nonWords         the known misreads a text holds.
 *   correctMisreads  every string in a loaded book or a paper, deep; returns the same object when nothing changed.
 * Pure: never throws, never mutates its input.
 */

const MISREADS = Object.freeze({ 'دیکے': 'دمکے' });

// An Urdu word is bounded by anything that is not a letter, a mark or a joiner (، and ۔ are bounds).
const LETTER = '\\p{L}\\p{M}\\u200C\\u200D';
const wordRe = (w) => new RegExp(`(^|[^${LETTER}])(${w})(?=$|[^${LETTER}])`, 'gu');
const RES = Object.keys(MISREADS).map((w) => [w, wordRe(w)]);

function correctText(text) {
  if (typeof text !== 'string') return { text, notes: [] };
  const notes = [];
  let out = text.normalize('NFC');
  RES.forEach(([bad, re]) => {
    out = out.replace(re, (all, pre) => { notes.push(`«${bad}» → «${MISREADS[bad]}»`); return pre + MISREADS[bad]; });
  });
  return { text: notes.length ? out : text, notes };
}

function nonWords(text) {
  if (typeof text !== 'string') return [];
  const s = text.normalize('NFC');
  return RES.filter(([, re]) => { re.lastIndex = 0; return re.test(s); }).map(([bad]) => bad);
}

function correctMisreads(value) {
  const notes = [];
  const walk = (v, depth) => {
    if (depth > 40) return v;
    if (typeof v === 'string') {
      const m = correctText(v);
      notes.push(...m.notes);
      return m.text;
    }
    if (Array.isArray(v)) {
      const next = v.map((x) => walk(x, depth + 1));
      return next.some((x, i) => x !== v[i]) ? next : v;
    }
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      let changed = false;
      const next = {};
      Object.keys(v).forEach((k) => { next[k] = walk(v[k], depth + 1); if (next[k] !== v[k]) changed = true; });
      return changed ? next : v;
    }
    return v;
  };
  try {
    return { value: walk(value, 0), notes };
  } catch (e) {
    return { value, notes: [] };
  }
}

module.exports = { MISREADS, correctText, nonWords, correctMisreads };
