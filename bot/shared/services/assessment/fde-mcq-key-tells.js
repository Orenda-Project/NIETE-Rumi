'use strict';
/**
 * The key is the only specific option (bd-5jmnfj.4.58.34). v29 G5 Urdu Q1 item 3 «ہراول دستہ» keyed «فوج کا وہ دستہ
 * جو باقی فوج سے آگے چلے» (9 words) against options of 3 to 5; item 6 «تاب کاری» keyed an 8-word definition
 * beside options of 3 words, and repeated the stem word «تاب». A child picks that option without knowing the answer.
 *
 * An MCQ is flagged when its key has at least 3 more words than the longest distractor, is at least 1.5 times its
 * length, and repeats a content word of the stem. The slot is asked again so the options are written alike.
 *
 * Pure: exam JSON in, flags `{slot, reason:'giveaway', words, with, text, printed}` out.
 */

const { itemsInOrder, choice } = require('./fde-near-repeats');

const MARKS = /[ً-ٰٟـ]/g;
const norm = (s) => String(s == null ? '' : s).replace(MARKS, '').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
const tokens = (s) => norm(s).toLowerCase().match(/[\p{L}]+/gu) || [];
const STOP = new Set(('کیا مراد کون سے سا ہے ہیں کا کی کے کس کسے کہتے مطلب معنی میں اور جو ہو ہوتا ہوتی ہوتے کوئی سی ہوا '
  + 'what which does mean means the this that with from into have about their they them are was were is a an of in on to for').split(' '));
const isMcq = (q) => Array.isArray(q.options) && q.options.length > 1;
const keyText = (q) => {
  const k = norm(choice(q.answer)).trim();
  return q.options.map(choice).find((o) => norm(o).trim() === k) || choice(q.answer);
};
const excerpt = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);

function tellOf(q) {
  const key = keyText(q);
  const keyWords = tokens(key);
  const others = q.options.map(choice).filter((o) => norm(o).trim() !== norm(key).trim());
  if (!others.length || !keyWords.length) return null;
  const longest = Math.max(...others.map((o) => tokens(o).length));
  if (keyWords.length - longest < 3 || keyWords.length < 1.5 * longest) return null;
  const stem = tokens(q.question).filter((w) => w.length >= 3 && !STOP.has(w));
  const repeated = stem.filter((w) => keyWords.includes(w));
  return repeated.length ? { key, repeated, longest, keyLen: keyWords.length } : null;
}

/** One flag per MCQ slot holding an item whose key is far longer than every distractor and echoes the stem. */
function keyTellFlags(examJson) {
  if (!examJson) return [];
  const out = new Map();
  itemsInOrder(examJson).filter(isMcq).filter((q) => q.answer).forEach((q) => {
    const t = tellOf(q);
    if (!t) return;
    const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: [], text: [], printed: true };
    t.repeated.forEach((w) => { if (!r.words.includes(w)) r.words.push(w); });
    r.with.push(q.slot);
    r.text.push(`the key is the longest and only specific option (${t.keyLen} words against ${t.longest}) and repeats «${t.repeated[0]}» from the stem «${excerpt(q.question)}»; write the options at one length and keep the key's stem words out of it`);
    out.set(q.slot, r);
  });
  return [...out.values()];
}

module.exports = { keyTellFlags };
