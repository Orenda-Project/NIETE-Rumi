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
 * v42 (bd-5jmnfj.33.8): only that case. A shorter answer («مفت کھانا» under a full sentence) or a turned-round
 * fact («5 x 6 = 30» under «6 x 5 = 30») is real marking guidance and prints. The dropped case is the key with
 * each item's «word:» label removed (items split on a new line, «؛» or «;»),
 * and an accept that is one of a several-item key's own items (G5 Urdu Q3 «شاطر: چالاک»), compared loosely.
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
  const items = String(key == null ? '' : key).split(/[\n؛;]/);
  const unlabelled = loose(items.map((l) => l.replace(/^[^:]*:/, '')).join(' '));
  const oneItem = new Set(items.length > 1 ? items.map(loose).filter(Boolean) : []);
  const madeOfKey = (a) => (tokens(a).length > 1 && loose(a) === unlabelled) || oneItem.has(loose(a));
  const list = (Array.isArray(accept) ? accept : []).map((a) => String(a == null ? '' : a).trim())
    .filter((a) => a && loose(a) !== own && !madeOfKey(a));
  if (!list.length) return '';
  const sep = list.some((a) => SENTENCE.test(a)) ? ' / ' : (lang === 'ur' ? '؛ ' : '; ');
  return list.join(sep);
}

module.exports = { acceptText };
