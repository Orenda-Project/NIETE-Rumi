'use strict';
/**
 * Child test (bd-s1oo0.5) — word normalisation and alignment.
 *
 * Ported from the May 2026 study harness (harness/06_reading_score.py), which is
 * the baseline every scorer was measured against: the same Urdu folding (ye,
 * kaf, he variants, diacritics, punctuation), the same one-edit "same word"
 * rule for words of 4+ letters, and the same Levenshtein alignment.
 */

const UR_MAP = {
  'ي': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ۂ': 'ہ', 'ۀ': 'ہ', 'ے': 'ی', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا',
  'ؤ': 'و', 'ئ': 'ی', 'ة': 'ہ', 'ھ': 'ہ',
};
const DIAC = /[ً-ٰٟۖ-ۭ​-‏]/g;
const PUNC = /[؀-؅،؛؟٪-٭۔.,!?;:"'()\-–—«»]/g;

function clean(w) {
  let s = String(w || '').replace(DIAC, '').replace(PUNC, '');
  s = s.replace(/[يكهۂۀےأإآؤئةھ]/g, (c) => UR_MAP[c] || c);
  return s.trim().toLowerCase();
}

/** Same word, allowing one edit on words of 4+ letters (the study's rule). */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let d = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
    return d === 1;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i += 1) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

/**
 * Levenshtein alignment of a reference word list to a hypothesis list.
 * Returns per-reference status ('correct' | 'sub' | 'omit'), the hypothesis
 * index each reference word aligned to (or -1), and the insertion count.
 */
function align(ref, hyp, eq = same) {
  const n = ref.length; const m = hyp.length;
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i += 1) D[i][0] = i;
  for (let j = 0; j <= m; j += 1) D[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const c = eq(ref[i - 1], hyp[j - 1]) ? 0 : 1;
      D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + c);
    }
  }
  let i = n; let j = m; let ins = 0;
  const status = new Array(n).fill('omit');
  const hypIdx = new Array(n).fill(-1);
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (eq(ref[i - 1], hyp[j - 1]) ? 0 : 1)) {
      status[i - 1] = eq(ref[i - 1], hyp[j - 1]) ? 'correct' : 'sub';
      hypIdx[i - 1] = j - 1; i -= 1; j -= 1;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      status[i - 1] = 'omit'; i -= 1;
    } else {
      ins += 1; j -= 1;
    }
  }
  return { status, hypIdx, ins };
}

function lastAttempted(status) {
  for (let i = status.length - 1; i >= 0; i -= 1) if (status[i] !== 'omit') return i + 1;
  return 0;
}

/**
 * Soniox tokens are sub-word pieces; a new word starts on a token that begins
 * with a space. Returns [{ w (cleaned), raw, start, end, speaker }] in seconds.
 */
function wordsFromTokens(tokens) {
  const words = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.raw.trim()) {
      const w = clean(cur.raw);
      if (w) words.push({ w, raw: cur.raw.trim(), start: cur.start, end: cur.end, speaker: cur.speaker });
    }
    cur = null;
  };
  for (const t of tokens || []) {
    const tx = t.text || '';
    if (tx === '<end>' || tx === '<fin>') continue;
    const s = (t.start_ms || 0) / 1000; const e = (t.end_ms || t.start_ms || 0) / 1000;
    if (!cur || /^\s/.test(tx)) {
      flush();
      cur = { raw: tx, start: s, end: e, speaker: t.speaker != null ? String(t.speaker) : null };
    } else {
      cur.raw += tx; cur.end = e;
    }
  }
  flush();
  return words;
}

/** Reference text → cleaned word list (punctuation is never a token). */
function refWords(textOrTokens) {
  const arr = Array.isArray(textOrTokens) ? textOrTokens : String(textOrTokens || '').split(/\s+/);
  return arr.map(clean).filter(Boolean);
}

module.exports = { clean, same, align, lastAttempted, wordsFromTokens, refWords };
