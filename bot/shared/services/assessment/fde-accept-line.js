'use strict';
/**
 * The key's "accept:" line (bd-5jmnfj.4.57). v25 G1 Urdu printed «یہ بھی درست: بلی» under the
 * answer بلی, and joined whole sentences with «؛» so they read as one. An accept that is the key
 * itself, apart from its option label, punctuation, spaces and case, is not printed; sentences are
 * joined with « / ».
 *
 * v27 (bd-5jmnfj.4.58.2): Arabic diacritics are noise too (v26 G2 Urdu keyed «بُلبل، ساز، کوئل» and accepted
 * «بلبل، ساز، کوئل»), and an accept whose every word is a word of the answer (G5 Urdu Q4: the key «جھکڑ: جھ ۔ کڑ»
 * accepted «جھ ۔ کڑ، سا ۔ ن ۔ حہ», the same pieces joined with «،») is the answer again and is not printed.
 *
 * Pure: strings in, string out.
 */

const LABEL = /^\s*\(?[a-z]\)\s*/i;
const NOISE = /[\s.,;:!?،؛۔؟\-–—'"“”‘’()\u064B-\u0670\u065F]/g;
const TOKENS = /[^\s.,;:!?،؛۔؟\-–—'"“”‘’()/\\\u064B-\u0670\u065F]+/g;
const tokens = (s) => String(s == null ? '' : s).replace(LABEL, '').toLowerCase().match(TOKENS) || [];
const SENTENCE = /[.!?۔؟]\s*$/;

const loose = (s) => String(s == null ? '' : s).replace(LABEL, '').replace(NOISE, '').toLowerCase();

/** The accepts to print after the label, or '' when none is more than the key. */
function acceptText(key, accept, lang) {
  const own = loose(key);
  const keyWords = new Set(tokens(key));
  const madeOfKey = (a) => { const t = tokens(a); return t.length > 1 && t.every((w) => keyWords.has(w)); };
  const list = (Array.isArray(accept) ? accept : []).map((a) => String(a == null ? '' : a).trim())
    .filter((a) => a && loose(a) !== own && !madeOfKey(a));
  if (!list.length) return '';
  const sep = list.some((a) => SENTENCE.test(a)) ? ' / ' : (lang === 'ur' ? '؛ ' : '; ');
  return list.join(sep);
}

module.exports = { acceptText };
