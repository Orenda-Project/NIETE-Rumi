'use strict';
/**
 * The key's "accept:" line (bd-5jmnfj.4.57). v25 G1 Urdu printed «یہ بھی درست: بلی» under the
 * answer بلی, and joined whole sentences with «؛» so they read as one. An accept that is the key
 * itself, apart from its option label, punctuation, spaces and case, is not printed; sentences are
 * joined with « / ».
 *
 * Pure: strings in, string out.
 */

const LABEL = /^\s*\(?[a-z]\)\s*/i;
const NOISE = /[\s.,;:!?،؛۔؟\-–—'"“”‘’()]/g;
const SENTENCE = /[.!?۔؟]\s*$/;

const loose = (s) => String(s == null ? '' : s).replace(LABEL, '').replace(NOISE, '').toLowerCase();

/** The accepts to print after the label, or '' when none is more than the key. */
function acceptText(key, accept, lang) {
  const own = loose(key);
  const list = (Array.isArray(accept) ? accept : []).map((a) => String(a == null ? '' : a).trim())
    .filter((a) => a && loose(a) !== own);
  if (!list.length) return '';
  const sep = list.some((a) => SENTENCE.test(a)) ? ' / ' : (lang === 'ur' ? '؛ ' : '; ');
  return list.join(sep);
}

module.exports = { acceptText };
